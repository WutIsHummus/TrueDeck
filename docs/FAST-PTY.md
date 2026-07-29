# Terminal engine

Sessions use **`truedeck-backend`** only (Rust). See [RUST-BACKEND.md](./RUST-BACKEND.md).

| Engine | Role |
|--------|------|
| **truedeck-backend** | Required session engine (`npm run build:backend`) |

```bash
npm run build:backend
# → resources/bin/truedeck-backend.exe
npm start
```

Log when healthy:

```
[backend] primary engine: rust truedeck-backend …
```
