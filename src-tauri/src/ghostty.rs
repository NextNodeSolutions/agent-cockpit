//! Host bridge between the Tauri app and the `mizraj-config` crate.
//!
//! `mizraj-config` is deliberately platform-path-free; this module resolves the
//! concrete Ghostty config/theme locations from the environment, loads the
//! effective config, and exposes it to the frontend via the `load_ghostty_config`
//! command. The pure `ResolvedConfig -> wire DTO` mapping lives in [`dto`].

mod dto;
mod watch;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use mizraj_config::{load, Appearance, LoadOptions};
use notify::RecommendedWatcher;
use tauri::{AppHandle, Emitter, Runtime};

use dto::{build_dto, GhosttyConfigDto};
use watch::{spawn_config_watcher, GHOSTTY_CONFIG_CHANGED_EVENT};

/// Absolute path to the app-bundled Ghostty theme corpus, set once at startup
/// from the Tauri resource dir (see [`set_bundled_themes_dir`]). The corpus is
/// vendored (`resources/ghostty-themes/`) so `theme = <name>` resolves on any
/// Mac with no dependency on an installed Ghostty — mizraj is self-contained.
static BUNDLED_THEMES_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Register the app-bundled theme directory. Called once during Tauri `setup`
/// with `<resource_dir>/ghostty-themes`; later calls are ignored.
pub fn set_bundled_themes_dir(dir: PathBuf) {
    let _ = BUNDLED_THEMES_DIR.set(dir);
}

/// The directory that holds `$XDG_CONFIG_HOME/ghostty` (defaulting XDG to
/// `$HOME/.config`).
fn xdg_ghostty_dir(home: &Path, xdg_config_home: Option<&Path>) -> PathBuf {
    match xdg_config_home {
        Some(xdg) if !xdg.as_os_str().is_empty() => xdg.join("ghostty"),
        _ => home.join(".config").join("ghostty"),
    }
}

/// The two file names Ghostty accepts in each config directory, in load order.
fn config_files_in(dir: &Path) -> [PathBuf; 2] {
    [dir.join("config"), dir.join("config.ghostty")]
}

/// The user-editable Ghostty config directories, in load order: the XDG dir
/// always, plus the macOS Application Support location. These are both the
/// roots the loader reads from and the roots the hot-reload watcher observes
/// (their `themes/` subdirs included, by recursion).
fn user_config_dirs() -> Vec<PathBuf> {
    // `home_dir()` reads `$HOME`, then falls back to the passwd database
    // (getpwuid) so a Finder/launchd launch with no `$HOME` still resolves.
    let home = std::env::home_dir().unwrap_or_default();
    let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
    let mut dirs = vec![xdg_ghostty_dir(&home, xdg.as_deref())];

    if cfg!(target_os = "macos") {
        dirs.push(
            home.join("Library")
                .join("Application Support")
                .join("com.mitchellh.ghostty"),
        );
    }

    dirs
}

/// Resolve the Ghostty config files (load order) and theme search dirs. The
/// user's own `themes/` dirs come first, then the app-bundled corpus
/// ([`BUNDLED_THEMES_DIR`]) so a named theme always resolves self-contained —
/// no `/Applications/Ghostty.app` or other external install is consulted.
fn load_options(appearance: Appearance) -> LoadOptions {
    let config_dirs = user_config_dirs();
    let mut theme_dirs: Vec<PathBuf> = config_dirs.iter().map(|dir| dir.join("themes")).collect();

    // The vendored corpus makes `theme = <name>` resolve identically on every
    // Mac. Pushed AFTER the user dirs so a user's own theme of the same name
    // still wins. Absent only in a dev build where the resource dir is unset.
    if let Some(bundled) = BUNDLED_THEMES_DIR.get() {
        theme_dirs.push(bundled.clone());
    }

    let config_files = config_dirs
        .iter()
        .flat_map(|dir| config_files_in(dir))
        .collect();

    LoadOptions {
        config_files,
        theme_dirs,
        appearance,
    }
}

