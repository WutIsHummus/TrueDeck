# Unexpected project switching (2026-07-28)

## Symptom
UI jumps between TrueDeck / Dynamo / SPTS without the user choosing a project.

## Causes
1. **`activeProjectRoot` saved from focused session** — other-project PTYs stay alive; focus on a Dynamo tab rewrote disk to Dynamo even while the menu showed TrueDeck (or vice versa).
2. **Restore preferred `restored[0]`'s folder** when saved root didn’t match a tab root (strict path / multi-project tabs) → startup landed on the wrong project.
3. **`addSession` always stole focus** — background/MCP spawns and bulk restore thrashed the active tab (and title bar) across folders.
4. **`setActiveProject` left `activeSessionId` on the previous folder’s tab** — title bar + persist looked like a project jump.

## Fix
- Persist `activeProjectRoot` from UI `activeProjectId` only.
- Restore honors saved workspace root (`sameProjectRoot`); focus only tabs inside that project.
- `addSession({ focus })` defaults to same-project only; bulk restore uses `focus: false`.
- `setActiveProject` moves focus into the new folder (or clears it).
- `removeSession` no longer falls back to another project’s tabs.

## Disk
`%APPDATA%/truedeck/data/session-layout.json` — `activeProjectRoot` + tabs may still span multiple roots; workspace choice is independent of which tabs are running.
