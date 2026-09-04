# Terminal colors (not monochrome)

Agent CLIs were painting black/white because parent hosts (Cursor/Grok) often set `NO_COLOR=1` / `FORCE_COLOR=0` / `TERM=dumb`, inherited into ConPTY children.

## Fix
- `crates/truedeck-backend/src/sessions.rs`: strip color-silencing env; force `TERM=xterm-256color`, `COLORTERM=truecolor`, `FORCE_COLOR=3`, `CLICOLOR=1`
- `crates/truedeck-backend/src/main.rs` spawn paths: same
- `electron/main/backend-bridge.ts`: strip NO_COLOR when launching backend process
- `TerminalPane.tsx`: full 16-color xterm theme + `drawBoldTextInBrightColors`

## Apply
`npm run build:backend` (needs backend.exe unlocked), restart app, **open new agent tabs** (old sessions keep old env).
