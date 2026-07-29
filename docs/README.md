# TrueDeck documentation

**Published site:** [https://wutishummus.github.io/TrueDeck/](https://wutishummus.github.io/TrueDeck/)

Built with [VitePress](https://vitepress.dev/). From the repo root:

```bash
npm run docs:dev # local server (port 5174)
npm run docs:build # output → docs/.vitepress/dist
npm run docs:preview # preview production build
```

GitHub Pages deploys automatically via [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) on pushes to `docs/**` (enable **Settings → Pages → Source: GitHub Actions** once).

---

**TrueDeck 0.3.x** - terminal-first multi-agent coding deck (Electron + React + xterm, Rust `truedeck-backend`).

TrueDeck runs coding agent CLIs (Grok, Codex, Cursor Agent, Claude, Gemini, and more) as live terminal tabs with VS Code-style pane groups, automatic memory inject, a task board, and a unified MCP hub.

| Audience | Start here |
|----------|------------|
| New users | [Getting started](./getting-started.md) |
| Daily use | [User guide](./user-guide.md) · [Keyboard shortcuts](./keyboard-shortcuts.md) |
| Contributors | [Development](./development.md) · [Architecture](./architecture.md) |
| Agents & tooling | [Agents](./agents.md) · [MCP](./mcp.md) · [Task board](./task-board.md) |

---

## Table of contents

### Start

| Page | Description |
|------|-------------|
| [Getting started](./getting-started.md) | Requirements, install, first launch, first agent, first project |
| [User guide](./user-guide.md) | Projects, tabs, panes, task board, settings, session restore, Studio vs TUI |
| [Keyboard shortcuts](./keyboard-shortcuts.md) | Complete shortcut reference |

### Features

| Page | Description |
|------|-------------|
| [Agents](./agents.md) | Supported CLIs, Cursor IDE block, command resolve, spawn path |
| [Task board](./task-board.md) | Kanban tasks, dispatch, task files, env vars, focus file |
| [Agent frame](./agent-frame.md) | In-terminal TrueDeck chrome (`truedeck-frame.mjs`) |
| [Configuration](./configuration.md) | Settings, env vars, data dirs, project config |
| [MCP](./mcp.md) | Unified MCP hub and TrueDeck hub tools |
| [Memory providers](./memory-providers.md) | TrueMemory, MemPalace, OpenMemory, custom backends |
| [BridgeSpace parity](./bridgespace-parity.md) | Gap matrix vs BridgeSpace; Graphify + orchestration roadmap |

### Internals

| Page | Description |
|------|-------------|
| [Architecture](./architecture.md) | Electron main/preload/renderer, PTY backends, layout, MCP, memory |
| [Fast PTY](./FAST-PTY.md) | `truedeck-pty` Rust sidecar and node-pty fallback |
| [Rust backend](./RUST-BACKEND.md) | Full native backend (`truedeck-backend`) protocol and build |
| [Development](./development.md) | Clone, npm scripts, electron-vite, packaging |
| [Troubleshooting](./troubleshooting.md) | Common issues and fixes |
| [Glossary](./glossary.md) | Terms used in the app and docs |

---

## Version

Documentation targets **TrueDeck 0.3.x**. Features described here match the Studio UI (`npm start`) unless noted otherwise for the TUI (`npm run tui`).

## Repo map (quick)

```
TrueDeck/
 src/ # Studio UI (React + xterm + pane groups)
 electron/main/ # PTY, tasks, MCP hub, memory, session restore
 electron/preload/ # IPC bridge
 electron/shared/ # Shared TypeScript types
 resources/agent-frame/ # truedeck-frame.mjs
 resources/mcp-server/ # truedeck-mcp.mjs
 crates/ # Rust backend / PTY
 tui/ # Terminal-only deck
 docs/ # This documentation
```

## License

MIT - see the [root LICENSE](https://github.com/WutIsHummus/TrueDeck/blob/master/LICENSE).
