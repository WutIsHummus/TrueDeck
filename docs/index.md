# Introduction

**TrueDeck** is for agentic programming: run coding agents side by side on the same project without babysitting memory or ops.

It is a terminal-first multi-agent deck (Electron + React + xterm, optional Rust backend). Put **Grok**, **Codex**, **Cursor Agent**, **Claude**, **Gemini**, and more in live terminal tabs with VS Code-style pane groups. Memory, MCP wiring, and project context stay under the hood so you can open a folder and ship.

| Audience | Start here |
|----------|------------|
| New users | [Getting started](/getting-started) |
| Daily use | [User guide](/user-guide) · [Keyboard shortcuts](/keyboard-shortcuts) |
| Contributors | [Development](/development) · [Architecture](/architecture) |
| Agents and tooling | [Agents](/agents) · [MCP](/mcp) · [Task board](/task-board) |

## What TrueDeck is

- **Agentic multi-CLI** - several agents on one codebase, each in a live PTY tab
- **Studio UI** - thin chrome, almost all terminal (not a three-column IDE)
- **Pane groups** - side-by-side or stacked; each group keeps its own tabs
- **Abstracted memory** - context and MCP inject automatically; no notes dashboard to manage
- **Session restore** - reopen last project and respawn agent tabs after quit

## What it is not

- Not a chat webview (agents keep their own TUIs)
- Not a full IDE (open folders and run agents; no built-in file tree editor)
- Not a memory product you operate (plumbing is automatic)

## Download

Install from the **[Releases](https://github.com/WutIsHummus/TrueDeck/releases)** tab. Do not clone the repo just to run the app.

## Repo map

```
TrueDeck/
  src/                 # Studio UI (React + xterm + pane groups)
  electron/main/       # PTY, tasks, MCP hub, memory, session restore
  electron/preload/    # IPC bridge
  electron/shared/     # Shared TypeScript types
  resources/           # Icons, agent frame, MCP server
  crates/              # Optional Rust backend / PTY
  tui/                 # Terminal-only deck
  docs/                # This documentation site
```

## License

MIT - see the [repository LICENSE](https://github.com/WutIsHummus/TrueDeck/blob/master/LICENSE).
