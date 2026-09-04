# Cursor Agent MCP under TrueDeck (2026-07-30)

## Issue
Cursor CLI often reports MemPalace / truedeck-hub as missing even when
`~/.cursor/mcp.json` and project `.agents/mcp.json` are injected correctly.

## Cause
`cursor-agent` requires **workspace trust** + **MCP approval** before tools load.
TrueDeck was spawning without `--trust` / `--approve-mcps`.

## Fix
- Default cursor preset args: `--approve-mcps --trust`
- `prepareNewSessionSpawn` / resume always inject those flags + `--workspace <project>`

## File memory still works without MCP
`.truedeck/auto-context.md`, `.agents/AGENTS.md`, `.memory/` are readable via tools/files even if MCP is down.

## Blank terminal until keystroke (2026-07-30)
- Cause: new tabs used `create-chat` + `--resume` (empty chat) + weak first-paint WINCH on ConPTY.
- Fix: new Cursor tabs spawn interactive unbound (`--approve-mcps --trust --workspace`); denser WINCH/focus kicks in `TerminalPane` until first paint.
- Restore still uses `--resume <id>` when a token is saved.
