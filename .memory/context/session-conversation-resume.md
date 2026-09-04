# Session conversation resume (session ids)

## Rule
Never restore with `--last` / bare `--continue`. Persist a real CLI conversation id per tab (`resumeToken`) and resume with that id only.

## Bind on spawn
| Agent | New session | Restore |
|-------|-------------|---------|
| Grok | `--session-id <uuid>` | `--resume <uuid>` |
| Claude | `--session-id <uuid>` | `--resume <uuid>` |
| Gemini | `--session-id <uuid>` | `--resume <uuid>` |
| Cursor | `create-chat` → `--resume <id>` | `--resume <id>` |
| Codex | spawn normal; scrape `~/.codex/sessions/**/rollout-*.jsonl` session_meta.cwd | `resume <id>` |
| OpenCode | spawn unbound (no `--session`) | `--session ses_*` only. Never a UUID — OpenCode exits with `Invalid session ID`. |

## Persist
`SavedSessionTab.resumeToken` + `SessionInfo.resumeToken` via layout persist (`tabs[]`).

## Files
- `electron/main/agent-resume.ts`
- `electron/main/index.ts` (spawn, restore, openProject)
- `electron/main/task-dispatch.ts`

## Note
Tabs saved before this change have no token: first restore opens a **new** bound session and saves its id. Subsequent restarts reattach that conversation.
