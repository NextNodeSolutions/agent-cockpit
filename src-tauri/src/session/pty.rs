use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::Path;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::session::error::SessionError;

/// Initial PTY grid dimensions. The frontend re-syncs the real size via
/// `session_resize` once the terminal pane has measured itself, but the child
/// and the render-side terminal emulator must agree on a starting geometry.
pub(crate) const DEFAULT_ROWS: u16 = 24;
pub(crate) const DEFAULT_COLS: u16 = 80;

/// Terminal-environment defaults seeded into every spawned PTY so mizraj stays
/// self-contained: a GUI launch carries no `TERM`/locale, which breaks shell
/// init scripts (`tput`) and UTF-8 rendering. Callers may override any of these
/// via the `env` map passed to [`spawn`].
const DEFAULT_TERM_ENV: &[(&str, &str)] = &[
    ("TERM", "xterm-256color"),
    ("COLORTERM", "truecolor"),
    ("LANG", "en_US.UTF-8"),
];

/// Merge [`DEFAULT_TERM_ENV`] with the caller's `env`, the caller winning on key
/// collisions. Extracted as a pure function so the override precedence is
/// unit-testable without spawning a process.
fn effective_env(env: &HashMap<String, String>) -> BTreeMap<String, String> {
    let mut merged: BTreeMap<String, String> = DEFAULT_TERM_ENV
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    merged.extend(env.iter().map(|(k, v)| (k.clone(), v.clone())));
    merged
}

pub struct PtySession {
    /// Kept alive so `resize_session` can call `MasterPty::resize` after spawn.
    /// Reader/writer are derived from this master but do NOT keep it alive on
    /// their own — drop the master and subsequent ioctl(TIOCSWINSZ) fails.
    pub master: Box<dyn MasterPty + Send>,
    pub master_reader: Box<dyn Read + Send>,
    pub master_writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

/// Spawn `binary` under a 24x80 PTY with the given `cwd` and `env`.
///
/// `env` is applied on top of the parent process environment (portable-pty
/// inherits parent env by default); vars in `env` override matching parent
/// vars. Pass `binary` as an absolute path (resolve via [`super::path::resolve`])
/// so a missing binary surfaces as `BinaryNotFound` rather than an opaque
/// spawn failure.
///
/// Sync by design. Callers invoking this from a Tauri command MUST wrap it in
/// `tauri::async_runtime::spawn_blocking` so the event loop is not blocked.
pub fn spawn(
    binary: &str,
    cwd: impl AsRef<Path>,
    env: &HashMap<String, String>,
) -> Result<PtySession, SessionError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| SessionError::Spawn(e.to_string()))?;

    let mut cmd = CommandBuilder::new(binary);
    cmd.cwd(cwd.as_ref());
    // A macOS GUI app launched from Finder/Dock/launchd inherits a bare
    // environment with no `TERM`, so the spawned shell's init (oh-my-zsh,
    // prompt themes) calls `tput`, which aborts with "No value for $TERM".
    // portable-pty does not set `TERM` itself, so seed sane terminal defaults
    // ([`DEFAULT_TERM_ENV`]) under the caller's `env`, which keeps priority.
    for (k, v) in effective_env(env) {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| SessionError::Spawn(e.to_string()))?;

    drop(pair.slave);

    let master_reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| SessionError::Spawn(e.to_string()))?;
    let master_writer = pair
        .master
        .take_writer()
        .map_err(|e| SessionError::Spawn(e.to_string()))?;

    Ok(PtySession {
        master: pair.master,
        master_reader,
        master_writer,
        child,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_terminal_defaults_when_caller_env_is_empty() {
        let env = effective_env(&HashMap::new());
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert_eq!(env.get("COLORTERM").map(String::as_str), Some("truecolor"));
        assert_eq!(env.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
    }

    #[test]
    fn caller_env_overrides_seeded_defaults() {
        let caller = HashMap::from([("TERM".to_string(), "dumb".to_string())]);
        let env = effective_env(&caller);
        // Caller wins on the colliding key...
        assert_eq!(env.get("TERM").map(String::as_str), Some("dumb"));
        // ...while the non-colliding defaults are still seeded.
        assert_eq!(env.get("COLORTERM").map(String::as_str), Some("truecolor"));
        assert_eq!(env.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
    }

    #[test]
    fn caller_env_extra_vars_are_preserved() {
        let caller = HashMap::from([("FOO".to_string(), "bar".to_string())]);
        let env = effective_env(&caller);
        assert_eq!(env.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
    }
}
