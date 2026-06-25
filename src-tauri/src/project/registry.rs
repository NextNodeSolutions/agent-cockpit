//! Registry of known repositories, persisted as JSON in the app-data dir.
//! The registry is the single source of truth for "which repos does the app
//! know about" (MP4): Mission Control lists them even without live sessions.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// The registry as Tauri managed state: one process-wide list, persisted on
/// every mutation.
pub struct SharedRegistry(Mutex<Registry>);

impl SharedRegistry {
    pub fn new(registry: Registry) -> Self {
        Self(Mutex::new(registry))
    }

    pub fn list(&self) -> Vec<PathBuf> {
        self.lock().list()
    }

    pub fn missing(&self) -> Vec<PathBuf> {
        self.lock().missing()
    }

    pub fn add(&self, path: PathBuf) -> Result<bool, String> {
        self.lock().add(path)
    }

    pub fn remove(&self, path: &Path) -> Result<(), String> {
        self.lock().remove(path)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[tauri::command]
pub fn projects_list(registry: tauri::State<'_, SharedRegistry>) -> Vec<String> {
    registry
        .list()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Registered repos whose path no longer resolves to a directory on disk:
/// folders the user moved or deleted. The picker shows them as "introuvable"
/// so they can be pruned from the pool — listing them is the only way the user
/// learns the registry drifted from reality.
#[tauri::command]
pub fn projects_missing(registry: tauri::State<'_, SharedRegistry>) -> Vec<String> {
    registry
        .missing()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn projects_add(
    repo_path: String,
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRegistry>,
    watchers: tauri::State<'_, super::watcher::RepoWatchers>,
) -> Result<String, String> {
    let canonical = super::validate_repo_for_registration(&repo_path)?;
    if registry.add(canonical.clone())? {
        super::watcher::watch_and_emit(&watchers, &app, &canonical);
    }
    Ok(canonical.to_string_lossy().into_owned())
}

/// The path to remove from the registry: the canonical form while the directory
/// still resolves, else the raw trimmed path. A repo registered canonically and
/// then deleted/moved can no longer be canonicalized, so falling back to the raw
/// path (which the frontend passes in canonical form) keeps it removable instead
/// of stranding a dead entry.
fn removal_key(repo_path: &str) -> PathBuf {
    super::validate_repo_path(repo_path).unwrap_or_else(|_| PathBuf::from(repo_path.trim()))
}

#[tauri::command]
pub async fn projects_remove(
    repo_path: String,
    registry: tauri::State<'_, SharedRegistry>,
    db: tauri::State<'_, crate::db::Db>,
    watchers: tauri::State<'_, super::watcher::RepoWatchers>,
) -> Result<(), String> {
    // removal_key matches `add`'s canonicalization so the teardown keys line up
    // with what was registered, falling back to the raw path when the directory
    // has vanished. canonicalize() is blocking, so run it off the async worker.
    let canonical = tauri::async_runtime::spawn_blocking(move || removal_key(&repo_path))
        .await
        .map_err(|err| format!("canonicalize task failed: {err}"))?;
    let path = canonical.as_path();
    // Teardown FIRST — both steps are infallible. Running them before the
    // persistable registry mutation means a later persist failure can never
    // strand a live watcher or open pool.
    watchers.unwatch(path);
    db.close_for(path).await;
    // Persist the registry removal last; an error here surfaces to the caller
    // but leaves nothing live behind.
    registry.remove(path)?;
    Ok(())
}

#[derive(Debug)]
pub struct Registry {
    file_path: PathBuf,
    projects: Vec<PathBuf>,
}

impl Registry {
    /// Load the registry from `file_path`; a missing file is an empty registry.
    ///
    /// A *corrupt* file (interrupted write, sync-client conflict) must not brick
    /// launch: setup propagates a load error all the way to `exit(1)` with no
    /// window. An absent file already means "empty registry", so an unparseable
    /// one is treated the same — but quarantined first (see [`quarantine_corrupt`])
    /// so the user's project list is preserved for diagnostics, never silently lost.
    pub fn load(file_path: &Path) -> Result<Self, String> {
        let projects = match std::fs::read_to_string(file_path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(projects) => projects,
                Err(err) => {
                    quarantine_corrupt(file_path, &err);
                    Vec::new()
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(err) => return Err(format!("read {}: {err}", file_path.display())),
        };
        Ok(Self {
            file_path: file_path.to_path_buf(),
            projects,
        })
    }

    pub fn list(&self) -> Vec<PathBuf> {
        self.projects.clone()
    }

    /// Registered paths that no longer resolve to a directory on disk, in
    /// registration order. A repo that was deleted or moved lands here.
    pub fn missing(&self) -> Vec<PathBuf> {
        self.projects
            .iter()
            .filter(|path| !path.is_dir())
            .cloned()
            .collect()
    }

    /// Register `path`, persist, and report whether it was newly added.
    pub fn add(&mut self, path: PathBuf) -> Result<bool, String> {
        if self.projects.contains(&path) {
            return Ok(false);
        }
        self.projects.push(path);
        self.persist()?;
        Ok(true)
    }

    /// Forget `path` and persist; removing an unknown path is a no-op.
    pub fn remove(&mut self, path: &Path) -> Result<(), String> {
        let before = self.projects.len();
        self.projects.retain(|known| known != path);
        if self.projects.len() == before {
            return Ok(());
        }
        self.persist()
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("create {}: {err}", parent.display()))?;
        }
        let raw = serde_json::to_string_pretty(&self.projects)
            .map_err(|err| format!("serialize registry: {err}"))?;
        // Write-then-rename so an interrupted write (power loss, OOM kill, a
        // sync client) can never leave a half-written registry that aborts the
        // next launch: rename is atomic within a filesystem, so a reader sees
        // either the old file or the complete new one, never a torn one.
        let tmp = self.file_path.with_extension("json.tmp");
        std::fs::write(&tmp, raw).map_err(|err| format!("write {}: {err}", tmp.display()))?;
        std::fs::rename(&tmp, &self.file_path).map_err(|err| {
            format!(
                "rename {} -> {}: {err}",
                tmp.display(),
                self.file_path.display()
            )
        })
    }
}

/// Move an unparseable registry aside to `<file>.corrupt.<unix_millis>` so a
/// launch proceeds with an empty registry while preserving the bad file for
/// diagnostics. Best-effort: a failed rename is logged, never fatal.
fn quarantine_corrupt(file_path: &Path, err: &serde_json::Error) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let mut backup = file_path.as_os_str().to_owned();
    backup.push(format!(".corrupt.{stamp}"));
    let backup = PathBuf::from(backup);
    match std::fs::rename(file_path, &backup) {
        Ok(()) => tracing::warn!(
            error = %err,
            backup = %backup.display(),
            "project registry was corrupt; quarantined it and started empty"
        ),
        Err(rename_err) => tracing::error!(
            error = %err,
            rename_error = %rename_err,
            "project registry was corrupt and could not be quarantined; started empty"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_a_known_project_reports_false_and_keeps_one_entry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");

        let mut registry = Registry::load(&file).expect("load empty");
        assert!(registry.add(PathBuf::from("/tmp/repo-a")).expect("first"));
        assert!(!registry.add(PathBuf::from("/tmp/repo-a")).expect("second"));
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn a_corrupt_file_loads_empty_and_is_quarantined_not_wiped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");
        std::fs::write(&file, "not json").expect("write corrupt file");

        // Launch must survive a corrupt registry: load succeeds, empty.
        let registry = Registry::load(&file).expect("corrupt file must not fail load");
        assert!(registry.list().is_empty());

        // The bad file is preserved (quarantined), not silently destroyed.
        let quarantined: Vec<_> = std::fs::read_dir(dir.path())
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("projects.json.corrupt."))
            .collect();
        assert_eq!(quarantined.len(), 1, "expected one quarantine file");
        // The original path is freed so the next persist writes a clean file.
        assert!(!file.exists(), "corrupt file should have been moved aside");
    }

    #[test]
    fn remove_forgets_the_project_durably() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");

        let mut registry = Registry::load(&file).expect("load empty");
        registry.add(PathBuf::from("/tmp/repo-a")).expect("add a");
        registry.add(PathBuf::from("/tmp/repo-b")).expect("add b");
        registry.remove(Path::new("/tmp/repo-a")).expect("remove a");

        let reloaded = Registry::load(&file).expect("reload");
        assert_eq!(reloaded.list(), vec![PathBuf::from("/tmp/repo-b")]);
    }

    #[test]
    fn missing_reports_only_paths_absent_from_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");
        let live = dir.path().join("live");
        std::fs::create_dir(&live).expect("mkdir live");

        let mut registry = Registry::load(&file).expect("load empty");
        registry.add(live.clone()).expect("add live");
        registry
            .add(PathBuf::from("/tmp/mizraj/definitely-gone"))
            .expect("add gone");

        assert_eq!(
            registry.missing(),
            vec![PathBuf::from("/tmp/mizraj/definitely-gone")],
        );
    }

