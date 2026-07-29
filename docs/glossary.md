# Glossary

Terms used in TrueDeck docs and UI.

## Agent

A coding CLI preset (Grok, Codex, Cursor Agent, Claude, …) or a plain shell. Spawned as a PTY session, not an in-process model SDK.

## Agent frame / frame TUI

In-terminal chrome (`truedeck-frame.mjs`) that reserves a header band above the child agent TUI. Controlled by `agentFrameTui` / `frameShellPanes`. See [Agent frame](./agent-frame.md).

## AptInt

**Not used in TrueDeck.** AptInt is an arbitrary-precision integer type from other projects (e.g. SPTS Roblox stats). TrueDeck does not implement AptInt.

## Auto-context

Generated markdown at `.truedeck/auto-context.md` summarizing project memory pointers for agents. Refreshed on project open / agent spawn.

## Backend (Rust)

Optional `truedeck-backend` sidecar owning PTY and related RPC. Falls back to TypeScript + node-pty. See [RUST-BACKEND.md](./RUST-BACKEND.md).

## Tasks / launch

Task records + MCP launch (`truedeck_launch`) that dispatch to real agent PTYs. No board UI - see [Task board](./task-board.md) and [MCP](./mcp.md).

## Command session

A PTY started from an on-open or ad-hoc shell command (`kind: 'command'`), not a named agent preset. Optionally framed only if `frameShellPanes` is on.

## Dispatch

Spawning an agent for a board task: write task file, set env, create run, seed prompt. Implemented in `task-dispatch.ts`.

## Group (pane group)

A leaf in the pane tree: its own tab bar and active tab. Multiple groups appear side-by-side or stacked after a split.

## Hub (MCP hub)

Unified MCP configuration managed by TrueDeck and synced to agent clients. Built-in server id `truedeck-hub`. See [MCP](./mcp.md).

## Leaf

A pane-tree node that holds tab indices and an active tab (not a split).

## Memory / TrueMemory

Markdown notes under `.memory/` (repo) and the global memory directory. Always available offline. Distinct from MemPalace graph storage.

## MemPalace / palace

Optional native memory backend (graph/vector “palace”). Path often `~/.mempalace/palace` or Settings `palacePath`. See [memory-providers.md](./memory-providers.md).

## On-open command

Shell command associated with a project that can spawn when the project opens (e.g. `rojo serve`).

## Pane

A rectangular terminal region (leaf group). Splits create more panes up to 16.

## Project

A tracked folder (`ProjectConfig`) with root path, recents, on-open commands, and default agents.

## PTY

Pseudo-terminal hosting an agent or shell. Engines: node-pty or Rust sidecars.

## Resolve / resolve-command

Mapping agent id + command name to an on-disk executable, with IDE blocking for Cursor. See [Agents](./agents.md).

## Run

A recorded agent execution linked to a task (`AgentRun`: start/end times, exit code, session id).

## Session

A live (or exited) PTY instance tracked as `SessionInfo` with agent metadata and project root.

## Session layout

Persisted snapshot of tabs + pane tree (`session-layout.json`) used for restore.

## Split

A pane-tree node with direction (`row` / `column`), ratio, and two children. Created via **Ctrl+D** (vertical) / **Ctrl+X** (horizontal) or drag-drop.

## Studio UI

Electron + React + xterm interface (`npm start`). Contrasts with the optional Blessed TUI (`npm run tui`).

## Task

Kanban card (`Task`) with status, assignee agent, and optional session/run links.

## TUI

1. TrueDeck’s optional terminal-only app mode 
2. Any agent’s full-screen terminal UI (Codex, Claude Code, …)

## Wing

MemPalace naming concept: a project-scoped area inside the palace (`TRUEDECK_MEMORY_WING`).

## xterm

The browser terminal emulator in the renderer (`xterm` + Fit / WebLinks addons) attached to PTY data over IPC.
