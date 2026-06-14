#!/usr/bin/env bash
#
# setup-libghostty.sh — build libghostty-vt from source for local dev.
#
# Why this exists: `crates/mizraj-term-sys` links against
# libghostty-vt at build time via the LIBGHOSTTY_LIB_DIR env var. Upstream
# ships no per-commit prebuilt dylib, so we build it from the exact pinned
# ghostty commit (the same SHA our vendored headers track).
#
# This is a DEV convenience for `pnpm dev`. The reproducible CI build + the
# bundling of the dylib into the packaged .app are a separate, planned track;
# this script is intentionally a one-shot local unblock, not that pipeline.
#
# Usage:
#   ./scripts/setup-libghostty.sh           # build + install, print export line
#   eval "$(./scripts/setup-libghostty.sh --print-env)"   # build + export in shell
#
# After running once, add the printed line to your shell rc (or use direnv).

set -euo pipefail

# --- Resolve repo paths ------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TERM_SYS_DIR="$REPO_ROOT/crates/mizraj-term-sys"
VERSION_FILE="$TERM_SYS_DIR/vendor/VERSION"

# Build artifacts live OUTSIDE the repo (heavy, machine-specific); the final
# dylib is copied INTO target/ (gitignored) where build.rs can find it.
WORK_DIR="${LIBGHOSTTY_WORK_DIR:-$HOME/.cache/mizraj/libghostty}"
INSTALL_DIR="$REPO_ROOT/target/libghostty"

# Ghostty pins a strict Zig version in build.zig.zon via requireZig: the running
# Zig's minor must EQUAL the pin's (0.16 is rejected; only 0.15.x with patch >= 2
# is accepted). As of the pinned commit this is 0.15.2 — bump here only when the
# ghostty pin moves and you've checked the new build.zig.zon. A mismatched Zig
# fails the build loudly, not silently.
ZIG_VERSION="${ZIG_VERSION:-0.15.2}"

log() { printf '\033[1;36m[libghostty]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[libghostty] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
# version_ge A B → success (exit 0) iff version A >= version B (dotted, e.g. 26.4).
version_ge() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }

PRINT_ENV=0
[ "${1:-}" = "--print-env" ] && PRINT_ENV=1

# --- Read the pinned ghostty commit ------------------------------------------
[ -f "$VERSION_FILE" ] || die "pin file not found: $VERSION_FILE"
GHOSTTY_SHA="$(tr -d '[:space:]' < "$VERSION_FILE")"
[ -n "$GHOSTTY_SHA" ] || die "empty pin in $VERSION_FILE"
log "pinned ghostty commit: $GHOSTTY_SHA"

# --- Ensure Zig --------------------------------------------------------------
# Ghostty needs the exact pinned Zig; a system/brew Zig of another version will
# break. We fetch the official toolchain into the work dir if absent.
ZIG_DIR="$WORK_DIR/zig-$ZIG_VERSION"
ZIG_BIN="$ZIG_DIR/zig"
if [ ! -x "$ZIG_BIN" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) ZIG_ARCH="aarch64-macos" ;;
    Darwin-x86_64) ZIG_ARCH="x86_64-macos" ;;
    Linux-x86_64) ZIG_ARCH="x86_64-linux" ;;
    Linux-aarch64) ZIG_ARCH="aarch64-linux" ;;
    *) die "unsupported platform: $(uname -s)-$(uname -m)" ;;
  esac
  ZIG_TARBALL="zig-${ZIG_ARCH}-${ZIG_VERSION}.tar.xz"
  ZIG_URL="https://ziglang.org/download/${ZIG_VERSION}/${ZIG_TARBALL}"
  log "downloading Zig ${ZIG_VERSION} (${ZIG_ARCH}) — this needs network"
  mkdir -p "$WORK_DIR"
  curl -sSfL "$ZIG_URL" -o "$WORK_DIR/$ZIG_TARBALL" || die "Zig download failed: $ZIG_URL"
  tar -xf "$WORK_DIR/$ZIG_TARBALL" -C "$WORK_DIR"
  mv "$WORK_DIR/zig-${ZIG_ARCH}-${ZIG_VERSION}" "$ZIG_DIR"
  rm -f "$WORK_DIR/$ZIG_TARBALL"
fi
log "using zig: $($ZIG_BIN version)"

# --- Clone ghostty at the pinned commit --------------------------------------
GHOSTTY_SRC="$WORK_DIR/ghostty"
if [ ! -d "$GHOSTTY_SRC/.git" ]; then
  log "cloning ghostty — this needs network"
  git clone --filter=blob:none https://github.com/ghostty-org/ghostty.git "$GHOSTTY_SRC"
fi
git -C "$GHOSTTY_SRC" fetch --depth 1 origin "$GHOSTTY_SHA" 2>/dev/null || true
git -C "$GHOSTTY_SRC" checkout -q "$GHOSTTY_SHA" || die "cannot check out $GHOSTTY_SHA"
log "ghostty checked out at $(git -C "$GHOSTTY_SRC" rev-parse --short HEAD)"

# --- Build libghostty-vt -----------------------------------------------------
# libghostty-vt depends only on libc, so this is a plain release build. The
# artifact lands under PREFIX/lib as libghostty-vt.dylib (name "ghostty-vt").
PREFIX="$WORK_DIR/prefix"
rm -rf "$PREFIX"

