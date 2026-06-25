use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use mizraj_vcs::{create_session_ref, repo_open};
use tauri::async_runtime::Sender;
use tauri::{AppHandle, Runtime};

use crate::session::activity_sink::ActivitySink;
use crate::session::cell_frame::CellFrame;
use crate::session::error::SessionError;
use crate::session::id::SessionId;
use crate::session::key::KeyStroke;
use crate::session::manager::SessionManager;
use crate::session::mouse::MouseEventDto;
use crate::session::path;
use crate::session::sink::OutputSink;
use crate::session::tauri_sink::TauriEventSink;
use crate::session::term_sink::TermSink;
use mizraj_term::ScrollViewport;
use serde::Deserialize;

fn register_session_ref(repo_path: &Path, session_id: &str) -> Result<(), SessionError> {
    let repo = repo_open(repo_path).map_err(|err| SessionError::SessionRef(err.to_string()))?;
    // A freshly-init'd repo (no commits) has an unborn HEAD: there is no commit
    // to anchor a session ref to. That is not a launch failure — the diff view
    // already treats an unborn base as "no diff" (mizraj_vcs::diff) — so skip
    // the ref and let the session start instead of tearing it down.
    if matches!(repo.head(), Err(ref err) if err.code() == mizraj_vcs::git2::ErrorCode::UnbornBranch)
    {
        return Ok(());
    }
    create_session_ref(&repo, session_id)
        .map_err(|err| SessionError::SessionRef(err.to_string()))?;
    Ok(())
}

async fn rollback_session_close(manager: &SessionManager, id: &SessionId, context: &str) {
    if let Err(close_err) = manager.session_close(id).await {
        tracing::warn!(
            session_id = id.as_str(),
            error = %close_err,
            context,
            "rollback session_close failed",
        );
    }
}

async fn session_create_inner<F>(
    manager: &SessionManager,
    binary: &str,
    cwd: String,
    colorfgbg: &str,
    sink_factory: F,
) -> Result<SessionId, SessionError>
where
    F: FnOnce(&SessionId, Sender<Vec<u8>>) -> Vec<Arc<dyn OutputSink>>,
{
    let binary_path = path::resolve(binary)?;
    let cwd_path = PathBuf::from(cwd);
    // Advertise the resolved terminal's light/dark polarity so a child that
    // reads COLORFGBG (rather than querying OSC 11) still picks the right theme.
    let env: HashMap<String, String> =
        HashMap::from([("COLORFGBG".to_string(), colorfgbg.to_string())]);

    let id = manager
        .create_session(binary_path, cwd_path.clone(), env, sink_factory)
        .await?;

    // Register the session ref so `diff_session` resolves later. If the cwd
    // isn't a git repo or the ref clashes, tear down the just-spawned PTY so the
    // diff view never sees a half-wired session. No DB row is written: the
    // `agent_sessions` table is never read (the diff resolves off the git ref),
    // so session launch no longer depends on the per-project progress.db.
    if let Err(err) = register_session_ref(&cwd_path, id.as_str()) {
        rollback_session_close(manager, &id, "after session_ref registration error").await;
        return Err(err);
    }

    Ok(id)
}

#[tauri::command]
pub async fn session_create<R: Runtime>(
    binary: String,
    cwd: String,
    // The frontend's resolved light/dark; absent (older callers) falls back to
    // dark inside `session_terminal_colors`. Drives the seeded theme colors and
    // COLORFGBG so a probing TUI detects the terminal the user actually sees.
    appearance: Option<String>,
    app: AppHandle<R>,
    manager: tauri::State<'_, SessionManager>,
) -> Result<SessionId, SessionError> {
    let scrollback_lines = crate::ghostty::scrollback_lines();
    let colors = crate::ghostty::session_terminal_colors(appearance.as_deref().unwrap_or("dark"));
    let colorfgbg = crate::ghostty::colorfgbg_for(colors.scheme);
    session_create_inner(&manager, &binary, cwd, colorfgbg, move |id, pty_input| {
        vec![
            Arc::new(TauriEventSink::new(app.clone(), id.clone())) as Arc<dyn OutputSink>,
            Arc::new(ActivitySink::new(app.clone(), id.clone())) as Arc<dyn OutputSink>,
            Arc::new(TermSink::new(
                app,
                id.clone(),
                pty_input,
                scrollback_lines,
                colors,
            )) as Arc<dyn OutputSink>,
        ]
    })
    .await
}

#[tauri::command]
pub async fn session_resize(
    session_id: SessionId,
    cols: u16,
    rows: u16,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.resize_session(&session_id, cols, rows).await
}

