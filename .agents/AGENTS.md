# Agent instructions

This file is the canonical multi-agent guide for TrueDeck.
All coding CLIs (Claude, Cursor, Codex, Grok, Gemini) should treat this as the shared source of truth.

<!-- truedeck-memory -->
## TrueDeck memory (automatic)
At session start, read `.truedeck/auto-context.md` for project memory.
Durable facts: `.memory/context/` or `.memory/decisions/`; MemPalace MCP for search/recall.
Project agent rules and MCP live under **`.agents/`** (unified for all CLIs).
Canonical instructions: `.agents/AGENTS.md`. Project MCP: `.agents/mcp.json` (mirrored to root `.mcp.json`).
TrueDeck hub (`truedeck-hub`): `truedeck_show`, `truedeck_launch`, `truedeck_peers`, `truedeck_send`, `truedeck_inbox` — app must be running.
Message other TrueDeck agents (other terminals, or another PC running TrueDeck with notes sync) via those tools.
Use only this repo MemPalace wing (auto-context Wing line, or TRUEDECK_MEMORY_WING). Do not file into another repo wing.
When the user teaches how to do a job, file it before continuing: this project MemPalace wing, room jobs, knowledge-graph predicate done_by.
When the user corrects a method, file room corrections, predicate corrected_to, and supersede the old fact. The newest correction is the current method.
Before repeating that kind of work, search rooms jobs and corrections and the knowledge graph. Write a short .memory note too. Never store secrets.
Do not ask the user to manage memory, Graphify, or MCP wiring.
<!-- /truedeck-memory -->

## Project MCP
Project MCP servers: `.agents/mcp.json` (also mirrored to root `.mcp.json` for tools that only read the root).

## Taught jobs and corrections

MemPalace wing: `truedeck-09d5b6c7`. Palace: `C:\Users\alper\.mempalace\palace`.

Rooms: `jobs` holds a method the user walked you through. `corrections` holds a method the user fixed. The knowledge graph is the mind map (`done_by`, `corrected_to`). The newest correction is the current method.

Before a similar job, search those rooms and query the graph for the system name. When the user teaches or corrects, file the drawer, the graph fact, and a short note under `.memory/` in that same turn. Steps live in `.memory/patterns/remember-teaching.md`.

This is TrueDeck's own memory. Lessons about the deck, its agents, MCP, panes, and memory wiring belong in this wing. Never store secrets.
