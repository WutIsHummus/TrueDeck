# Memory in TrueDeck (automatic)

> Part of TrueDeck **0.3.x** docs. See the [documentation home](./README.md), [Configuration](./configuration.md), and [MCP](./mcp.md).

**You do not manage memory in the UI.** TrueDeck abstracts it:

1. On **project open** → ensure `.memory/`, warm MemPalace (native), background mine, write `.truedeck/auto-context.md`
2. On **agent spawn** → refresh auto-context, inject `TRUEDECK_*` env paths
3. Agents that read `AGENTS.md` / `CLAUDE.md` get a one-line pointer automatically

Memory is abstracted: TrueDeck injects MCP / project pointers into your preferred CLI. No status badge to manage.

---

# Memory providers (advanced / power users)

TrueDeck treats “mem space” as a **pluggable backend**, not a single product.
Providers still exist under the hood for OpenMemory / custom MCP, but the
default path is fully automatic.

## Built-in

| Provider | Default | Docker? | What it is |
|----------|---------|---------|------------|
| **TrueMemory** | On (always) | No | Markdown in `.memory/` (per repo) + global app data |
| **MemPalace** | On | **No** (native `mempalace-mcp`) | Graph/vector palace at `~/.mempalace/palace` |
| **OpenMemory** | Off | Optional | Mem0 OpenMemory MCP - enable when installed |

## Design rules

1. **TrueMemory never turns off** - files always work offline.
2. **MemPalace defaults to native** - never `docker run` unless you deliberately add a custom provider that uses Docker.
3. **Other backends** = MCP stdio command + args (same shape as Cursor/Grok MCP config).

## Config location

```
%APPDATA%/truedeck/data/memory-providers.json # Windows
~/Library/Application Support/truedeck/data/… # macOS
~/.config/truedeck/data/… # Linux
```

Example:

```json
[
 {
 "id": "truememory",
 "kind": "truememory",
 "name": "TrueMemory (files)",
 "enabled": true,
 "noDocker": true
 },
 {
 "id": "mempalace",
 "kind": "mempalace",
 "name": "MemPalace",
 "enabled": true,
 "command": "C:\\Users\\you\\.local\\bin\\mempalace-mcp.exe",
 "args": ["--palace", "C:\\Users\\you\\.mempalace\\palace"],
 "dataPath": "C:\\Users\\you\\.mempalace\\palace",
 "preferNative": true,
 "noDocker": true
 },
 {
 "id": "openmemory",
 "kind": "openmemory",
 "name": "OpenMemory (Mem0)",
 "enabled": false,
 "command": "npx",
 "args": ["-y", "openmemory", "mcp"],
 "noDocker": true
 }
]
```

## Add a custom memory MCP

In TrueDeck → Memory panel → **Add custom MCP**, or edit JSON:

```json
{
 "id": "custom-zep",
 "kind": "custom-mcp",
 "name": "My Zep bridge",
 "enabled": true,
 "command": "node",
 "args": ["C:/tools/zep-mcp/server.js"],
 "noDocker": true
}
```

Then copy the suggested snippet into Cursor `mcp.json` / Grok `config.toml`, or use **Export MCP snippet** in the UI.

## Agent bootstrap

When agents start, TrueDeck can inject which memory layers are enabled (file paths + MemPalace palace path). Agents that support MCP still need the MCP server registered in that client (Cursor/Grok) - TrueDeck shows the exact command to paste.

## Switching off MemPalace

1. Memory panel → uncheck **MemPalace**
2. Keep **TrueMemory** for repo notes
3. Optionally enable **OpenMemory** or a custom MCP

No reinstall required.
