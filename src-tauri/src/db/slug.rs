//! Per-project storage location: deriving a stable slug from a repository and
//! mapping it to the project's `progress.db` path. Pure path/URL logic, kept
//! apart from the connection-pool cache in the parent module.
use std::path::{Path, PathBuf};

use mizraj_vcs::{origin_url, repo_open};

/// Resolve the per-project progress database path:
/// `$HOME/Mizraj/<slug>/progress.db`, where `<slug>` identifies the active
/// project (see [`repo_slug`]).
/// The directory `Mizraj/<slug>/progress.db` is rooted at: the resolved home,
/// or `fallback` when home is unresolved OR empty. Pure (inputs injected) so the
/// "never a relative path" guarantee is testable. An empty home is treated as
/// unresolved — `home_dir().unwrap_or_default()` used to return `""` on a
/// no-`$HOME` launch, rooting the DB at a relative path (the process CWD).
fn db_base(home: Option<PathBuf>, fallback: PathBuf) -> PathBuf {
    match home {
        Some(home) if !home.as_os_str().is_empty() => home,
        _ => fallback,
    }
}

pub(super) fn progress_db_path(slug: &str) -> PathBuf {
    // `home_dir()` reads `$HOME`, then falls back to the passwd database
    // (getpwuid) so a Finder/launchd launch with no `$HOME` still resolves.
    let home = std::env::home_dir().filter(|home| !home.as_os_str().is_empty());
    if home.is_none() {
        // Both `$HOME` and the passwd lookup failed: keep the DB at an absolute
        // location (the temp dir) rather than a CWD-relative path, and say so —
        // project data may not persist, but it never silently lands under `/`.
        tracing::error!(
            "home dir unresolved ($HOME unset and passwd lookup failed); \
             progress.db falls back to the temp dir and may not persist"
        );
    }
    let base = db_base(home, std::env::temp_dir());
    base.join("Mizraj").join(slug).join("progress.db")
}

/// Derive a stable slug for `repo_path`: the last segment of the `origin` remote
/// URL with any `.git` suffix stripped, falling back to the git work tree's
/// directory name, and finally to the passed path's own name. The slug keeps its
/// source casing verbatim, so `~/Mizraj/<slug>/progress.db` mirrors the
/// repository's own name exactly.
pub(super) fn repo_slug(repo_path: &Path) -> String {
    if let Ok(repo) = repo_open(repo_path) {
        if let Ok(Some(url)) = origin_url(&repo) {
            if let Some(slug) = slug_from_remote_url(&url) {
                return slug;
            }
        }
        if let Some(name) = repo.workdir().and_then(dir_name) {
            return name;
        }
    }
    dir_name(repo_path).unwrap_or_else(|| "default".to_string())
}

/// Extract `<repo>` from a remote URL like `git@host:owner/repo.git` or
/// `https://host/owner/repo.git`: the last `/`- or `:`-separated segment with a
/// trailing `.git` removed. Returns `None` when the result is empty.
fn slug_from_remote_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next()?;
    let slug = last.strip_suffix(".git").unwrap_or(last);
    (!slug.is_empty()).then(|| slug.to_string())
}

fn dir_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn slug_from_https_url_strips_dot_git() {
        assert_eq!(
            slug_from_remote_url("https://github.com/NextNodeSolutions/mizraj.git"),
            Some("mizraj".to_string())
        );
    }

    #[test]
    fn slug_from_scp_url_strips_dot_git() {
        assert_eq!(
            slug_from_remote_url("git@github.com:NextNodeSolutions/mizraj.git"),
            Some("mizraj".to_string())
        );
    }

    #[test]
    fn slug_keeps_url_without_dot_git_and_ignores_trailing_slash() {
        assert_eq!(
            slug_from_remote_url("https://example.com/owner/my-repo/"),
            Some("my-repo".to_string())
        );
    }

    #[test]
    fn slug_is_none_for_empty_url() {
        assert_eq!(slug_from_remote_url(""), None);
        assert_eq!(slug_from_remote_url("   "), None);
    }

    #[test]
    fn repo_slug_falls_back_to_directory_name_without_a_remote() {
        let tmp = tempdir().expect("tempdir");
        let project = tmp.path().join("lonely-project");
        std::fs::create_dir(&project).expect("create project dir");

        assert_eq!(repo_slug(&project), "lonely-project");
    }

    #[test]
    fn repo_slug_preserves_the_resolved_name_casing() {
        let tmp = tempdir().expect("tempdir");
        let project = tmp.path().join("Mizraj");
        std::fs::create_dir(&project).expect("create project dir");

        assert_eq!(repo_slug(&project), "Mizraj");
    }

    #[test]
    fn progress_db_path_lives_under_home_mizraj_slug() {
        let path = progress_db_path("mizraj");
        assert!(path.ends_with("Mizraj/mizraj/progress.db"));
    }

    #[test]
    fn db_base_prefers_a_resolved_home() {
        assert_eq!(
            db_base(Some(PathBuf::from("/Users/x")), PathBuf::from("/tmp")),
            PathBuf::from("/Users/x")
        );
    }

    #[test]
    fn db_base_falls_back_to_the_absolute_path_when_home_is_unresolved() {
        let fallback = PathBuf::from("/var/folders/tmp");
        assert_eq!(db_base(None, fallback.clone()), fallback);
    }

    #[test]
    fn db_base_treats_an_empty_home_as_unresolved_so_the_path_stays_absolute() {
        // The original `home_dir().unwrap_or_default()` yielded an EMPTY home on
        // a no-$HOME launch, rooting progress.db at a *relative* path (the CWD).
        let fallback = PathBuf::from("/var/folders/tmp");
        assert_eq!(db_base(Some(PathBuf::new()), fallback.clone()), fallback);
    }
}
