# OpenCode Invalid session ID

**Date:** 2026-08-23

TrueDeck must not pass a UUID to `opencode --session`. OpenCode `--session` continues an existing `ses_*` id only. A UUID makes the CLI exit with `Error: Invalid session ID: unknown error`.

New OpenCode tabs spawn unbound. Restore uses `--session` only when the token matches `^ses_[A-Za-z0-9]{8,}$`.