    #[test]
    fn removal_key_canonicalizes_an_existing_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let raw = dir.path().to_string_lossy().to_string();

        let key = removal_key(&raw);

        assert!(key.is_dir());
        assert_eq!(key, dir.path().canonicalize().expect("canonicalize"));
    }

    #[test]
    fn removal_key_falls_back_to_the_raw_trimmed_path_when_the_dir_is_gone() {
        // The directory existed at registration but is gone now: canonicalize
        // fails, so the raw trimmed path is used.
        let key = removal_key("  /tmp/mizraj/definitely-gone-xyz  ");

        assert_eq!(key, PathBuf::from("/tmp/mizraj/definitely-gone-xyz"));
    }

    #[test]
    fn a_canonically_registered_repo_is_removable_after_its_dir_vanishes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");
        // Mimic a repo registered while it existed (stored as an absolute path)
        // whose directory was later deleted — canonicalize would now fail.
        let gone = "/tmp/mizraj/removable-gone-xyz";

        let mut registry = Registry::load(&file).expect("load");
        registry.add(PathBuf::from(gone)).expect("add");

        // The fallback key must still match the stored entry so the removal lands.
        registry.remove(&removal_key(gone)).expect("remove");

        assert!(Registry::load(&file).expect("reload").list().is_empty());
    }

    #[test]
    fn added_projects_survive_a_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");

        let mut registry = Registry::load(&file).expect("load empty");
        registry
            .add(PathBuf::from("/tmp/repo-a"))
            .expect("add repo-a");

        let reloaded = Registry::load(&file).expect("reload");
        assert_eq!(reloaded.list(), vec![PathBuf::from("/tmp/repo-a")]);
    }
}