/// VT-encode a key press and write it to the session's PTY. The frontend sends
/// the raw `KeyboardEvent` fields (a [`KeyStroke`]); the backend encodes them
/// with libghostty against the session's live terminal modes, so arrows, Ctrl
/// combos and friends match what the running child expects. The key round-trips
/// to the child and its echo flows back through the normal sink path. Returns
/// `NotFound` for unknown sessions.
#[tauri::command]
pub async fn session_key(
    session_id: SessionId,
    stroke: KeyStroke,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.send_key(&session_id, stroke).await
}

#[tauri::command]
pub async fn session_close(
    session_id: SessionId,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.session_close(&session_id).await
}

/// Pull the session's current grid as a [`CellFrame`] (TP1). A pane invokes
/// this right after subscribing so it paints immediately — even when the
/// session has been idle — instead of staying blank until the next output.
#[tauri::command]
pub async fn session_get_frame(
    session_id: SessionId,
    manager: tauri::State<'_, SessionManager>,
) -> Result<CellFrame, SessionError> {
    manager.request_frame(&session_id).await
}

/// The user's preferred shell ($SHELL, with a platform fallback) — what the
/// frontend spawns for a plain terminal session, no agent involved.
#[tauri::command]
pub fn session_default_shell() -> String {
    path::default_shell()
}

/// Write raw UTF-8 bytes to the session's PTY, verbatim — the transport for
/// keybind-injected payloads (`text:`/`esc:` actions). Unlike `session_paste`
/// there is no encoding: the binding's bytes ARE the intended input.
#[tauri::command]
pub async fn session_write(
    session_id: SessionId,
    text: String,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.send_input(&session_id, text.into_bytes()).await
}

/// Reset the session's terminal emulator to boot state (Ghostty `reset`
/// keybind action). The child is untouched; the grid repaints fresh.
#[tauri::command]
pub async fn session_reset(
    session_id: SessionId,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.reset_terminal(&session_id).await
}

/// Where to scroll, in the wire shape: 'top' | 'bottom' | {'delta': rows} |
/// 'page_up' | 'page_down' (pages resolved against the live grid height by
/// the render thread's caller — here, using the manager's knowledge).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScrollRequestDto {
    Top,
    Bottom,
    Delta { rows: i64 },
    PageUp,
    PageDown,
}

/// Reposition the session's viewport over its scrollback (TP6). Page
/// requests scroll by one viewport height minus a context row.
#[tauri::command]
pub async fn session_scroll(
    session_id: SessionId,
    request: ScrollRequestDto,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    let to = match request {
        ScrollRequestDto::Top => ScrollViewport::Top,
        ScrollRequestDto::Bottom => ScrollViewport::Bottom,
        ScrollRequestDto::Delta { rows } => {
            // Saturate out-of-range i64 deltas to isize bounds instead of
            // silently dropping them to 0 — the scroll still goes the right way.
            ScrollViewport::Delta(isize::try_from(rows).unwrap_or(if rows < 0 {
                isize::MIN
            } else {
                isize::MAX
            }))
        }
        // The render thread knows the live height; a page is expressed as a
        // sentinel the sink resolves. Keep it simple: managers don't know the
        // grid, so pages ride as deltas of the DEFAULT grid? No — resolve in
        // the sink via terminal.rows() would need a new variant. The frontend
        // already knows its grid (it drives resize), so pages are sent as
        // deltas from there; these arms guard direct CLI/tooling calls.
        ScrollRequestDto::PageUp => {
            ScrollViewport::Delta(-(i32::from(crate::session::pty::DEFAULT_ROWS) as isize - 1))
        }
        ScrollRequestDto::PageDown => {
            ScrollViewport::Delta(i32::from(crate::session::pty::DEFAULT_ROWS) as isize - 1)
        }
    };
    manager.scroll(&session_id, to).await
}

/// Forward a mouse event (cell coordinates) to the session: encoded against
/// the live mouse-tracking mode on the render thread, dropped outside any
/// tracking mode (TP10).
#[tauri::command]
pub async fn session_mouse(
    session_id: SessionId,
    event: MouseEventDto,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.send_mouse(&session_id, event.into()).await
}

/// Paste text into the session: the terminal sink encodes it against the live
/// bracketed-paste mode (DEC 2004) and writes it to the PTY (TP7/TP8).
#[tauri::command]
pub async fn session_paste(
    session_id: SessionId,
    text: String,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.paste(&session_id, text.into_bytes()).await
}

/// Mark the session as watched by a frontend pane: the terminal sink resumes
/// emitting `agent:cells` frames (and pushes a catch-up frame if output arrived
/// while hidden). Returns `NotFound` for unknown sessions.
#[tauri::command]
pub async fn session_subscribe(
    session_id: SessionId,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.set_subscribed(&session_id, true).await
}

/// Mark the session as unwatched: the terminal sink stops snapshotting and
/// emitting frames while the grid keeps tracking output (TP3). Returns
/// `NotFound` for unknown sessions.
#[tauri::command]
pub async fn session_unsubscribe(
    session_id: SessionId,
    manager: tauri::State<'_, SessionManager>,
) -> Result<(), SessionError> {
    manager.set_subscribed(&session_id, false).await
}

