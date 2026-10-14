# Per-repo MemPalace wings (2026-07-30)

## Problem
Wing was `basename(project).toLowerCase()` only.  
`C:\SPTS` and `C:\Users\alper\SPTS` both used wing **`spts`** → shared drawers / wrong memory.

## Fix
`electron/main/memory-wing.ts`:  
`wing = {sanitized-basename}-{sha256(normalized-path)[:8]}`  
e.g. `spts-a1b2c3d4` vs `spts-e5f6g7h8`.

Used by mine, wake-up, auto-context, `TRUEDECK_MEMORY_WING`, mempalace ensure.

The Rust backend uses the same SHA-256 suffix (`crates/truedeck-backend/src/memory/mod.rs`). An older FNV suffix filed a different wing and must not be used. `mempalace.yaml` in each checkout records that wing so a bare `mempalace mine` stays on it.

## Note
Old shared wing `spts` remains in the palace with historical data; new checkouts get a fresh wing and re-mine.
