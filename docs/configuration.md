# Configuration

Where TrueDeck stores settings, what you can change, and which environment variables matter.

## App data directory

Default global data root:

| Platform | Path |
|----------|------|
| **Windows** | `%APPDATA%\TrueDeck\data` (Electron `userData` + `/data`) |
| **macOS** | `~/Library/Application Support/TrueDeck/data` |
| **Linux** | `~/.config/TrueDeck/data` (or XDG equivalent) |

Override:

```powershell
$env:TRUEDECK_DATA_DIR = "C:\path\to\TrueDeck\data"
```

Also read by the hub MCP server (`truedeck-mcp.mjs`) for the same store files.

Home convenience path helper: `~/.truedeck` (`getHomeTrueDeckDir`) - used for some home-level TrueDeck files; primary app state is still under Electron userData.

## Settings file

`settings.json` in the data directory. Loaded/saved by `electron/main/index.ts`.

### Defaults (`defaultSettings`)

| Key | Default | Description |
|-----|---------|-------------|
| `injectMemoryOnAgentStart` | `true` | Inject memory paths / refresh context on agent spawn |
| `theme` | `"dark"` | UI theme |
| `fontSize` | `13` | Terminal font size (UI range 11-20) |
| `layoutMode` | `"tabs"` | `"tabs"` or `"grid"` |
| `autoGrid` | `false` | Auto-switch grid when 2+ panes |
| `showQuickAgents` | `false` | Title-bar agent chips |
| `reopenLastProject` | `true` | Restore last project + tabs on launch |
| `preferredAgentId` | unset | Onboarding / default palette focus |
| `palacePath` | unset | MemPalace (or compatible) data directory |
| `memoryProviders` | built-in list | See [memory-providers.md](./memory-providers.md) |
| `maxPanes` | `16` | Soft max agent panes |
| `worktreeIsolationDefault` | `false` | Future dispatch worktrees |
| `agentFrameTui` | `true` | Wrap agents in frame TUI |
| `frameShellPanes` | `false` | Also frame shell/command panes |

Edit via **Settings** UI when possible. Invalid JSON falls back to defaults merged with whatever can be read.

## Other store files

| File | Purpose |
|------|---------|
| `projects.json` | Project list, on-open commands, default agents |
| `agents.json` | Agent presets (merged with built-ins) |
| `session-layout.json` | Saved tabs + pane tree |
| `tasks.json` | Board tasks |
| `mcp-servers.json` | User-managed MCP servers |
| `memory-providers.json` | Memory backend list (may live here; see memory docs) |

## Per-project files (inside the repo)

| Path | Purpose |
|------|---------|
| `.memory/` | Repo-scoped TrueMemory markdown |
| `.truedeck/auto-context.md` | Generated session context for agents |
| `.truedeck/tasks/*.md` | Dispatched task instructions |
| `.truedeck/current-focus.md` | Focus line for agent frame |
| `.mcp.json` | Project MCP map (when hub injects) |
| `AGENTS.md` / `CLAUDE.md` | Often receive a TrueDeck memory pointer |

## Project config shape

`ProjectConfig` (`types.ts`):

```ts
{
 id: string
 name: string
 root: string
 lastOpened?: number
 onOpenCommands: { id, label, command, enabled }[]
 defaultAgents: string[]
 color?: string
}
```

Configure on-open commands under Settings → **Project**.

## Environment variables

### Process / tooling

| Variable | Purpose |
|----------|---------|
| `TRUEDECK_DATA_DIR` | Override app data directory |
| `TRUEDECK_BACKEND_BIN` | Path to `truedeck-backend` executable |

| `SHELL` | Unix shell for shell agent |
| `TERM` / `COLORTERM` | Inherited; TrueDeck sets defaults on spawn if missing |

### Injected into agent PTYs

| Variable | Purpose |
|----------|---------|
| `TRUEDECK` | `1` - marks process as under TrueDeck |
| `TRUEDECK_AGENT` | Agent preset id |
| `TRUEDECK_PROJECT` | Project root (cwd) |
| `TRUEDECK_RESOLVED` | Resolve source (+ `+frame`) |
| `TRUEDECK_PTY` | PTY backend id |
| `TRUEDECK_MEMORY` | `auto` when memory env applied |
| `TRUEDECK_REPO_MEMORY` | Path to repo `.memory` |
| `TRUEDECK_GLOBAL_MEMORY` | Path to global memory dir |
| `TRUEDECK_PALACE` | Palace path |
| `TRUEDECK_AUTO_CONTEXT` | Path to auto-context.md |
| `TRUEDECK_MEMORY_WING` | Wing name derived from project |
| `TRUEDECK_TASK` | Task id (dispatch) |
| `TRUEDECK_TASK_FILE` | Task markdown path |
| `TRUEDECK_TASK_TITLE` | Task title |
| `TRUEDECK_TASK_IDEA` | Idea line for frame |
| `TRUEDECK_FRAME` | `1` when framed |
| `TRUEDECK_FRAME_HEADER` | Header row count for frame |
| `TRUEDECK_INTENT` | Intent / idea when set |
| `TERM_PROGRAM` | `TrueDeck` |

## Agents config

Path: `agents.json` in the data directory. Prefer Settings / reset rather than hand-editing. Built-in command fields are re-asserted from defaults for known ids so Cursor stays CLI-only.

## Theme and terminal

- Theme: Settings → General
- Font size: Settings → Terminal (slider 11-20)
- Layout mode: tabs vs grid

## Related

- [Memory providers](./memory-providers.md)
- [MCP](./mcp.md)
- [Agent frame](./agent-frame.md)
- [Development](./development.md)
