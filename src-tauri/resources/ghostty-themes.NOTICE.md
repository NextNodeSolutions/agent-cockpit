# Vendored Ghostty themes

`ghostty-themes/` is the Ghostty named-theme corpus, vendored verbatim so mizraj
resolves `theme = <name>` directives in a user's Ghostty config without needing
an external Ghostty install. Mizraj is self-contained: it must not depend on
`/Applications/Ghostty.app` or any user-installed tool.

- **Source**: `ghostty-themes-release-20260511-160054-2671288.tgz` — the exact
  `iterm2_themes` lazy dependency pinned in Ghostty's `build.zig.zon` at the
  commit mizraj's bundled `libghostty` tracks
  (`crates/mizraj-term-sys/vendor/VERSION` → `d5d8cef4…`). This guarantees the
  theme corpus is **1:1** with the renderer.
- **Upstream**: themes originate from
  [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes)
  (MIT), converted to Ghostty's config format.

## Updating

Re-vendor whenever `crates/mizraj-term-sys/vendor/VERSION` moves: read the new
`iterm2_themes` URL from that Ghostty commit's `build.zig.zon`, download the
tarball, and replace `ghostty-themes/` with its `ghostty/` contents (drop `.md`).
