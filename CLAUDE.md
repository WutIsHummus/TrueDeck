# Agent instructions

<!-- truedeck-memory -->
## TrueDeck memory (automatic)
At session start, read `.truedeck/auto-context.md` for project memory.
Durable facts: write short notes under `.memory/context/` or `.memory/decisions/`.
If MemPalace MCP tools are available, use them for search/recall - do not ask the user to manage memory.
TrueDeck MCP hub tools (`truedeck-hub`): use `truedeck_list_mcp` / `truedeck_add_mcp` / `truedeck_remove_mcp` / `truedeck_apply_mcp` to edit the user's shared MCP config; changes sync to Cursor, Claude, Grok, and other CLIs.
<!-- /truedeck-memory -->
