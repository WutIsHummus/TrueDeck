# Agent frame

The **agent frame** is in-terminal TrueDeck chrome around a coding CLI. It reserves a header band (brand, main idea, context) and rewrites CSI so full-screen agent TUIs paint **below** the header instead of overwriting it.

Implementation: `resources/agent-frame/truedeck-frame.mjs` 
Wrap decision: `electron/main/agent-frame.ts` (called from `pty-manager.ts`)

## Enable / disable

Settings → **Terminal**:

| Setting | Default | Effect |
|---------|---------|--------|
| **Agent frame TUI** (`agentFrameTui`) | **On** (`!== false`) | Wrap coding agents in the frame |
| **Frame shell panes too** (`frameShellPanes`) | **Off** | Also wrap `shell` and `cmd-*` panes |

Notes from the UI:

- Inspired by Grok Build-style TUI chrome
- Full-screen agents may redraw over the header; the frame **repaints every second**
- **New tabs only** - restart agents after toggling

If the frame script is missing, TrueDeck logs a warning and spawns the raw CLI.

## Spawn shape

When wrapping is active:

```text
node <…>/truedeck-frame.mjs \
 --agent <id> \
 --name <displayName> \
 --color <#hex> \
 --cwd <projectRoot> \
 -- \
 <resolvedCommand> [args…]
```

Extra env from the wrapper:

| Variable | Value |
|----------|--------|
| `TRUEDECK_FRAME` | `1` (skips double-wrap) |
| `NODE_PATH` | TrueDeck `node_modules` when found (for `node-pty`) |

The frame script loads `node-pty` from TrueDeck’s `node_modules` (several candidate paths).

## Header idea line

The “main idea” line is resolved in order (refreshed about every 2s):

1. `TRUEDECK_TASK_IDEA` / `TRUEDECK_TASK_TITLE` / `TRUEDECK_INTENT`
2. `TRUEDECK_TASK_FILE` (markdown parse)
3. Project `.truedeck/current-focus.md`

Task dispatch writes both task env and `current-focus.md`. See [Task board](./task-board.md).

## Environment variables

| Variable | Role |
|----------|------|
| `TRUEDECK_TASK` | Task id |
| `TRUEDECK_TASK_FILE` | Absolute task markdown path |
| `TRUEDECK_TASK_TITLE` | Short title |
| `TRUEDECK_TASK_IDEA` | Header idea string |
| `TRUEDECK_INTENT` | Alternate idea source |
| `TRUEDECK_PROJECT` | Project root / cwd context |
| `TRUEDECK_FRAME_HEADER` | Header height (default **4**, clamped 4-5) |
| `TRUEDECK_MEMORY` | Memory mode flag from inject |
| `TRUEDECK_AGENT` | Agent id |
| `TRUEDECK_FRAME` | Set when already framed |

## Manual usage (debug)

```bash
node resources/agent-frame/truedeck-frame.mjs --agent codex --name Codex --color #34d399 -- -- codex
```

Requires `node-pty` resolvable from the script’s search path (run from a TrueDeck checkout with `npm install`).

## Brand marks

Built-in brands (mark + ANSI color) include Grok, Codex, Cursor, Claude, Gemini, Shell, Aider, OpenCode. Unknown agents get a generic mark and truncated label.

## CSI offset behavior

Child PTY output is rewritten so absolute cursor / scroll / clear sequences land below the reserved header rows. Without this, agent TUIs clear the whole screen and erase TrueDeck chrome.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| No header | Settings: enable Agent frame TUI; open a **new** agent tab |
| Garbled layout | Resize window; ensure `TERM=xterm-256color` (TrueDeck sets this); try toggling frame off for that CLI |
| `node-pty not found` | Run from installed TrueDeck / repo with `node_modules`; packaged builds include agent-frame resources |
| Shell has no frame | Expected unless **Frame shell panes too** is on |

More: [Troubleshooting](./troubleshooting.md).
