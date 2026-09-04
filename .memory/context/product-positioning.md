# Product positioning (README / marketing)

TrueDeck is for **agentic programming**: multi-agent, multi-CLI workflows on a real project.

- Lead with agents side by side (Grok, Codex, Cursor, Claude, …), real TUIs, pane layout.
- **Memory is abstracted**: automatic context / MCP inject under the hood. Do not market "manage your memory providers" as a user chore.
- Users should not need to think about notes, MemPalace, Docker, or memory dashboards to start coding.
- Install path: **GitHub Releases**, not clone the repo. Docs: GitHub Pages.

## Project open promise
**Memory, MCP wiring, and project context are handled for you.** No note apps to babysit, no memory dashboards to configure, no Docker checklist before you can code. Open a folder, launch agents, ship. Context is managed with memory in the backend.

Implementation: silent `setupProject` on open (auto-context + MCP inject + background MemPalace mine). Title bar only shows soft "Preparing context…" / "Memory warming…" — never a setup wizard.
