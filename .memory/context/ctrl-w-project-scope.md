# Ctrl+W must stay project-scoped

## Incident (2026-07-28)
User switched TrueDeck → SPTS (Roblox, `rojo serve` onOpen), spammed **Ctrl+W**, then switched back — TrueDeck agent sessions were gone.

## Root cause
1. Sessions from all projects stay alive; UI filters with `displayLayout` / `projectSessions`.
2. Closing the last tab in project A made `removeSession` set `activeSessionId` to the **last global** session (often another project).
3. Ctrl+W always killed `activeSessionId` with **no project check**, so further presses wiped hidden TrueDeck tabs while the SPTS view looked empty.
4. Persist only keeps **running** PTYs → killed tabs never come back. No per-project layout backup.

## Fix
- Ctrl+W closes only a session in `projectSessions` / `displayLayout`.
- `removeSession` prefers next focus with the **same `projectRoot`**.
- `closeSession` does not steal focus into another project when the current one is empty.

## Related
- Disk: `%APPDATA%/truedeck/data/session-layout.json` (single global file)
- Projects: TrueDeck + SPTS (`rojo serve` onOpen)
- Prior multi-pane work: `session-layout-persist.md`, `ctrl-tab-group-scoped.md`, `pane-focus-vs-visible.md`, `tui-render-cutoff.md`

## On-open only if not already running (2026-07-28)
`sessions:openProject` and restore skip spawning when a matching command/agent is already live (`isCommandSessionRunning` / `isAgentSessionRunning` in `session-layout.ts`). Path + command matching is case/slash-normalized so Windows does not re-stack Rojo Serve.
