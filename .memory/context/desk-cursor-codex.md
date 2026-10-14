# Desk Cursor and Codex launch (2026-10-03)

**Status:** current

Cursor Agent is `node.exe` + `index.js`. Keep `--approve-mcps` and `--trust`, and pass the task as a startup argument.

Codex stops on the folder-trust screen until `~/.codex/config.toml` has `trust_level = "trusted"` for that project path. Pass its task as a startup argument too. Typing into either full-screen UI does not submit the task.
