# Getting started

Get TrueDeck running, open a project, and launch your first coding agent.

## Download (recommended)

**End users should not clone the repo.** Install a prebuilt binary from GitHub Releases:

**https://github.com/WutIsHummus/TrueDeck/releases**

| Asset | Use |
|-------|-----|
| **TrueDeck Setup … .exe** | Windows installer (recommended) |
| **TrueDeck … .exe** | Windows portable (no installer) |

Run the app, then install any coding CLIs you want on `PATH` (`grok`, `codex`, `claude`, `cursor-agent`, …).

## Requirements

| Requirement | Notes |
|-------------|--------|
| **OS** | Windows x64 builds are published first; macOS / Linux when available |
| **Agent CLIs** | Install the CLIs you want on `PATH`: `grok`, `codex`, `claude`, `gemini`, `cursor-agent`, … |
| **Node.js 20+** | Only for **building from source** (contributors) |
| **Rust toolchain** (contributors) | Required to build the main `truedeck-backend` binary from source |

> Tools like **Rojo** are not coding-agent CLIs. You can still run them as **on-open project commands** (Settings → Project) so they open as shell panes when you open that folder.

## First launch (from a release)

1. Install or run the `.exe` from Releases.
2. Open a project (**Ctrl+O** or the project menu).
3. Launch an agent (**Ctrl+T**).

## Develop from source (contributors)

```bash
git clone https://github.com/WutIsHummus/TrueDeck.git
cd TrueDeck
npm install
npm start
```

| Command | What |
|---------|------|
| `npm start` | Studio UI (dev) |
| `npm run tui` | Terminal-only deck |
| `npm run dist:win` | Build Windows installer + portable |

See [Development](./development) for packaging details.
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
2. Choose a folder. TrueDeck stores it under app data as a project with on-open commands and default agents.
3. The folder name appears in the project menu (VS Code-style chevron + recents).

Project metadata lives in app data (`projects.json`), not only inside the repo. Per-repo agent context still uses `.memory/` and `.truedeck/` under the project root.

## First agent

1. Open a project (**Ctrl+O**).
2. Press **Ctrl+T** to open the agent palette.
3. Pick an agent (Grok, Codex, Claude, Cursor Agent, Shell, …).
4. A PTY session opens in the active pane group. TrueDeck:
 - Resolves the CLI binary (never Cursor IDE for the Cursor agent)
 - Injects memory env vars
 - Wraps the process in the [agent frame](./agent-frame.md) when enabled

If a CLI is missing, the palette / spawn error shows an install one-liner. Example for Cursor Agent on Windows:

```powershell
irm https://cursor.com/install?win=1 | iex
```

## First task

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
| `npm run build:backend` | Build main Rust backend (`truedeck-backend`) |
| `npm run build:pty` | Build legacy Rust PTY sidecar |

## Next steps

- [User guide](./user-guide.md) - panes, restore, settings
- [Keyboard shortcuts](./keyboard-shortcuts.md)
- [Agents](./agents.md) - CLI resolve and Cursor policy
- [Configuration](./configuration.md) - settings and env vars
