# mizraj

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)](LICENSE)

## What

A desktop cockpit for orchestrating Claude Code agents across projects — a local-first Tauri app that surfaces sessions, plans, and backlogs in one place.

## Status

Pre-alpha. Public for transparency; no support, no guarantees, no SLA. Issues and PRs may be ignored.

## Install (macOS)

Release builds are **ad-hoc signed but not notarized** (no Apple Developer ID).
macOS quarantines them on download and shows an *"unidentified developer"*
prompt on first launch. Drag **Mizraj.app** into **Applications**, then either:

- **No Terminal:** double-click it once (the launch is blocked), then open
  **System Settings → Privacy & Security**, scroll down and click **Open
  Anyway**. macOS remembers the choice after that.
- **One-liner:** clear the quarantine flag so it opens directly:

  ```sh
  xattr -dr com.apple.quarantine /Applications/Mizraj.app
  ```

The required `libghostty-vt` native library is bundled inside the `.app`
(`Contents/Frameworks/`), so there is nothing else to install.

## Plan

See [`docs/plans/2026-05-15-mizraj.html`](docs/plans/2026-05-15-mizraj.html) for the current build plan.

## License

[AGPL-3.0-only](LICENSE).
