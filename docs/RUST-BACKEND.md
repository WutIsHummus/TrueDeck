# Rust backend (truedeck-backend)

> Part of TrueDeck **0.3.x** docs. See the [documentation home](./README.md) and [Architecture](./architecture.md). PTY-only experiment: [FAST-PTY.md](./FAST-PTY.md).

TrueDeck’s native backend runs as a **sidecar process**. Electron keeps the window + React UI; the Rust service owns PTY, projects, settings, layout, and memory inject.

```
Renderer ──IPC──► Electron (thin bridge) ──stdio JSON-RPC──► truedeck-backend
```

## Build

1. Free disk space (toolchain needs several GB).
2. Install [rustup](https://rustup.rs) + MSVC Build Tools (Windows).
3. From repo root:

```bash
npm run build:backend
# → resources/bin/truedeck-backend.exe
npm start
```

Log line when active:

```
[backend] rust truedeck-backend 0.1.0
```

If the binary is missing, TrueDeck falls back to **TypeScript + node-pty**.

## Override path

```powershell
$env:TRUEDECK_BACKEND_BIN = "C:\path\to\truedeck-backend.exe"
$env:TRUEDECK_DATA_DIR = "C:\path\to\TrueDeck\data" # default = app userData/data
```

## Protocol

Newline-delimited JSON:

```json
{"id":1,"method":"sessions.spawn","params":{"projectRoot":"C:/repo","agentId":"shell"}}
{"id":1,"ok":true,"result":{"id":"...","agentName":"Shell",...}}
{"event":"pty.data","params":{"id":"...","data_b64":"..."}}
{"event":"pty.exit","params":{"id":"...","exitCode":0}}
```

Methods: `sessions.*`, `projects.*`, `agents.*`, `settings.*`, `layout.*`, `memory.*`, `onboarding.*`, `ping`, `shutdown`, `backend.info`.

## Crate layout

```
crates/truedeck-backend/
 src/
 main.rs # RPC loop
 sessions.rs # portable-pty
 projects.rs
 agents.rs
 settings.rs
 memory/
 resolve.rs
 protocol.rs
```

Legacy `crates/truedeck-pty` remains as a PTY-only experiment; prefer `truedeck-backend`.
