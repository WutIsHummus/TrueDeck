# MCP (unified hub)

TrueDeck maintains a **single MCP server list** and injects it into every supported agent client so you configure once.

## Design

```
Memory providers ─┐
User mcp-servers ─┼─► TrueDeck hub map ─► Cursor / Claude / Grok / Codex / Gemini / .mcp.json
Builtin hub MCP ──┘
```

Main code: `electron/main/mcp-hub.ts` 
Agent-facing server: `resources/mcp-server/truedeck-mcp.mjs`

## Sources

| Source | Description |
|--------|-------------|
| **builtin** | `truedeck-hub` - tools to edit the hub and tasks |
| **memory** | MCP entries derived from enabled memory providers (e.g. MemPalace) |
| **user** | Servers you add in Settings → MCP or via hub tools |

Store for user servers: `<dataDir>/mcp-servers.json`.

## Settings UI

Settings → **MCP**:

- List all entries (enable/disable user servers; memory ones toggled under memory backends)
- Add server: name, command, args
- Remove user servers
- Sync / export helpers (export Cursor-style JSON)

Docker-based memory commands are discouraged/blocked for MemPalace-style memory (prefer native `mempalace-mcp`).

## Built-in hub tools

When agents connect to **TrueDeck MCP Hub** (`truedeck-hub`), they can call:

| Tool | Description |
|------|-------------|
| `truedeck_list_mcp` | List hub servers |
| `truedeck_add_mcp` | Add/update a user MCP server; optional auto-sync (`sync` default true) |
| `truedeck_remove_mcp` | Remove user server + re-sync |
| `truedeck_set_mcp_enabled` | Enable/disable user server + re-sync |
| `truedeck_apply_mcp` | Force-sync hub into all CLI configs (optional `projectRoot` for `.mcp.json`) |
| `truedeck_export_mcp` | Export unified map as JSON |
| `truedeck_launch` | **Primary:** create goal + open live agent PTY in TrueDeck (app must be running) |
| `truedeck_dispatch` | Dispatch an existing task id to a live PTY |
| `truedeck_start_pipeline` | Start multi-agent pipeline (Feature, Bugfix, …) |
| `truedeck_list_agents` | List agent CLI ids |
| `truedeck_list_roles` | List roles (implementer, reviewer, …) |
| `truedeck_list_pipelines` | List pipelines |
| `truedeck_list_tasks` | List tasks for a project (or all) |
| `truedeck_create_task` | Create task record only (prefer `truedeck_launch`) |
| `truedeck_update_task` | Update title/body/status/assignee |
| `truedeck_delete_task` | Delete a task |
| `truedeck_graph_status` | Graphify knowledge graph status |

Deck orchestration is **MCP-first** (no Ctrl+B panel). Electron polls `deck-command-queue.json` and spawns real PTYs.

Protocol: stdio JSON-RPC with Content-Length framing (MCP subset). Server name `truedeck-hub`, version `1.0.0` in the script.

### Add MCP example (tool args)

```json
{
 "name": "my-tools",
 "command": "node",
 "args": ["C:/tools/my-mcp/server.js"],
 "enabled": true,
 "sync": true
}
```

`command` is required. Docker as the command is rejected for memory-style servers.

## Inject targets

The hub writes the same stdio set into client configs for:

- Cursor
- Claude Code
- Grok
- Codex
- Gemini
- Project `.mcp.json` (when a project root is provided)

Exact paths depend on each product’s config layout (under the user home / app support dirs). Use **Export** / `truedeck_export_mcp` to inspect the map TrueDeck would inject.

## Data directory for the hub script

`truedeck-mcp.mjs` resolves data dir as:

1. `TRUEDECK_DATA_DIR` if set
2. Else platform defaults under `TrueDeck/data` (Windows `%APPDATA%`, macOS Application Support, Linux XDG)

Keep Electron and external hub processes pointed at the same directory if you override it.

## Memory MCP

Memory backends (TrueMemory files, MemPalace native, OpenMemory, custom) are documented in [memory-providers.md](./memory-providers.md). They appear in the MCP list as `source: 'memory'`. Toggle them under memory provider settings, not only the MCP tab.

## Packaging

`electron-builder` ships `resources/mcp-server/**` as `extraResources`. Packaged apps resolve the hub script from `process.resourcesPath`.

## Related

- [Architecture](./architecture.md)
- [Task board](./task-board.md) - task tools
- [Configuration](./configuration.md)
