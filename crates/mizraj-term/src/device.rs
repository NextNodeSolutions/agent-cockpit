//! PTY write-back and device identity (TP14).
//!
//! libghostty answers terminal queries (DSR cursor/status reports, DA1/2/3
//! device attributes, ENQ) by synthesizing the response bytes itself — but it
//! only does so once a `write_pty` callback is installed. Without one, TUIs
//! that probe the terminal at startup hang waiting for an answer.
//!
//! The callbacks fire synchronously inside `ghostty_terminal_vt_write`, on
//! the render thread that owns the [`Terminal`] — so the writer needs no
//! `Send`/`Sync`, just `'static`.

use std::ffi::c_void;
use std::ptr::NonNull;

use mizraj_term_sys::{
    ghostty_terminal_set, GhosttyColorRgb, GhosttyColorScheme,
    GhosttyColorScheme_GHOSTTY_COLOR_SCHEME_DARK, GhosttyColorScheme_GHOSTTY_COLOR_SCHEME_LIGHT,
    GhosttyDeviceAttributes, GhosttyResult_GHOSTTY_SUCCESS, GhosttyTerminalImpl,
    GhosttyTerminalOption, GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND,
    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_CURSOR,
    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND,
    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_SCHEME,
    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_DEVICE_ATTRIBUTES,
    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_USERDATA,
    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_WRITE_PTY,
};

use crate::color::{ColorScheme, DefaultColors, Rgb};
use crate::{Result, TermError};

/// Callback receiving the bytes libghostty wants written back to the PTY.
pub type PtyWriter = Box<dyn FnMut(&[u8]) + 'static>;

/// The boxed state `OPT_USERDATA` points at. One per terminal; freed by
/// [`drop_callbacks`] after the terminal itself is freed.
pub(crate) struct TerminalCallbacks {
    writer: PtyWriter,
    /// The scheme reported to a color-scheme query (DSR `?996n`). Mutated by
    /// [`set_default_colors`] and read back by [`color_scheme_trampoline`];
    /// both run on the single terminal-owning thread, so no synchronization.
    color_scheme: GhosttyColorScheme,
}

/// Ghostty's own device identity: a VT220 (conformance 62) with ANSI color
/// (22) and clipboard access (52); DA2 reports device type 1 (VT220).
const DA1_CONFORMANCE_VT220: u16 = 62;
const DA1_FEATURE_ANSI_COLOR: u16 = 22;
const DA1_FEATURE_CLIPBOARD: u16 = 52;
const DA2_DEVICE_TYPE_VT220: u16 = 1;
const DA2_FIRMWARE_VERSION: u16 = 10;

unsafe extern "C" fn write_pty_trampoline(
    _terminal: *mut GhosttyTerminalImpl,
    userdata: *mut c_void,
    data: *const u8,
    len: usize,
) {
    if userdata.is_null() || data.is_null() || len == 0 {
        return;
    }
    // SAFETY: userdata is the Box<TerminalCallbacks> installed alongside this
    // trampoline and outlives the terminal; data/len describe libghostty's
    // response buffer, valid for the duration of the callback.
    let callbacks = unsafe { &mut *userdata.cast::<TerminalCallbacks>() };
    let bytes = unsafe { std::slice::from_raw_parts(data, len) };
    (callbacks.writer)(bytes);
}

unsafe extern "C" fn color_scheme_trampoline(
    _terminal: *mut GhosttyTerminalImpl,
    userdata: *mut c_void,
    out_scheme: *mut GhosttyColorScheme,
) -> bool {
    if userdata.is_null() || out_scheme.is_null() {
        return false;
    }
    // SAFETY: userdata is the Box<TerminalCallbacks> installed alongside this
    // trampoline and outlives the terminal; out_scheme points at a scheme slot
    // libghostty owns for the duration of the callback.
    let callbacks = unsafe { &*userdata.cast::<TerminalCallbacks>() };
    unsafe { *out_scheme = callbacks.color_scheme };
    true
}

unsafe extern "C" fn device_attributes_trampoline(
    _terminal: *mut GhosttyTerminalImpl,
    _userdata: *mut c_void,
    out_attrs: *mut GhosttyDeviceAttributes,
) -> bool {
    if out_attrs.is_null() {
        return false;
    }
    // SAFETY: out_attrs points at a struct libghostty owns for the duration of
    // the callback; we fill every field of all three sub-structs.
    let attrs = unsafe { &mut *out_attrs };
    attrs.primary.conformance_level = DA1_CONFORMANCE_VT220;
    attrs.primary.features = [0; 64];
    attrs.primary.features[0] = DA1_FEATURE_ANSI_COLOR;
    attrs.primary.features[1] = DA1_FEATURE_CLIPBOARD;
    attrs.primary.num_features = 2;
    attrs.secondary.device_type = DA2_DEVICE_TYPE_VT220;
    attrs.secondary.firmware_version = DA2_FIRMWARE_VERSION;
    attrs.secondary.rom_cartridge = 0;
    attrs.tertiary.unit_id = 0;
    true
}

