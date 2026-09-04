# BridgeSpace parity + Graphify (2026-07-28)

## Product direction
TrueDeck = free BridgeSpace-class multi-agent deck. Dual memory stays **TrueMemory + MemPalace**. **Graphify** is the code knowledge graph layer (`graphify-out/`).

## Shipped this pass
- `docs/bridgespace-parity.md` roadmap
- Tab labels use task title / focus via `session-label` (TabBar + SessionGrid)
- `electron/main/graphify-service.ts` — detect, status, sync, env, auto-context section
- Settings: Knowledge graph section (enable, on-open, Sync / Open report)
- IPC `graphify:status` / `graphify:sync` + preload
- MCP `truedeck_graph_status`
- Dispatch schedules graphify `--update`

## Still open (plan)
Roles, worktrees, graphify watch, orchestrator pipelines, full graph query MCP, run history UI, layouts, review panel.
