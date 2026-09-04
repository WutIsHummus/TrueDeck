# CI packaging + macOS releases (2026-07-31)

## Enabled
- `.github/workflows/release.yml` packages **Windows x64**, **macOS arm64**, **macOS x64**
- Builds Rust `truedeck-backend` per OS/arch into `resources/bin` before electron-builder
- Tag `v*` or `workflow_dispatch` with `release_tag` publishes assets
- CI package smoke on master push (win + mac arm64)

## Mac notes
- Unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- x64 built on `macos-latest` via cross-compile (avoid macos-13 queues)
- First open: right-click Open or `xattr -cr /Applications/TrueDeck.app`
- Release assets: **installers only** (`.exe` / `.dmg`) — no zip, blockmap, or latest.yml clutter

## Scripts
- `npm run dist:mac` / `dist:linux` / `dist:win`
