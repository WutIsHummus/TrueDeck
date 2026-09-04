# CLI sync: inject all selected agents

TrueDeck memory inject syncs MCP + pointers to every agent in `syncedAgentIds`
(or defaults: claude, cursor, codex, grok, gemini, opencode, aider) — not only
the one tab you opened.

See `agent-inject.ts` / `injectMemoryForSyncedAgents`.
