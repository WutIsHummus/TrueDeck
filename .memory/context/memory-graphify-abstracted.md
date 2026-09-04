# Memory + Graphify fully abstracted (2026-07-28)

User request: no user-facing Graphify/memory management.

## Behavior
- Settings: removed Graphify UI; memory section reduced to Preferred CLI only
- Graphify: always auto on project open (build if missing, update if present), after dispatch, after session exit/kill
- Auto-context / AGENTS pointer: tell agents not to ask the user to manage memory/graph
- No Sync graph button, enable toggles, or inject toggles for day-to-day use

## Still under the hood
- TrueMemory `.memory/`, MemPalace mine/wake, graphify-out/, MCP inject on agent start
