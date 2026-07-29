# Agents

TrueDeck runs **CLI coding agents** in PTY sessions. It does not embed model SDKs; each agent is an external binary resolved on disk / `PATH`.

## Built-in presets

Defaults live in `electron/main/agents.ts` (merged with `agents.json` so new defaults always appear):

| Id | Name | Command | Install (typical) |
|----|------|---------|-------------------|
| `grok` | Grok | `grok` | `npm install -g @xai/grok` |
| `codex` | Codex | `codex` | `npm install -g @openai/codex` |
| `cursor` | Cursor Agent | `cursor-agent` | Windows: `irm https://cursor.com/install?win=1 \| iex` · Unix: `curl https://cursor.com/install -fsS \| bash` |
| `claude` | Claude | `claude` | Windows: Claude install.ps1 · Unix: install.sh |
| `gemini` | Gemini | `gemini` | `npm install -g @google/gemini-cli` |
| `shell` | Shell | `powershell.exe` / `$SHELL` | Built-in |
| `opencode` | OpenCode | `opencode` | `npm install -g opencode-ai` |
| `aider` | Aider | `aider` | `pip install aider-chat` |

Each preset has `color`, `icon`, `description`, and optional `installCommand` for UI hints.

User overrides in `agents.json` may change names/colors; **command / args / install for built-ins prefer defaults** so the CLI-only Cursor policy stays enforced.

## CLI-only policy (Cursor IDE blocked)

TrueDeck **never launches Cursor IDE** (or VS Code) as an agent.

| Allowed | Blocked |
|---------|---------|
| `cursor-agent` under `%LOCALAPPDATA%\cursor-agent\…` | `Cursor.exe`, IDE `cursor.cmd` under Program Files |
| `node.exe` + `index.js` from a cursor-agent version dir | Paths matching `isIdeBinary()` in `resolve-command.ts` |
| PATH entries that clearly are `cursor-agent` | Bare `cursor` command name |

Hard blocks also exist at spawn time in `pty-manager.ts` if resolve slipped:

```
Blocked: Cursor IDE cannot be spawned. Use cursor-agent CLI only.
```

### How Cursor Agent is resolved

`resolveCursorAgent()` prefers:

1. Newest `%LOCALAPPDATA%\cursor-agent\versions\<ver>\` with `node.exe` + `index.js`
2. Root `cursor-agent` install layout
3. PATH `cursor-agent` only if the path is clearly the agent (not IDE)

If missing, `available: false` and the install one-liner is shown in the palette.

## Command resolve

`resolveAgentCommand(agentId, command, args)` (`electron/main/resolve-command.ts`):

1. Special-case `cursor` → `resolveCursorAgent`
2. Special-case `shell` → PowerShell / bash
3. Reject IDE binaries
4. Absolute path if it exists
5. `where.exe` / `which` on PATH (Windows prefers `.cmd` then `.exe`)
6. Known locations (npm global, nvm4w, `~/.grok/bin`, `~/.local/bin`, …)

Results are cached ~5 minutes (`whichCache` / `resolveCache`). Palette probes force a fresh resolve per agent.

## Spawn path

When you pick an agent or dispatch a task:

```
UI / task-dispatch
 → load agent preset
 → resolveAgentCommand
 → memory env (TRUEDECK_*)
 → maybeWrapAgentFrame (optional)
 → PtyManager.spawn (rust or node-pty)
 → SessionInfo to renderer
```

Environment always includes (among others):

| Variable | Meaning |
|----------|---------|
| `TRUEDECK` | `1` |
| `TRUEDECK_AGENT` | Agent id |
| `TRUEDECK_PROJECT` | Project root (cwd) |
| `TRUEDECK_RESOLVED` | Resolve source label (+ `+frame` if framed) |
| `TRUEDECK_PTY` | Backend id (`rust` / node) |
| `TERM` / `COLORTERM` / `TERM_PROGRAM` | Terminal identity for agent TUIs |

Task dispatch adds `TRUEDECK_TASK`, `TRUEDECK_TASK_FILE`, `TRUEDECK_TASK_TITLE`, `TRUEDECK_TASK_IDEA`. See [Task board](./task-board.md).

If the CLI is missing, spawn throws with the install hint.

## Agent palette

**Ctrl+T** opens the palette (requires an open project). Entries can show probe availability (`available`, `resolvedFrom`, `installCommand`). Installing a CLI outside TrueDeck is required for non-shell agents.

## Custom / command sessions

- **On-open commands** and ad-hoc project commands spawn as `kind: 'command'` with synthetic agent ids like `cmd-…`
- Command panes are **not** wrapped in the agent frame by default (same rule as shell unless `frameShellPanes` is on)

## Reset presets

Settings → Agents can reset agents to defaults (`getDefaultAgents` / save). Use this if `agents.json` drifts.

## Related

- [Agent frame](./agent-frame.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md#cursor-ide-blocked-or-cursor-agent-missing)
