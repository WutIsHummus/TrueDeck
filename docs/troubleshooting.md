# Troubleshooting

Common TrueDeck issues and fixes. Version target: **0.3.x**.

## Cursor IDE blocked or Cursor Agent missing

**Symptom:** Error like `Blocked: Cursor IDE cannot be spawned` or Cursor shows unavailable in the palette.

**Cause:** TrueDeck only runs **cursor-agent CLI**, never Cursor IDE (`Cursor.exe` / IDE `cursor.cmd`).

**Fix:**

1. Install Cursor Agent CLI (Windows):

 ```powershell
 irm https://cursor.com/install?win=1 | iex
 ```

2. Confirm install under `%LOCALAPPDATA%\cursor-agent\` (versions with `node.exe` + `index.js`).
3. Restart TrueDeck so resolve cache refreshes (or wait ~5 minutes / reopen palette probe).
4. Do **not** point the agent command at `Program Files\cursor\…`.

See [Agents](./agents.md).

## Agent CLI not found

**Symptom:** `CLI not found (…); Install with: …`

**Fix:**

- Install the vendor CLI and ensure it is on `PATH` for the same environment Electron inherits
- On Windows, log out/in or restart TrueDeck after installing global npm tools
- Check known paths (npm global under `%APPDATA%\npm`, nvm4w, `~/.local/bin`)
- Use the install one-liner from the error / [Agents](./agents.md) table

## Agent frame missing or garbled

**Symptom:** No TrueDeck header, or agent TUI fights the header.

**Fix:**

| Check | Action |
|-------|--------|
| Setting | Settings → Terminal → **Agent frame TUI** on |
| Restart tab | Close and reopen the agent (**Ctrl+T**) - toggle applies to new tabs |
| Script present | Dev: `resources/agent-frame/truedeck-frame.mjs`; packaged: extraResources |
| node-pty | Frame needs `node-pty` via `NODE_PATH` / TrueDeck `node_modules` |
| Shell panes | Shell only frames if **Frame shell panes too** is on |
| Conflict | Disable frame for agents that mishandle CSI offset |

See [Agent frame](./agent-frame.md).

## Lag / many panes

**Symptom:** UI or machine slows with many simultaneous agents.

**Fix:**

- Hard cap is **16** panes; soft warning near **12**
- Close unused agent tabs (each is a full CLI + model process)
- Prefer side-by-side only when you actively compare agents
- Build the Rust backend for lower I/O overhead ([RUST-BACKEND](./RUST-BACKEND.md), [FAST-PTY](./FAST-PTY.md)) - does **not** reduce model latency

## Session restore tab flood

**Symptom:** On launch, many agent CLIs spawn at once.

**Cause:** `reopenLastProject` + saved `session-layout.json` respawns tabs for the last active project (hard-capped, sequential on Windows).

**Fix:**

- Close tabs you do not need before quitting
- Disable **Reopen last project** in settings if you prefer a clean launch
- Emergency: set env `TRUEDECK_RESTORE_PTYS=0` to open the project with no tabs
- Delete or edit `session-layout.json` in the [data directory](./configuration.md) as a last resort

## Sessions empty after restart (exe)

**Symptom:** You quit with agent tabs open; reopening the packaged app shows no terminals.

**Cause (fixed in source):** restore used to skip PTY respawn unless `TRUEDECK_RESTORE_PTYS=1`. Default is now **restore on**.

**If you still see it on an older build:** rebuild/reinstall from current source, or set `TRUEDECK_RESTORE_PTYS=1` for that install only.

## TERM / colors / broken agent TUI

**Symptom:** Agent UI is black-and-white, or lacks alt-screen / mouse.

**Fix:**

- TrueDeck forces color-capable env on every PTY: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=TrueDeck`, `FORCE_COLOR=3`, `CLICOLOR=1`
- Parent `NO_COLOR` / `FORCE_COLOR=0` / `TERM=dumb` (common when TrueDeck is launched from Cursor, Claude Code, or Grok Build) are stripped so CLIs keep their native colors
- Rebuild the backend after pulling color fixes: `npm run build:backend`
- Resize the pane after spawn so xterm FitAddon / PTY rows match
- Try with agent frame off if the CLI assumes full terminal ownership incorrectly

## PTY backend stuck on node-pty

**Symptom:** Settings shows `node-pty (TS fallback)`.

**Fix:**

```bash
npm run build:backend
# or
npm run build:pty
```

Install [rustup](https://rustup.rs) + MSVC tools on Windows; free enough disk for the toolchain. Override path with `TRUEDECK_BACKEND_BIN` / `TRUEDECK_PTY_BIN` if needed.

## MCP not visible in Cursor / Claude / Grok

**Fix:**

1. Settings → MCP → ensure servers enabled
2. Run sync / `truedeck_apply_mcp` via hub tools
3. Confirm client config files were written (export JSON to verify map)
4. Restart the agent CLI after inject
5. Align `TRUEDECK_DATA_DIR` if you use a custom data dir

See [MCP](./mcp.md).

## Memory / palace issues

**Fix:**

- TrueMemory files always work under `.memory/` offline
- MemPalace: install native `mempalace` / `mempalace-mcp`, not Docker, for the default path
- Set palace path in Settings / onboarding
- Read [memory-providers.md](./memory-providers.md)

Helpers:

```powershell
uv tool install mempalace
.\tools\ensure-mempalace.ps1
```

## Task board will not run

| Issue | Fix |
|-------|-----|
| “Open a project first” | **Ctrl+O** |
| Agent missing | Install CLI; try Shell as smoke test |
| Task stuck running | Close the session tab; exit should move card toward review |
| No idea in frame | Dispatch sets `TRUEDECK_TASK_*` and `.truedeck/current-focus.md` |

## Electron will not start after install

- Confirm Node 20+
- Re-run `npm install` (rebuilds native modules for Electron)
- Delete `node_modules` and reinstall if ABI mismatch after Electron upgrades
- Check console for main-process errors when launching `npm start`

## Shortcuts not working in terminal

TrueDeck attaches a capture-phase keydown listener and filters xterm so app shortcuts work while focused. If a shortcut fails:

- Confirm it is in the [shortcut table](./keyboard-shortcuts.md) (e.g. **Ctrl+T** = new agent, not next tab)
- Avoid conflicting global OS hotkeys
- **Ctrl+A** is intentionally left to the terminal / agent

## Getting more detail

- Main process logs appear in the terminal that launched `npm start`
- Look for tags: `[pty]`, `[backend]`, `[agent-frame]`
- Report issues with OS, TrueDeck version, agent id, and whether frame/Rust backend are enabled
