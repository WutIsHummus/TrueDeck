# Unified `.agents/` folder (2026-07-30)

## Rule
TrueDeck uses **one project folder** for multi-CLI agent config — not separate `.cursor/`, Claude-only trees, or per-tool instruction files as the source of truth.

## Layout
```
.agents/
  AGENTS.md     # canonical instructions + TrueDeck memory pointer
  mcp.json      # project MCP (mcpServers)
  README.md     # human explainer
AGENTS.md       # thin bridge → .agents/AGENTS.md
CLAUDE.md       # thin bridge → .agents/AGENTS.md
.mcp.json       # mirror of .agents/mcp.json (tools that only read root)
```

## Global
- `~/.agents/truedeck-memory.md` — shared note (replaces per-CLI `~/.codex/truedeck-memory.md`, `~/.grok/…`)

## Still product-specific (required by CLIs)
User-home MCP inject remains for Cursor/Claude/Grok/Codex/Gemini so each app loads servers. Project-local **vendor folders are no longer written** by TrueDeck.

## Agent injection (required path)
Inject and spawn **always** ensure `.agents/`:
- `injectMemoryForAgent` → `ensureUnifiedAgentsFolder({ force })` + MCP to `.agents/mcp.json`
- `onAgentSpawnFast` / `memoryEnv` → `agentsEnv()` exports:
  - `TRUEDECK_AGENTS_DIR`
  - `TRUEDECK_AGENTS_MD`
  - `TRUEDECK_AGENTS_MCP`
  - `TRUEDECK_GLOBAL_AGENTS` / `TRUEDECK_GLOBAL_AGENTS_NOTE`
- `writeAutoContext` documents `.agents/` paths in protocol + Paths section
- Rust fallback inject (`memory/inject.rs` + `ensure_agent_pointer`) mirrors the same layout

## Code
- `electron/main/agents-folder.ts`
- `electron/main/agent-inject.ts`
- `electron/main/mcp-hub.ts`
- `electron/main/memory-service.ts`
- `crates/truedeck-backend/src/memory/mod.rs`
- `crates/truedeck-backend/src/memory/inject.rs`
