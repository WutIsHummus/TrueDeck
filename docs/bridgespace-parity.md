# TrueDeck vs BridgeSpace - product gaps

TrueDeck aims to be a **free, open-source BridgeSpace-class multi-agent deck**: real CLI agents in a terminal grid, a kanban that dispatches them, dual memory, and (next) a code knowledge graph + orchestration.

TrueDeck identity: **orchestrate vendor CLIs** (Grok, Codex, Claude, Cursor Agent, …) - not replace them with an in-house chat IDE.

## Memory layers (dual + graph)

| Layer | Role | Status |
|-------|------|--------|
| **TrueMemory** | Markdown under `.memory/` + global app-data notes | Shipped |
| **MemPalace** | Graph/vector palace via native MCP | Shipped (optional native) |
| **Graphify** | Code/structure graph (`graphify-out/`) | **Automatic** (under the hood) |

**User-facing:** memory and Graphify stay automatic. Choose which CLIs to keep wired (`syncedAgentIds`; default = all coding agents). TrueDeck injects MCP + memory into those CLIs on project open and agent launch, warms palace + graph, and refreshes the graph after agent work.

Agents still use all three when available via `.truedeck/auto-context.md` and env.

## Gap matrix (summary)

| Area | BridgeSpace | TrueDeck | Status |
|------|-------------|----------|--------|
| Multi-pane agent terminals (≤16) | Yes | Nested pane dock, `MAX_PANES=16` | **Have** |
| Named layout presets | Yes | Session restore only | Missing |
| Kanban → dispatch agent | BridgeBoard | Task board + `dispatchTask` | **Have** |
| Multi-agent pipelines / swarm | BridgeSwarm | Roles + orchestrator | **Building** |
| Git worktree isolation | Common | Setting stub | **Building** |
| Knowledge graph | Product UI | Graphify integrate + sync | **Building** |
| Memory product | BridgeMemory | Dual TrueMemory + MemPalace | **Have** (polish UX) |
| Review / browser / voice / SSH | Yes | Not started | Later packs |

## Delivery phases (status)

| # | Phase | Status |
|---|--------|--------|
| 0 | Docs + tab labels | Done |
| 1 | Graphify core (auto) | Done |
| 2 | Agent roles | Done |
| 3 | Git worktree isolation | Done |
| 4 | Graphify auto sync | Done |
| 5 | Pipelines + orchestrator | Done (`truedeck_start_pipeline` MCP) |
| 6 | Graph + dual memory in context | Done (auto-context / env) |
| 7 | Run history | Done (task/run store; list via MCP) |
| 8 | Layouts + review | Done (IPC/layouts; review via git tools) |
| 9 | Browser / voice / SSH | Deferred (optional packs) |

**Deck actions are MCP-first** (`truedeck_launch`, pipelines, tasks) - no deck tools UI panel.

## Related

- [Task board](./task-board.md) 
- [Memory providers](./memory-providers.md) 
- [Architecture](./architecture.md) 
- [MCP](./mcp.md) 
