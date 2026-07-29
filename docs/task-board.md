# Tasks & launch (MCP-first)

Tasks dispatch real agent CLI sessions. There is **no board UI panel** - agents (and you) use **TrueDeck MCP hub** tools.

## Primary flow

```
truedeck_launch({ title, body?, agentId?, roleId?, isolate? })
 → queue → Electron createTask + dispatchTask → live PTY tab
```

TrueDeck must be running. See [MCP](./mcp.md).

## Columns / statuses

| Status | Meaning |
|--------|---------|
| `backlog` | Captured, not ready |
| `ready` | Ready to run |
| `running` | Agent session attached |
| `review` | Session exited; human reviews outcome |
| `done` | Finished |
| `blocked` | Stuck / failed path |

Types: `TaskStatus` in `electron/shared/types.ts`.

## Task model

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `projectRoot` | Owning project path |
| `title` / `body` | Human-readable work |
| `status` | Kanban column |
| `assigneeAgentId` | e.g. `claude`, `codex`, `grok`, `cursor`, `shell` |
| `sessionId` | Live PTY session when running |
| `runIds` | Agent run history |
| `createdAt` / `updatedAt` | Epoch ms |

Store file (app data): `tasks.json` under the global data directory.
Command queue: `deck-command-queue.json` (MCP → Electron).

Without a project, the board shows a hint to open a folder first.

## Dispatch pipeline

`electron/main/task-dispatch.ts` → `dispatchTask(taskId, agentIdOverride?)`:

1. Load task; resolve agent preset (default `shell` if unassigned)
2. **Write task file** under the repo:

 ```
 <projectRoot>/.truedeck/tasks/<first-8-of-uuid>.md
 ```

 Markdown includes title, status, agent, instructions body, and a short TrueDeck footer (summarize when done; board moves to **Review** on session exit).

3. **Write focus file** for the agent-frame header:

 ```
 <projectRoot>/.truedeck/current-focus.md
 ```

4. Build env via `onAgentSpawnFast` plus:

 | Env | Content |
 |-----|---------|
 | `TRUEDECK_TASK` | Full task id |
 | `TRUEDECK_TASK_FILE` | Absolute path to task `.md` |
 | `TRUEDECK_TASK_TITLE` | Title (≤ 80 chars) |
 | `TRUEDECK_TASK_IDEA` | Title + first sentence of body (≤ 160 chars) |

5. `ptyManager.spawn` with `extraEnv`
6. `startRun` + attach run to task; status → `running`
7. After ~**1200 ms**, best-effort write a seed prompt into the PTY (Windows uses `\r` line endings)

Seed text points the agent at the relative task file and asks for durable notes under `.memory/` when relevant.

## On session exit

`tasks.onSessionExit(sessionId, exitCode)` moves a linked `running` task toward **review** (or blocked depending on exit handling). Check `tasks.ts` for exact exit mapping.

## Project files (in-repo)

| Path | Role |
|------|------|
| `.truedeck/tasks/*.md` | Per-task instructions for agents |
| `.truedeck/current-focus.md` | One-line “main idea” for [agent frame](./agent-frame.md) |
| `.truedeck/auto-context.md` | Session memory auto-context (related, not board-only) |

These are safe to commit or gitignore depending on your team’s preference. TrueDeck recreates them on dispatch / project open as needed.

## MCP task tools

Agents with the TrueDeck hub MCP can manage the shared store:

| Tool | Purpose |
|------|---------|
| `truedeck_list_tasks` | List tasks (optional `projectRoot`) |
| `truedeck_create_task` | Create card (does not auto-dispatch a PTY) |
| `truedeck_update_task` | Patch title/body/status/assignee |

Creating a task via MCP does **not** spawn an agent; the human still uses Run/dispatch in TrueDeck for a live PTY. See [MCP](./mcp.md).

## Worktree isolation

`AppSettings.worktreeIsolationDefault` exists for future git worktree isolation on dispatch (default **false** / not required for board use today).

## Related

- [Agents](./agents.md) - spawn and resolve
- [Agent frame](./agent-frame.md) - idea line sources
- [User guide](./user-guide.md)