# PREREQUISITE on macOS (ziglang/zig#31658): the released Zig 0.15.2 binary —
# the version ghostty's 0.15.x pin requires — cannot link against the macOS 26.4
# SDK (Command Line Tools / Xcode 26.4): its libSystem.tbd carries arm64e entries
# that aarch64-macos doesn't match, so every libc symbol comes up undefined. The
# fix (PR #31673) landed on Zig's 0.15.x branch but was never cut as a release
# binary, and ghostty's requireZig rejects 0.16, so bumping Zig is not an option
# until ghostty rolls forward. Resolution: build against a pre-26.4 SDK (Command
# Line Tools / Xcode 26.3 or earlier — xcode-select / developer.apple.com). With
# a pre-26.4 SDK active, the build below is a plain native build. CI does exactly
# the same: it selects Xcode 26.3 on macos-26 (.github/workflows/release.yml).
#
# Guard: rather than fail with a wall of "undefined symbol" libc errors when the
# active SDK is >= 26.4 (the default on an up-to-date Mac), detect that and point
# Zig at any installed pre-26.4 macOS SDK via SDKROOT — which may be the default
# of no toolchain (here the active dir's default is 26.x, but an older SDK lingers
# beside it). Stop with an actionable message if none exists. A caller-set SDKROOT
# is honored as-is, and an active SDK < 26.4 is left untouched.
sdk_version_of() { plutil -extract Version raw "$1/SDKSettings.plist" 2>/dev/null || true; }
if [ "$(uname -s)" = "Darwin" ] && [ -z "${SDKROOT:-}" ]; then
  ACTIVE_SDK="$(sdk_version_of "$(xcrun --show-sdk-path 2>/dev/null || true)")"
  if [ -n "$ACTIVE_SDK" ] && version_ge "$ACTIVE_SDK" "26.4"; then
    PICKED_SDK=""; PICKED_VER=""
    for cand in \
      /Library/Developer/CommandLineTools/SDKs/MacOSX*.sdk \
      /Applications/Xcode*.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX*.sdk; do
      [ -e "$cand/SDKSettings.plist" ] || continue
      v="$(sdk_version_of "$cand")"
      { [ -z "$v" ] || version_ge "$v" "26.4"; } && continue   # skip empty / broken (>=26.4)
      if [ -z "$PICKED_VER" ] || version_ge "$v" "$PICKED_VER"; then  # keep the highest pre-26.4
        PICKED_SDK="$cand"; PICKED_VER="$v"
      fi
    done
    if [ -n "$PICKED_SDK" ]; then
      export SDKROOT="$PICKED_SDK"
      log "active macOS SDK $ACTIVE_SDK cannot link with Zig $ZIG_VERSION (ziglang/zig#31658); using pre-26.4 SDK $PICKED_VER ($PICKED_SDK)"
    else
      die "active macOS SDK $ACTIVE_SDK >= 26.4 cannot link with Zig $ZIG_VERSION (ziglang/zig#31658) and no pre-26.4 SDK was found. Install one (e.g. 'xcodes install 26.3', or older Command Line Tools), then re-run."
    fi
  fi
fi

log "building libghostty-vt (zig build -Demit-lib-vt) — slow on first run"
# The build emits the dylib early, then a final `install` step assembles an
# .xcframework via `xcodebuild` — which needs full Xcode, not just the Command
# Line Tools. That step failing is expected and harmless here: we only need the
# dylib, which is already in PREFIX/lib by then. So don't abort on the build's
# exit code; verify the artifact below instead.
( cd "$GHOSTTY_SRC" && "$ZIG_BIN" build -Demit-lib-vt -Doptimize=ReleaseFast --prefix "$PREFIX" ) || \
  log "zig build returned non-zero (likely the Xcode-only xcframework step); checking for the dylib anyway"

case "$(uname -s)" in
  Darwin) DYLIB_EXT="dylib" ;;
  Linux) DYLIB_EXT="so" ;;
  *) die "unsupported OS for dylib copy" ;;
esac
# Zig installs the dylib with its version in the name (libghostty-vt.0.1.0.dylib)
# and may or may not symlink the unversioned name depending on how far the failed
# install step got. Pick the unversioned one if present, else the newest match.
SRC_LIB="$PREFIX/lib/libghostty-vt.$DYLIB_EXT"
if [ ! -f "$SRC_LIB" ]; then
  SRC_LIB="$(ls -1 "$PREFIX"/lib/libghostty-vt*."$DYLIB_EXT" 2>/dev/null | head -1)"
fi
[ -n "$SRC_LIB" ] && [ -f "$SRC_LIB" ] || die "no libghostty-vt.$DYLIB_EXT under $PREFIX/lib"

# --- Install under target/ with the name build.rs expects --------------------
# build.rs links `-lghostty` and looks for `libghostty.<ext>`, but the upstream
# artifact is `libghostty-vt.<ext>`. Copy it under the expected name AND fix the
# dylib's own install_name so the @rpath lookup resolves at runtime (the embed
# default would otherwise reference libghostty-vt).
mkdir -p "$INSTALL_DIR"
DST_LIB="$INSTALL_DIR/libghostty.$DYLIB_EXT"
cp -f "$SRC_LIB" "$DST_LIB"
if [ "$DYLIB_EXT" = "dylib" ]; then
  install_name_tool -id "@rpath/libghostty.dylib" "$DST_LIB"
fi
log "installed: $DST_LIB"

# --- Emit the env the build needs --------------------------------------------
EXPORT_LINE="export LIBGHOSTTY_LIB_DIR=\"$INSTALL_DIR\""
if [ "$PRINT_ENV" = "1" ]; then
  printf '%s\n' "$EXPORT_LINE"
else
  log "done. Add this to your shell (or run: eval \"\$(./scripts/setup-libghostty.sh --print-env)\"):"
  printf '\n    %s\n\n' "$EXPORT_LINE"
fi
