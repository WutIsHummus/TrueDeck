# Introduction

**TrueDeck 0.3.x** is a terminal-first multi-agent coding deck (Electron + React + xterm, optional Rust backend).

It runs coding agent CLIs - **Grok**, **Codex**, **Cursor Agent**, **Claude**, **Gemini**, and more - as live terminal tabs with VS Code-style pane groups, automatic memory inject, and a unified MCP hub.

| Audience | Start here |
|----------|------------|
| New users | [Getting started](./getting-started) |
| Daily use | [User guide](./user-guide) · [Keyboard shortcuts](./keyboard-shortcuts) |
| Contributors | [Development](./development) · [Architecture](./architecture) |
| Agents & tooling | [Agents](./agents) · [MCP](./mcp) · [Task board](./task-board) |

## What TrueDeck is

- **Studio UI** - thin chrome, almost all terminal (not a three-column IDE)
- **Multi-agent tabs** - one live PTY per agent
- **Pane groups** - side-by-side or stacked; each group has its own tabs
- **Automatic memory** - MCP / project pointers injected into preferred CLIs
- **Session restore** - reopen last project and respawn agent tabs after quit

## What it is not

- Not a replacement for your coding agent’s own TUI (Grok, Claude, etc. still own their UI)
- Not a full IDE (no built-in file tree editor - open folders, run agents)
- Not Docker-required for core memory (TrueMemory files + optional MemPalace native)

## Repo map

```
TrueDeck/
 src/ # Studio UI (React + xterm + pane groups)
 electron/main/ # PTY, tasks, MCP hub, memory, session restore
 electron/preload/ # IPC bridge
 electron/shared/ # Shared TypeScript types
 resources/ # Icons, agent frame, MCP server
 crates/ # Optional Rust backend / PTY
 tui/ # Terminal-only deck
 docs/ # This documentation site
```

## License

MIT - see the [repository LICENSE](https://github.com/WutIsHummus/TrueDeck/blob/master/LICENSE).
