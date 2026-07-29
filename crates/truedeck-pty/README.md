# truedeck-pty

Native PTY host for TrueDeck (Rust + `portable-pty` / ConPTY on Windows).

## Protocol

Newline-delimited JSON on **stdin** (requests) and **stdout** (events). See `src/main.rs`.

## Build

```bash
# requires Rust: https://rustup.rs
cargo build --release
# or from repo root:
npm run build:pty
```

Binary is copied to `resources/bin/truedeck-pty(.exe)` and bundled as an Electron extraResource.

## Runtime

Electron starts the sidecar when present. If missing or spawn fails, TrueDeck uses **node-pty**.

```
TRUEDECK_PTY_BIN=C:\path\to\truedeck-pty.exe   # optional override
```