/// Keeps the config watcher alive for the app's lifetime (dropping a `notify`
/// watcher silently stops its notifications). Managed as Tauri state; `None`
/// when no config directory exists, in which case hot reload is simply off.
pub struct ConfigWatchGuard(#[allow(dead_code)] Mutex<Option<RecommendedWatcher>>);

/// Watch the user's Ghostty config directories and broadcast
/// `ghostty:config-changed` on every (debounced) change so the frontend
/// re-pulls the resolved config (DG3 hot reload).
pub fn start_config_watcher<R: Runtime>(app: &AppHandle<R>) -> ConfigWatchGuard {
    let emitter = app.clone();
    let watcher = spawn_config_watcher(user_config_dirs(), move || {
        let _ = emitter.emit(GHOSTTY_CONFIG_CHANGED_EVENT, ());
    });
    ConfigWatchGuard(Mutex::new(watcher))
}

fn parse_appearance(value: &str) -> Appearance {
    match value {
        "light" => Appearance::Light,
        _ => Appearance::Dark,
    }
}

/// Approximate Ghostty's byte-based `scrollback-limit` in libghostty's
/// line-based retention: bytes / 80 (a typical text line), clamped to sane
/// bounds. Exact byte accounting would require owning the ring; the deviation
/// is recorded in the implementation notes.
const SCROLLBACK_BYTES_PER_LINE: u64 = 80;
const SCROLLBACK_MIN_LINES: u64 = 100;
const SCROLLBACK_MAX_LINES: u64 = 10_000_000;

pub fn scrollback_lines() -> usize {
    let config = load(&load_options(Appearance::Dark));
    let Some(limit_bytes) = config.scrollback_limit else {
        return mizraj_term::DEFAULT_MAX_SCROLLBACK_LINES;
    };
    let lines =
        (limit_bytes / SCROLLBACK_BYTES_PER_LINE).clamp(SCROLLBACK_MIN_LINES, SCROLLBACK_MAX_LINES);
    usize::try_from(lines).unwrap_or(mizraj_term::DEFAULT_MAX_SCROLLBACK_LINES)
}

/// Map a resolved config color to a terminal RGB, dropping the non-RGB forms
/// (named X11 colors — not resolved yet — and the `cell-*` runtime specials),
/// which leave the slot unset so libghostty keeps its built-in default.
fn term_rgb(color: Option<mizraj_config::Color>) -> Option<mizraj_term::Rgb> {
    match color {
        Some(mizraj_config::Color::Rgb(rgb)) => Some(mizraj_term::Rgb::new(rgb.r, rgb.g, rgb.b)),
        _ => None,
    }
}

/// Resolve the default theme colors a newly spawned session should advertise:
/// the background/foreground/cursor a probing TUI reads (OSC 10/11/12) to pick
/// its light/dark variant, plus the implied color scheme (DSR `?996n`).
///
/// `appearance` is the frontend's live light/dark (see `currentAppearance`), so a
/// `light:…,dark:…` theme resolves the side the user actually sees — without it
/// the dark side was always picked, reporting the wrong polarity on a light
/// terminal. A plain `theme = <name>` resolves identically either way.
pub fn session_terminal_colors(appearance: &str) -> mizraj_term::DefaultColors {
    let config = load(&load_options(parse_appearance(appearance)));
    let background = term_rgb(config.background);
    mizraj_term::DefaultColors {
        background,
        foreground: term_rgb(config.foreground),
        cursor: term_rgb(config.cursor_color),
        scheme: mizraj_term::ColorScheme::from_background(background),
    }
}

/// The `COLORFGBG` value advertising a resolved scheme as light or dark, for
/// tools that read the env var instead of querying OSC 11 (the de-facto `fg;bg`
/// convention — a light `bg` index, here `15`, means a light terminal; `0` a
/// dark one). Pure: derived from the already-resolved scheme, no config reload —
/// a belt-and-suspenders complement to the OSC 11 responder.
pub fn colorfgbg_for(scheme: mizraj_term::ColorScheme) -> &'static str {
    match scheme {
        mizraj_term::ColorScheme::Light => "0;15",
        mizraj_term::ColorScheme::Dark => "15;0",
    }
}

/// Load the user's effective Ghostty config for the given system appearance
/// (`"light"` / `"dark"`). Never fails on a bad config — problems ride along in
/// `diagnostics` so the terminal still starts.
#[tauri::command]
pub fn load_ghostty_config(appearance: String) -> GhosttyConfigDto {
    let options = load_options(parse_appearance(&appearance));
    build_dto(load(&options))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_files_in_returns_both_names_in_order() {
        let files = config_files_in(Path::new("/x/ghostty"));
        assert_eq!(files[0], PathBuf::from("/x/ghostty/config"));
        assert_eq!(files[1], PathBuf::from("/x/ghostty/config.ghostty"));
    }

    #[test]
    fn xdg_dir_prefers_xdg_config_home_over_default() {
        let home = Path::new("/home/u");
        assert_eq!(
            xdg_ghostty_dir(home, Some(Path::new("/custom/xdg"))),
            PathBuf::from("/custom/xdg/ghostty")
        );
        assert_eq!(
            xdg_ghostty_dir(home, None),
            PathBuf::from("/home/u/.config/ghostty")
        );
    }
}
