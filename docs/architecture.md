# Architecture

TrueDeck is a desktop app: **Electron main** owns processes and data, **preload** exposes a typed IPC API, and the **renderer** is a React + xterm Studio UI. The **Rust** `truedeck-backend` is the main session engine.

## High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (src/) │
│ React · zustand store · xterm panes · TaskBoard · Settings │
└──────────────────────────▲──────────────────────────────────┘
 │ IPC (contextBridge / preload)
┌──────────────────────────┴──────────────────────────────────┐
│ Electron main (electron/main/) │
│ index.ts · pty-manager · tasks · mcp-hub · memory-service │
│ agents · resolve-command · session-layout · agent-frame │
└───────┬───────────────────────────────┬─────────────────────┘
 │ │
 ▼ ▼
 node-pty (fallback) truedeck-backend / truedeck-pty
 agent CLIs in ConPTY/PTY (Rust backend primary)
```

## Process roles

### Main (`electron/main/`)

| Module | Responsibility |
|--------|----------------|
| `index.ts` | App lifecycle, BrowserWindow, settings IPC, session restore orchestration |
| `pty-manager.ts` | Session map, spawn/write/resize/kill, rust vs node-pty backend |
| `resolve-command.ts` | PATH / known-path CLI resolve; **blocks Cursor IDE** |
| `agents.ts` | Default agent presets + `agents.json` merge |
| `session-layout.ts` | Persist/load pane tree; max 16 tabs |
| `tasks.ts` / `task-dispatch.ts` / `runs.ts` | Kanban store, dispatch to PTY, run records |
| `mcp-hub.ts` | Unified MCP config write/sync to agent clients |
| `memory-service.ts` / `memory-providers.ts` / `mempalace.ts` | Auto-context, env inject, providers |
| `agent-frame.ts` | Wrap spawn in `truedeck-frame.mjs` when enabled |
| `backend-bridge.ts` | JSON-RPC stdio to `truedeck-backend` |
| `rust-pty-host.ts` | JSON-lines host for `truedeck-pty` |
| `paths.ts` | App data and memory directory helpers |
| `projects.ts` | Project list CRUD |
| `first-run.ts` / `onboarding.ts` | First-run / onboarding flow |

### Preload (`electron/preload/index.ts`)

Exposes `window.truedeck` methods (`spawn`, settings, MCP, tasks, restore, …) via `contextBridge`. Renderer never gets raw Node APIs.

### Renderer (`src/`)

| Area | Role |
|------|------|
| `App.tsx` | Shortcuts, project/session lifecycle, palette, board/settings chrome |
| `components/TerminalPane.tsx` | xterm instance, fit, write IPC, shortcut filter |
| `components/PaneWorkspace.tsx` / `lib/pane-layout.ts` | Nested split tree, drag targets, max panes |
| `components/TaskBoard.tsx` | Kanban UI |
| `components/SettingsMenu.tsx` | Settings tabs |
| `store.ts` | Lightweight client state (zustand) |

### Shared types (`electron/shared/types.ts`)

Single source for `AgentPreset`, `AppSettings`, `SessionInfo`, `SessionLayout`, `Task`, `MemoryProviderConfig`, etc.

## PTY backends

Spawn path prefers native engines when binaries exist:

```
Electron PtyManager
 │
 ├─ prefer ──► truedeck-backend (full native: sessions + projects + …)
 │ or truedeck-pty (PTY-only sidecar)
 │
 └─ fallback ► node-pty
```

| Backend | Build | Docs |
|---------|-------|------|
| **node-pty** | npm postinstall | Default when Rust binary missing |
| **truedeck-pty** | `npm run build:pty` | [FAST-PTY.md](./FAST-PTY.md) |
| **truedeck-backend** | `npm run build:backend` | [RUST-BACKEND.md](./RUST-BACKEND.md) |

Env overrides:

| Variable | Purpose |
|----------|---------|
| `TRUEDECK_BACKEND_BIN` | Path to `truedeck-backend` executable |
| `TRUEDECK_PTY_BIN` | Path to `truedeck-pty` executable |
| `TRUEDECK_DATA_DIR` | Override app data directory (also used by hub MCP) |

Every session gets terminal identity env: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=TrueDeck`.

## Pane layout

Runtime layout is a tree of **leaves** (groups with tab lists) and **splits** (`row` | `column` + ratio).

Persisted form (`SessionLayout`):

- `version: 2` with optional `paneTree`
- `tabs[]` as agent/command snapshots (not live PTY ids)
- Indices map tree leaves back to restored session order

Helpers live in `src/lib/pane-layout.ts` (renderer) and `electron/main/session-layout.ts` (disk clamp/sanitize).

## Session restore

1. Renderer loads settings; if `reopenLastProject`, call `sessions:restore`
2. Main loads `session-layout.json`, clamps tabs (max 16), filters install helpers
3. For each tab, resolve agent + spawn PTY (memory env, agent frame when enabled)
4. Renderer rebuilds pane tree from saved structure + new session ids

## Memory inject

```
Project open ──► ensure .memory/ · warm MemPalace · write auto-context.md
Agent spawn ──► onAgentSpawnFast → env TRUEDECK_* · MCP pointers as configured
```

See [memory-providers.md](./memory-providers.md). Env bag includes `TRUEDECK_PROJECT`, `TRUEDECK_REPO_MEMORY`, `TRUEDECK_PALACE`, `TRUEDECK_AUTO_CONTEXT`, and related keys.

## Agent frame wrap

If `agentFrameTui` is enabled (default true), `pty-manager` calls `maybeWrapAgentFrame`:

```
node truedeck-frame.mjs --agent <id> --name … --cwd <root> -- <resolved CLI> …
```

Shell / `cmd-*` panes only wrap when `frameShellPanes` is true. See [Agent frame](./agent-frame.md).

## MCP hub

`mcp-hub.ts` merges:

1. Built-in **truedeck-hub** (`resources/mcp-server/truedeck-mcp.mjs`)
2. Memory-provider MCP servers
3. User servers in `mcp-servers.json`

Then injects the same stdio set into Cursor / Claude Code / Grok / Codex / Gemini configs and project `.mcp.json`. See [MCP](./mcp.md).

## Task dispatch

`task-dispatch.ts`:

1. Write `.truedeck/tasks/<shortId>.md` + `.truedeck/current-focus.md`
2. Spawn agent with `TRUEDECK_TASK*` env
3. Start a run record; mark task `running`
4. Best-effort seed prompt into PTY after ~1.2s
5. On session exit → task moves toward `review` (or blocked on failure)

## TUI mode

`tui/` is a separate entry (`npm run tui`) that reuses agent resolve / sessions concepts without Electron’s renderer. Packaging and most docs focus on Studio.

## Packaging

`electron-builder` packs `out/**/*` plus `extraResources`:

- `resources/bin` (Rust binaries if present)
- `resources/mcp-server`
- `resources/agent-frame`
- icons

See [Development](./development.md).

## Related deep dives

- [Fast PTY](./FAST-PTY.md) - PTY-only Rust sidecar
- [Rust backend](./RUST-BACKEND.md) - full native service protocol
- [Agents](./agents.md) - resolve and spawn policy
