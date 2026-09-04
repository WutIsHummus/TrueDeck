# Startup performance (2026-07-30)

## Goal
**App window appears fast.** Memory/MCP/terminals warm after paint.

## Two different “slow launches”

| What you mean | What is slow | Fix |
|---------------|--------------|-----|
| **App launch** | Electron cold start + (dev) vite rebuild | See below |
| **Session restore** | Spawning 8 PTYs + memory | Parallel spawn + background warm |

## App launch (window on screen)

### Dev is the slow path
`npm run dev` **rebuilds main/preload + starts Vite** every time (often 2–10s before Electron even starts). That is not production launch cost.

**Faster day-to-day:**
```bash
npm run build          # once after code changes
npm run launch         # electron . — no vite rebuild
```
Or installed **TrueDeck.exe** from `dist` / Releases.

### Critical path (main process)
1. `writeAppLock` + `registerIpc`
2. **`createWindow()` immediately** — show on `ready-to-show` / `dom-ready` (≤2.5s fallback)
3. Backend start **in parallel** (not blocking show)
4. Memory tree, MCP purge, MemPalace, deck worker **deferred ~100–200ms**

### Restore (after window)
- Cheap root warm → parallel PTY spawn (concurrency 3) → background memory/MCP

## Log markers
- `[boot] window created Xms`
- `[boot] whenReady critical path Xms`
- `[backend] ready Xms`
- `[layout] restore spawns done in Xms`

## Agent tab open lag (fixed 2026-07-30)
Selecting a CLI from the palette was slow because spawn competed with:
1. Full MCP inject + `setupProject` on every pick
2. `project:setupStatus` awaiting `mempalace status` (seconds)
3. `ensureUnifiedAgentsFolder` + auto-context on every spawn
4. Cursor `create-chat` sync up to 15s; Codex session discover up to 5s
5. Palette stayed open until PTY finished

Fix: close palette immediately; spawn path is env-only; inject/setup only when not ready;
setupStatus never awaits mine; cursor create-chat ≤2.5s; codex discover background.
