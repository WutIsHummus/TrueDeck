# Codex account switch (2026-10-09)

**Status:** current

TrueDeck switches Codex between three ChatGPT accounts. The signed-in account has two workspace slots. The other two accounts have one each.

Each workspace is its own `CODEX_HOME` under `%APPDATA%\truedeck\data\codex-homes`. The original login stays in `~/.codex` and is never deleted. New Codex tabs use the workspace selected in the title bar. A tab that is already running keeps the home it started with. Tabs saved before this switcher restore on the original `~/.codex` login.

Sign in from Settings → Codex. Pick the workspace in the browser. Do not copy `config.toml` between homes. It can contain local secrets. The switcher only writes a small approval preset into new homes.
