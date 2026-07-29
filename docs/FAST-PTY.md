# Fast terminals (historical)

> Sessions now use **`truedeck-backend`** only. See [RUST-BACKEND.md](./RUST-BACKEND.md).

The old `truedeck-pty` sidecar and `rust-pty-host.ts` path are **removed from the runtime**. Emergency fallback (if the Rust backend binary is missing) is **node-pty** via `pty-manager.ts`.

## Current path

| Priority | Engine |
|----------|--------|
| Primary | `truedeck-backend` (`npm run build:backend`) |
| Emergency | `node-pty` (npm native dep) |

## Build primary backend

```bash
npm run build:backend
# → resources/bin/truedeck-backend.exe
npm start
```

Log when healthy:

```
[backend] primary engine: rust truedeck-backend …
```
