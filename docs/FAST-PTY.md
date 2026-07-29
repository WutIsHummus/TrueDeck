# Fast terminals & Rust PTY backend

> Part of TrueDeck **0.3.x** docs. See the [documentation home](./README.md) and [Architecture](./architecture.md) for the full product picture. Full native service: [RUST-BACKEND.md](./RUST-BACKEND.md).

## Architecture

```
Electron main (TypeScript)
 │
 ├─ prefer ──► truedeck-pty (Rust sidecar, portable-pty / ConPTY)
 │ JSON-lines over stdio
 │
 └─ fallback ► node-pty (existing native module)
```

| Layer | Role |
|-------|------|
| **truedeck-pty** | Spawn / write / resize / kill; stream PTY bytes as base64 JSON events |
| **rust-pty-host.ts** | Spawn sidecar, parse events, hand off to PtyManager |
| **pty-manager.ts** | Session map, SessionInfo, IPC to renderer; auto-fallback |

## Build the Rust host

1. Install Rust: https://rustup.rs 
 ```powershell
 # after rustup-init -y, open a NEW terminal so PATH has cargo
 rustc --version
 cargo --version
 ```
2. From repo root:
 ```bash
 npm run build:pty
 ```
 Copies `crates/truedeck-pty/target/release/truedeck-pty.exe` → `resources/bin/`.

3. `npm start` - main log should show:
 ```
 [pty] backend: rust (truedeck-pty)
 ```
 or `node-pty` if the binary is missing.

Override:

```powershell
$env:TRUEDECK_PTY_BIN = "C:\path\to\truedeck-pty.exe"
```

## What Rust helps (and what it doesn’t)

| Helps | Doesn’t change |
|-------|----------------|
| Lower per-pane I/O overhead | Claude/Codex/Cursor cold start |
| Multi-session multiplexing in native code | Network / model latency |
| Cleaner path to a future fully-native host | MemPalace wake-up (already backgrounded) |

App-side spawn is already fast (`onAgentSpawnFast` + inject cache). Rust is the **PTY engine**.

## Dev tips

```bash
cd crates/truedeck-pty
cargo run --release
# type: {"type":"ping"}
# expect: {"type":"pong"}
```

Windows needs a C++ build tools / MSVC toolchain for `portable-pty` (comes with Visual Studio Build Tools or full VS).
