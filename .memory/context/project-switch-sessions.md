# Project switch: macOS Spaces model (2026-08-25)

Each project is a Space. Terminals stay running; switching folders only changes which workspace is shown.

## What was broken
1. One global `session-layout.json` — leaving a folder overwrote its tabs with the next folder.
2. `session-layouts.json` (per-project bank) was designed but never written by the running build.
3. The pane tree synced **every** live PTY, so persist mixed SPTS + LHR and restore mashed them.
4. On save, a richer disk pane tree was reused whenever tab *counts* matched — SPTS splits could land on LHR tabs.
5. Startup merge (first 120s) appended the previous project's tabs into the next persist.

## Fix
- Persist and the live pane tree are **active-project only**. Other folders stay alive, hidden.
- Leaving a folder flushes that Space to `session-layouts.json` before the switch.
- Returning applies the parked pane tree (in-memory cache, then bank, then spawn missing tabs).
- Disk-tree / startup merge only apply when `activeProjectRoot` matches.
- Switch Spaces from the project tab bar, project menu, or Ctrl+P.

## Disk
- `%APPDATA%/truedeck/data/session-layout.json` — last active Space
- `%APPDATA%/truedeck/data/session-layouts.json` — parked tabs + pane tree per folder
