# Session / multi-pane layout persistence

**Symptom:** Pane groups and terminal tabs not restored correctly after restart.

## Root causes fixed (2026-07)

### Round 1
1. Async `persistSessions` on quit often never finished — added `persistSessionsSync` (sendSync).
2. Main process appended orphan live PTYs to `sessionOrder`, desyncing `paneTree` indices.
3. Restore did not remap `paneTree` when some tabs failed to respawn (middle index drop collapsed splits wrong).
4. `focusedGroupTabIndex` / `activeIndex` not remapped after compact.
5. Renderer now sends explicit `tabs[]` metadata aligned with `sessionOrder`.

### Round 2 (2026-07-28) — Rust backend gap
6. **UI spawn prefers `truedeck-backend`**, but `layoutFromPersistSnapshot` required each tab to exist in `ptyManager.list()`. Rust-owned sessions never matched → **every tab dropped** → empty/partial `session-layout.json` and multi-pane lost.
7. Rust `SessionLayout` model has no `paneTree` / `focusedGroupTabIndex`; `layout.get`/`layout.save` via rustCall would strip multi-pane. Layout I/O is **TS-only** now.
8. `listLiveSessions()` merges rust + ptyManager for openProject dedupe and restore reuse.
9. Renderer `tabs[]` is authoritative when present; close path also calls `window.__truedeckFlushSessions`.

**Disk file:** `%APPDATA%/truedeck/data/session-layout.json`
**Key files:** `electron/main/session-layout.ts`, `electron/main/index.ts` (sessions:persist/restore), `src/App.tsx` (buildPersistSnapshot)

### Round 3 (2026-07-28) — pane frame positions lost on quit
10. Window close used fire-and-forget executeJavaScript for layout flush — process often exited before paneTree write. Now **preventDefault + await flush + re-close**.
11. Debounced persist (200–350ms) + React-stale snapshot after split/resize: dock/split/merge/gutter now call persistLayoutSnapshot(next) with the **next** tree immediately (sync IPC).
12. Project filter uses sameProjectRoot (Windows path casing) so multi-pane display does not empty incorrectly.

### Round 4 (2026-08-01) — empty UI after reopen (packaged exe)
13. `sessions:restore` skipped all PTY respawn unless `TRUEDECK_RESTORE_PTYS=1` (Windows freeze band-aid). Packaged exe users never set that → layout saved but tabs never came back. **Default is restore on again**; opt out with `TRUEDECK_RESTORE_PTYS=0`. Caps remain: active project only, sequential ConPTY + delay.

### Round 5 (2026-08-01) — minimize + multi-agent identity
14. **Minimized tabs**: `uiMinimized` persisted on `SavedSessionTab`; position stays in `paneTree` (membership tree no longer collapses minimized out — collapse is display-only). Restore re-applies `uiMinimized` so chips come back in the same group.
15. **Same CLI ≠ same session**: restore used to reuse any live PTY with the same `agentId`+project (all Grok tabs collapsed to one). Now only reuse when `resumeToken` matches; each tab gets its own `--resume` / new session id. Grok can claim distinct on-disk chats when token missing.