#[cfg(test)]
mod tests {
    use tauri::async_runtime::block_on;

    use super::*;

    fn no_sinks(_: &SessionId, _: Sender<Vec<u8>>) -> Vec<Arc<dyn OutputSink>> {
        Vec::new()
    }

    #[test]
    fn returns_binary_not_found_when_binary_missing() {
        block_on(async {
            let manager = SessionManager::new();
            let err = session_create_inner(
                &manager,
                "nope-not-a-real-binary-xyz",
                "/tmp".to_string(),
                "15;0",
                no_sinks,
            )
            .await
            .expect_err("missing binary should fail");
            match err {
                SessionError::BinaryNotFound(name) => {
                    assert_eq!(name, "nope-not-a-real-binary-xyz");
                }
                other => panic!("expected BinaryNotFound, got {other:?}"),
            }
            assert!(
                manager.list_sessions().await.is_empty(),
                "a failed spawn must not register a session"
            );
        });
    }

    #[test]
    fn binary_not_found_serializes_with_typed_kind() {
        let err = SessionError::BinaryNotFound("claude".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"binary_not_found","binary":"claude"}"#);
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use std::fs;
        use std::path::Path;

        use mizraj_vcs::git2::{Repository, RepositoryInitOptions, Signature};
        use tempfile::TempDir;

        use super::*;

        fn init_repo_with_commit(path: &Path) -> Repository {
            let mut opts = RepositoryInitOptions::new();
            opts.external_template(false);
            opts.initial_head("main");
            let repo = Repository::init_opts(path, &opts).expect("init fixture repo");

            let sig = Signature::now("Test", "test@example.com").expect("signature");
            {
                let tree_id = {
                    let mut index = repo.index().expect("index");
                    index.write_tree().expect("write_tree")
                };
                let tree = repo.find_tree(tree_id).expect("find_tree");
                repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                    .expect("initial commit");
            }
            repo
        }

        #[test]
        fn spawns_session_and_registers_session_ref() {
            block_on(async {
                let manager = SessionManager::new();
                let dir = TempDir::new().expect("tempdir");
                init_repo_with_commit(dir.path());

                let id = session_create_inner(
                    &manager,
                    "sh",
                    dir.path().to_string_lossy().into_owned(),
                    "15;0",
                    no_sinks,
                )
                .await
                .expect("session_create with /bin/sh should succeed");

                assert_eq!(id.as_str().len(), 26);
                assert!(manager.list_sessions().await.contains(&id));

                let repo = repo_open(dir.path()).expect("repo_open");
                let ref_name = format!("refs/mizraj/sessions/{}", id.as_str());
                repo.find_reference(&ref_name)
                    .expect("session ref should exist after session_create");
            });
        }

        #[test]
        fn starts_session_in_an_unborn_repo_without_a_ref() {
            block_on(async {
                let manager = SessionManager::new();
                let dir = TempDir::new().expect("tempdir");
                // A freshly-init'd repo with no commits: HEAD is unborn, so there
                // is no commit to anchor a session ref to.
                let mut opts = RepositoryInitOptions::new();
                opts.external_template(false);
                Repository::init_opts(dir.path(), &opts).expect("init unborn repo");

                let id = session_create_inner(
                    &manager,
                    "sh",
                    dir.path().to_string_lossy().into_owned(),
                    "15;0",
                    no_sinks,
                )
                .await
                .expect("session should start in an unborn repo, not roll back");

                assert!(manager.list_sessions().await.contains(&id));

                let repo = repo_open(dir.path()).expect("repo_open");
                assert!(
                    repo.references_glob("refs/mizraj/sessions/*")
                        .expect("glob")
                        .names()
                        .next()
                        .is_none(),
                    "an unborn repo should start the session without a ref",
                );
            });
        }

        #[test]
        fn rolls_back_spawn_when_cwd_is_not_a_git_repo() {
            block_on(async {
                let manager = SessionManager::new();
                let dir = TempDir::new().expect("tempdir");
                fs::write(dir.path().join("not-a-repo"), b"").expect("write marker");

                let err = session_create_inner(
                    &manager,
                    "sh",
                    dir.path().to_string_lossy().into_owned(),
                    "15;0",
                    no_sinks,
                )
                .await
                .expect_err("non-repo cwd must fail");

                match err {
                    SessionError::SessionRef(_) => {}
                    other => panic!("expected SessionRef, got {other:?}"),
                }

                // Roll back happened: the PTY is torn down, registry is empty.
                assert!(
                    manager.list_sessions().await.is_empty(),
                    "session must be unregistered after ref failure"
                );
            });
        }
    }
}
