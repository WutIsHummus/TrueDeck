# Getting started

Get TrueDeck running, open a project, and launch your first coding agent.

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | Required for Electron, electron-vite, and the agent frame script |
| **OS** | Windows, macOS, or Linux (Windows is the primary development target) |
| **Agent CLIs** (optional) | Install the CLIs you want on `PATH`: `grok`, `codex`, `claude`, `gemini`, `cursor-agent`, `opencode`, `aider`, … |
| **Rust** (optional) | Only if you build `truedeck-backend` or `truedeck-pty` - see [Rust backend](./RUST-BACKEND.md) and [Fast PTY](./FAST-PTY.md) |

> Tools like **Rojo** are not coding-agent CLIs. You can still run them as **on-open project commands** (Settings → Project) so they open as shell panes when you open that folder.

## Install

```bash
git clone https://github.com/WutIsHummus/TrueDeck.git
cd TrueDeck
npm install
```

On Windows, open a terminal that has Node on `PATH` (PowerShell is fine). After `npm install`, native deps such as `node-pty` are linked via `electron-builder install-app-deps` (postinstall).

## First launch

### Studio UI (default)

```bash
npm start
```

This runs `electron-vite dev` - Electron window with thin chrome and almost all of the area as terminals.

### Terminal-only deck

```bash
npm run tui
```

Runs the Blessed-based TUI (`tui/index.ts`) without Electron. Prefer Studio for pane groups, task board, and settings.

## First-run onboarding

On a fresh profile TrueDeck walks you through:

1. **Welcome**
2. **Preferred CLI** - Cursor Agent, Claude, Codex, Grok, Gemini, Shell, …
3. **Memory space** - default palace, detected folder, or browse an existing path
4. **Repo** - pick a project folder
5. **Inject + launch** - MCP / auto-context pointers + start your preferred agent

Replay later: **?** in the title bar, or **Settings → About → Replay onboarding**.

Memory is automatic after this: TrueDeck writes `.truedeck/auto-context.md`, ensures `.memory/`, and injects env paths into agent processes. See [Memory providers](./memory-providers.md).

## First project

1. Press **Ctrl+O** (or use **Project ▾** in the title bar).
2. Choose a folder. TrueDeck stores it under app data as a project with optional on-open commands and default agents.
3. The folder name appears in the project menu (VS Code-style chevron + recents).

Project metadata lives in app data (`projects.json`), not only inside the repo. Per-repo agent context still uses `.memory/` and `.truedeck/` under the project root.

## First agent

1. Open a project (**Ctrl+O**).
2. Press **Ctrl+T** to open the agent palette.
3. Pick an agent (Grok, Codex, Claude, Cursor Agent, Shell, …).
4. A PTY session opens in the active pane group. TrueDeck:
 - Resolves the CLI binary (never Cursor IDE for the Cursor agent)
 - Injects memory env vars
 - Optionally wraps the process in the [agent frame](./agent-frame.md)

If a CLI is missing, the palette / spawn error shows an install one-liner. Example for Cursor Agent on Windows:

```powershell
irm https://cursor.com/install?win=1 | iex
```

## First task (optional)

1. Press **Ctrl+B** to open the task board.
2. Create a task (title + details).
3. Assign an agent and **Run** / dispatch.
4. TrueDeck writes `.truedeck/tasks/<id>.md`, sets `TRUEDECK_TASK_*` env, spawns the agent, and seeds a short prompt into the PTY.

Details: [Task board](./task-board.md).

## Quick command reference

| Command | What |
|---------|------|
| `npm start` | Studio UI (default) |
| `npm run tui` | Terminal-only deck |
| `npm run build` | Production compile (`out/`) |
| `npm run dist:win` | Windows installer (electron-builder) |
| `npm run build:backend` | Build optional Rust backend |
| `npm run build:pty` | Build optional Rust PTY sidecar |

## Next steps

- [User guide](./user-guide.md) - panes, restore, settings
- [Keyboard shortcuts](./keyboard-shortcuts.md)
- [Agents](./agents.md) - CLI resolve and Cursor policy
- [Configuration](./configuration.md) - settings and env vars