/// Install `writer` as the PTY write-back on `handle` and answer DA queries
/// with Ghostty's device identity. Returns the userdata pointer the caller
/// must keep until after `ghostty_terminal_free`, then release via
/// [`drop_callbacks`].
pub(crate) fn install_pty_writer(
    handle: NonNull<GhosttyTerminalImpl>,
    writer: PtyWriter,
) -> Result<*mut TerminalCallbacks> {
    let userdata = Box::into_raw(Box::new(TerminalCallbacks {
        writer,
        // Conservative until the embedder seeds real colors via
        // `set_default_colors`; a probe before then sees the historical default.
        color_scheme: GhosttyColorScheme_GHOSTTY_COLOR_SCHEME_DARK,
    }));

    // SAFETY: handle is live (caller guarantee). Callback options take the
    // function pointer directly; USERDATA takes the raw pointer itself. On any
    // failure the box is reclaimed before returning.
    let result = unsafe {
        ghostty_terminal_set(
            handle.as_ptr(),
            GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_USERDATA,
            userdata.cast(),
        )
    };
    if result == GhosttyResult_GHOSTTY_SUCCESS {
        // SAFETY: same contract as above; transmuting the trampoline to the
        // void pointer the option API expects.
        let result = unsafe {
            ghostty_terminal_set(
                handle.as_ptr(),
                GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_WRITE_PTY,
                write_pty_trampoline as *const c_void,
            )
        };
        if result == GhosttyResult_GHOSTTY_SUCCESS {
            // SAFETY: as above.
            let result = unsafe {
                ghostty_terminal_set(
                    handle.as_ptr(),
                    GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_DEVICE_ATTRIBUTES,
                    device_attributes_trampoline as *const c_void,
                )
            };
            if result == GhosttyResult_GHOSTTY_SUCCESS {
                // SAFETY: as above. The color-scheme callback answers DSR
                // ?996n from the scheme stored in `userdata`.
                let result = unsafe {
                    ghostty_terminal_set(
                        handle.as_ptr(),
                        GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_SCHEME,
                        color_scheme_trampoline as *const c_void,
                    )
                };
                if result == GhosttyResult_GHOSTTY_SUCCESS {
                    return Ok(userdata);
                }
            }
        }
    }

    // SAFETY: userdata came from Box::into_raw above and was not handed out.
    drop(unsafe { Box::from_raw(userdata) });
    Err(TermError::Init(
        "installing the pty write-back callbacks failed".into(),
    ))
}

/// Map our scheme to libghostty's enum.
fn scheme_to_ffi(scheme: ColorScheme) -> GhosttyColorScheme {
    match scheme {
        ColorScheme::Light => GhosttyColorScheme_GHOSTTY_COLOR_SCHEME_LIGHT,
        ColorScheme::Dark => GhosttyColorScheme_GHOSTTY_COLOR_SCHEME_DARK,
    }
}

/// Set one default color option, or clear it (pass `None`). The value is copied
/// synchronously by libghostty, so a stack temporary is sufficient.
fn set_color(
    handle: NonNull<GhosttyTerminalImpl>,
    option: GhosttyTerminalOption,
    color: Option<Rgb>,
) -> Result<()> {
    let rgb = color.map(|c| GhosttyColorRgb {
        r: c.r,
        g: c.g,
        b: c.b,
    });
    let value = rgb
        .as_ref()
        .map_or(std::ptr::null(), |c| c as *const GhosttyColorRgb)
        .cast::<c_void>();
    // SAFETY: `handle` is live (caller guarantee). `value` is either null
    // (clear) or points at `rgb`, which outlives this synchronous call.
    let result = unsafe { ghostty_terminal_set(handle.as_ptr(), option, value) };
    if result != GhosttyResult_GHOSTTY_SUCCESS {
        return Err(TermError::Init(format!(
            "ghostty_terminal_set color option {option} returned {result}"
        )));
    }
    Ok(())
}

/// Seed libghostty's default theme colors (foreground/background/cursor) and the
/// reported color scheme, so a program probing the terminal (OSC 10/11/12, DSR
/// ?996n) learns the user's real theme instead of libghostty's built-in dark
/// default. `userdata` is the pointer from [`install_pty_writer`]; the scheme is
/// stored there for [`color_scheme_trampoline`] to read.
pub(crate) fn set_default_colors(
    handle: NonNull<GhosttyTerminalImpl>,
    userdata: *mut TerminalCallbacks,
    colors: &DefaultColors,
) -> Result<()> {
    set_color(
        handle,
        GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND,
        colors.background,
    )?;
    set_color(
        handle,
        GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND,
        colors.foreground,
    )?;
    set_color(
        handle,
        GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_CURSOR,
        colors.cursor,
    )?;
    if !userdata.is_null() {
        // SAFETY: `userdata` is the live callbacks box from install_pty_writer,
        // mutated only here on the terminal-owning thread.
        unsafe { (*userdata).color_scheme = scheme_to_ffi(colors.scheme) };
    }
    Ok(())
}

/// Release the callback state installed by [`install_pty_writer`]. Must run
/// AFTER `ghostty_terminal_free` so no callback can fire on freed state.
pub(crate) fn drop_callbacks(userdata: *mut TerminalCallbacks) {
    if userdata.is_null() {
        return;
    }
    // SAFETY: created by Box::into_raw in install_pty_writer, freed once.
    drop(unsafe { Box::from_raw(userdata) });
}
