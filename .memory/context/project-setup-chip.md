# Automatic project context (not a setup wizard)

## Product rule
Memory, MCP wiring, and project context are **handled for you**.
No note apps to babysit, no memory dashboards, no Docker checklist.
**Open a folder → launch agents → ship.** Context is managed in the backend.

## What happens on open/add
1. Ensure `.memory/` + `.truedeck/auto-context.md` (agents read this)
2. Inject MCP (MemPalace + truedeck-hub) into agent configs
3. Stamp inject for open agent CLIs
4. **Background:** MemPalace mine + Graphify (does not block coding)

## Title bar (soft only)
| State | Chip |
|-------|------|
| Wiring | Preparing context… |
| Ready + mine still running | Memory warming… |
| Ready + indexed | (no chip — stay out of the way) |
| Failed | Retry via click (rare) |

## Sticky "Memory warming…" bug (fixed 2026-07-30)
Background mine used to spawn detached with no `mine-complete.json` stamp.
If the palace wing already had drawers, the chip never cleared.
Fix: stamp on mine completion; reconcile from `mempalace status` on setup-status poll;
UI re-polls every 8s while warming.

## Not user chores
- Do not require hand-written memory notes for "ready"
- Do not open memory provider settings to start coding
- Do not show "set up AI memory" as a task list
