# Deck actions are MCP-first (no Ctrl+B panel)

User preference (2026-07-28): Deck Tools UI caused friction; prefer MCP.

## What agents use
- `truedeck_launch` — goal + agent/role → live PTY in TrueDeck
- `truedeck_show` — text/code/md in interactive pop-out + document tab (scroll/select/copy)
- `truedeck_dispatch` — existing task id → PTY
- `truedeck_start_pipeline` — multi-agent recipes
- `truedeck_list_agents` / `truedeck_list_roles` / `truedeck_list_pipelines` / `truedeck_list_tasks`
- MCP hub edit tools unchanged (`truedeck_add_mcp`, …)

## How it works
MCP writes `deck-command-queue.json` under TrueDeck data dir.
Electron `startDeckCommandWorker` polls and runs createTask + dispatchTask / startPipeline.
TrueDeck app must be open for live PTYs.

## Removed
- Ctrl+B Deck Tools panel, toolbar button, TaskBoard/DeckTools components
