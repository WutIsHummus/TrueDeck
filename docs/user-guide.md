# User guide

Day-to-day use of TrueDeck Studio (Electron UI). For setup, see [Getting started](./getting-started.md).

## Studio UI layout

```
┌─ title bar: icon · TRUEDECK · [Project ▾] · board · ⚙ · ? · window ─┐
├─ layout toolbar: split hints · merge · + · clear ────────────────────┤
├─ Group A tabs ──────────────┬─ Group B tabs ────────────────────────┤
│ terminal │ terminal │
│ (active agent) │ (or stacked below) │
└─────────────────────────────┴────────────────────────────────────────┘
```

- **Project ▾** - recent projects and Open Folder (**Ctrl+O**)
- **Board** - task board (**Ctrl+B**)
- **⚙** - settings (**Ctrl+S**)
- **?** - help / replay onboarding
- **+** or **Ctrl+T** - agent palette
- **Drag a tab** onto Left / Right / Top / Bottom zones to split panes; center drop joins a group

Almost all of the window is terminal chrome. TrueDeck is not a three-column IDE.

## Projects

A **project** is a folder TrueDeck tracks in app data (`projects.json`):

| Field | Role |
|-------|------|
| `name` | Display name (usually folder basename) |
| `root` | Absolute path |
| `onOpenCommands` | Shell commands run as panes when you open the project |
| `defaultAgents` | Preferred agent ids for that project |
| `lastOpened` | Recents ordering |

### Open / switch

- **Ctrl+O** - native folder picker (adds project if new)
- Project menu - switch among recents

### On-open commands

Settings → **Project** → On-open commands. Example: `rojo serve` as a shell pane when you open a Roblox repo. These are **not** agent presets; they spawn as `kind: 'command'` sessions and can be restored with the session layout.

### Reopen last project

Default: **on**. Settings → General / related toggles control `reopenLastProject`. On launch, TrueDeck restores the last project and respawns saved tabs (capped). See [Session restore](#session-restore).

## Tabs and sessions

Each agent or command pane is a **session** (PTY):

- Running sessions stream into an xterm instance
- **Ctrl+W** closes the active tab
- **Ctrl+Tab** / **Ctrl+Shift+Tab** cycles tabs inside the focused pane group (not across other splits)
- **Ctrl+1-9** jumps to tab index 1-9
- **Ctrl+N** opens a plain **Shell** tab in the project root

Sessions show agent name, color, and exit status when the process ends.

## Pane groups (splits)

TrueDeck uses a nested pane tree (leaf groups with their own tab bars):

| Action | Shortcut |
|--------|----------|
| Split vertical (side-by-side) | **Ctrl+D** |
| Split horizontal (top/bottom) | **Ctrl+X** |
| Merge all groups to one pane | **Ctrl+Alt+D** (or **Ctrl+Alt+X**) |

You need at least two tabs (or two leaves) to split. Hard cap: **16** panes (`MAX_PANES`). A soft warning appears around 12 panes.

Drag-and-drop zones:

- **Left / Right / Top / Bottom** - create or target a split edge
- **Center** - move the tab into that group

Selecting a tab focuses its group without collapsing the other pane.

## Task board

**Ctrl+B** toggles the board. Create tasks, set status (`backlog` → `ready` → `running` → `review` → `done` / `blocked`), assign an agent, and dispatch. Full detail: [Task board](./task-board.md).

## Settings

**Ctrl+S** opens Settings. Tabs:

| Tab | Contents |
|-----|----------|
| **General** | Theme, memory abstraction notes, palace path, inject-on-start |
| **MCP** | Unified MCP list, add/remove user servers, sync/export |
| **Terminal** | Font size, layout mode, agent frame TUI, frame shell panes, PTY engine label, shortcut hint |
| **Project** | Current project name/path, on-open commands |
| **Agents** | Agent list / reset presets, MCP memory snippet export |
| **About** | Version, update check, replay onboarding |

Settings file: app data `settings.json` - see [Configuration](./configuration.md).

### Agent frame TUI

Settings → Terminal → **Agent frame TUI** (default **on**). Wraps coding agents in `truedeck-frame.mjs` (brand header + idea line). **Frame shell panes too** is off by default. New tabs only after toggle - restart agents to apply. See [Agent frame](./agent-frame.md).

## Session restore

On quit (and periodically), TrueDeck saves `session-layout.json`:

- Active project root
- Tab list (agent id, name, project root, optional command line)
- Nested `paneTree` (version 2) for multi-pane layout
- Active indices

On next launch (when `reopenLastProject` is true):

1. Load layout
2. Clamp to **max 16 tabs** (prefer agent tabs over one-off commands)
3. Drop “install helper” shell tabs (noise filter)
4. Respawn each tab’s PTY

If restore floods CLIs or feels heavy, close unused tabs before quitting or clear layout via UI clear actions. See [Troubleshooting](./troubleshooting.md).

## Studio UI vs TUI

| Mode | Command | Use when |
|------|---------|----------|
| **Studio** | `npm start` / `npm run studio` | Full UI: pane groups, board, settings, drag-drop |
| **TUI** | `npm run tui` | Headless / SSH-friendly deck without Electron |

Studio is the primary product surface documented here. The TUI shares agent resolve / session ideas but not the full React board and settings chrome.

## Memory (automatic)

You do not manage a memory badge in the UI. On project open and agent spawn, TrueDeck:

1. Ensures `.memory/` (repo) and global memory under app data
2. Refreshes `.truedeck/auto-context.md`
3. Injects `TRUEDECK_*` env paths into the PTY
4. Optionally warms MemPalace (native)

Agents that read `AGENTS.md` / `CLAUDE.md` get a one-line pointer. Details: [Memory providers](./memory-providers.md).

## Updates

TrueDeck checks GitHub Releases on launch. If a newer tag exists, an **Update** button appears in the title bar. About tab can re-check.

## Tips

- Open a project before **Ctrl+T** / **Ctrl+N** / board dispatch - most actions require an active project root
- Prefer fewer simultaneous agent panes for machine load (model + PTY cost)
- Install CLIs system-wide so resolve finds them on `PATH`
- On Windows, use `cursor-agent` install, not Cursor IDE shortcuts
