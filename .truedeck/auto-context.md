# TrueDeck auto-context (managed - do not hand-edit)

Memory and the project knowledge graph are fully automatic. The user does not manage notes, MemPalace, Graphify, or Docker.

## Protocol
- At session start: treat this file as wake-up context.
- Read shared agent rules from **`.agents/AGENTS.md`**.
- Durable facts: write short notes under `.memory/context/` or `.memory/decisions/`, and use MemPalace when it is available.
- When the user teaches a job, file MemPalace room jobs (predicate done_by) before continuing. When the user corrects a method, file room corrections (predicate corrected_to) and supersede the old fact.
- Before repeating that kind of work, search rooms jobs and corrections and the knowledge graph. The newest correction is the current method. Never store secrets.

## Project
- Root: `C:\Users\alper\TrueDeck`
- Wing: `truedeck-09d5b6c7`

## Paths
- Agent instructions: `C:\Users\alper\TrueDeck\.agents\AGENTS.md`
- Repo memory: `C:\Users\alper\TrueDeck\.memory`
- Palace: `C:\Users\alper\.mempalace\palace`
- How to file a lesson: `.memory/patterns/remember-teaching.md`
