# Development

Build and run TrueDeck from source. Product docs: [Getting started](./getting-started.md).

## Prerequisites

- **Node.js 20+**
- **npm** (lockfile is npm)
- **Git**
- **Rust** + MSVC Build Tools (Windows) for `truedeck-backend`
- Agent CLIs you want to test (`claude`, `codex`, `cursor-agent`, …)

## Clone and install

```bash
git clone https://github.com/WutIsHummus/TrueDeck.git
cd TrueDeck
npm install
```

`postinstall` runs `electron-builder install-app-deps` so `node-pty` matches Electron’s ABI.

## Scripts (`package.json`)

| Script | What it does |
|--------|----------------|
| `npm start` / `npm run studio` / `npm run dev` | Electron Studio via **electron-vite** dev |
| `npm run tui` / `npm run dev:tui` | Blessed TUI (`tsx tui/index.ts`) |
| `npm run build` | Production compile → `out/` |
| `npm run preview` | electron-vite preview |
| `npm run icons` | Regenerate PNG/ICO from `resources/icon.svg` |

| `npm run build:backend` | Build `truedeck-backend` → `resources/bin/` |
| `npm run dist` | icons + backend + build + electron-builder `--dir` |
| `npm run dist:win` | Windows NSIS + portable installer |
| `npx truedeck` | CLI entry (`bin/truedeck.js`) when linked |

## electron-vite layout

| Source | Output role |
|--------|-------------|
| `electron/main/` | Main process |
| `electron/preload/` | Preload bridge |
| `src/` | Renderer (React) |
| `electron.vite.config.ts` | Build config |

TypeScript projects: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`.

## Rust backend

### Full backend

```bash
npm run build:backend
npm start
# log: [backend] rust truedeck-backend …
```

Details: [RUST-BACKEND.md](./RUST-BACKEND.md).

### PTY-only sidecar

```bash
npm run build:backend
# log: [backend] primary engine: rust truedeck-backend
```

Details: [FAST-PTY.md](./FAST-PTY.md).

Without binaries, TypeScript + **node-pty** is the fallback.

## Packaging

Requires **Rust** (`cargo` on `PATH`) so `truedeck-backend` is compiled into `resources/bin/` (gitignored) before electron-builder packs it.

| Script | Platform | Outputs (under `release/`) |
|--------|----------|----------------------------|
| `npm run dist:win` | Windows | NSIS installer + portable `.exe` |
| `npm run dist:mac` | macOS | `.dmg` + `.zip` |
| `npm run dist:linux` | Linux | `.AppImage` |
| `npm run dist` | current OS | unpacked dir only (`--dir`) |

```bash
npm run dist:win   # on Windows
npm run dist:mac   # on macOS
```

Extra resources include:

- `resources/bin` (native `truedeck-backend` for that OS/arch)
- `resources/mcp-server`
- `resources/agent-frame`
- icons

`appId`: `dev.truedeck.app`.

### CI / GitHub Releases

[`.github/workflows/release.yml`](../.github/workflows/release.yml) packages on:

- **windows-latest** → Windows x64
- **macos-latest** → macOS arm64 (native) and macOS x64 (cross-compiled Electron + Rust target)

Triggers:

- Push a version tag (`v*`) → build all platforms and publish assets to that release
- **workflow_dispatch** with `release_tag` (e.g. `v0.3.2`) → rebuild and attach assets to an existing release
- **workflow_dispatch** without a tag → upload workflow artifacts only

macOS CI builds are **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Users may need right-click → Open or `xattr -cr` on first launch.

## Repo layout for contributors

```
src/ # Studio UI
electron/main/ # Main process services
electron/preload/ # IPC surface
electron/shared/types.ts
resources/agent-frame/ # truedeck-frame.mjs
resources/mcp-server/ # truedeck-mcp.mjs
crates/truedeck-backend/

tui/ # Non-Electron deck
tools/ # icon generator, rust build helpers, MemPalace scripts
docs/ # Documentation site (this folder)
```

## Coding notes

- Prefer editing documentation under `docs/` and root `README.md` for user-facing changes
- Agent memory protocol for work *in other repos* is separate (TrueDeck injects into those projects)
- Do not commit secrets; agent CLI auth stays with each vendor CLI
- Windows ConPTY quirks: test real agent TUIs after PTY changes

## Contributing

There is no separate `CONTRIBUTING.md` in-repo yet. Practical guide:

1. Fork / branch from the default branch
2. Keep changes focused; match existing TypeScript style
3. Document user-visible behavior under `docs/`
4. Verify `npm start` still launches; if you touch PTY, test spawn + resize + exit
5. Open a PR with a short summary of behavior and any new env/settings keys

License: MIT ([LICENSE](https://github.com/WutIsHummus/TrueDeck/blob/master/LICENSE)).

## Related

- [Architecture](./architecture.md)
- [Troubleshooting](./troubleshooting.md)
- [Configuration](./configuration.md)
