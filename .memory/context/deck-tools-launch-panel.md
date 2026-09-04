# Deck Tools redesign (Ctrl+B)

Ctrl+B is a **goal-first launch panel**, not a five-tab settings dump.

## Primary flow
1. Write a goal (+ optional details)
2. Pick agent (pills) + optional role
3. Open agent → `createTask` + `dispatchTask` seeds PTY with task brief

## Secondary
- Starter goal chips (review, explain, bugs, tests, fix, docs)
- Active/recent tasks (jump to live session when sessionId known)
- Team pipelines (Feature, Bugfix, …)
- Pane layouts (shell grid)
- Collapsible git status + run history

## Not
- Blank terminal (that's Ctrl+T)
- Graphify/memory management UI (automatic)
