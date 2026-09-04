# Agent chrome = Grok-style path/branch/task (2026-07-28)

User compared Grok TUI top bar (cwd · branch · Tasks · context tokens) to TrueDeck.

## What we show (Electron AgentChromeBar, above xterm)
- Agent · live/exit · **task status badge** · role · elapsed
- **Current task title + idea** (from dispatch / focusTitle / focusIdea)
- Project · **git branch** · path · Task: … · worktree

## Fixes
- `task-dispatch` always stamps focusTitle/focusIdea/taskId (was worktree-only bug)
- SessionInfo: taskId, taskStatus, roleLabel, gitBranch, worktreeLabel
- `git:branch` IPC for chrome refresh
- MCP deck worker re-emits session after stamp so UI updates

## Limits
- Grok **context %** (172K/500K) is CLI-internal — not available to TrueDeck
- Free agent tabs (no `truedeck_launch`/dispatch) show path · branch · "no task"
