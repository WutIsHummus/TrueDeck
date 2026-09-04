# Agent bus

TrueDeck agents can message each other:

- **Same PC** — two terminals / pane groups in TrueDeck
- **PC to PC** — TrueDeck running on both machines, with global TrueMemory synced (the existing `truedeck-global-memory` Syncthing folder)

No extra pairing UI. The hub MCP tools are the API. TrueDeck must be open so `truedeck-hub` is connected.

## What agents call

| Tool | Purpose |
|------|---------|
| `truedeck_whoami` | This session’s device id, session id, agent id |
| `truedeck_peers` | Live TrueDeck sessions here and on other synced PCs |
| `truedeck_send` | Send a message |
| `truedeck_inbox` | Read messages for this session |
| `truedeck_ack` | Mark message ids read (inbox acks by default) |

### `truedeck_send`

`to` accepts:

| Value | Delivers to |
|-------|-------------|
| Session id (or first 8 chars) | That exact terminal |
| Agent id (`grok`, `claude`, …) | Sessions with that CLI |
| Device name (`macbook`) | Every session on that PC |
| `grok@macbook` | That CLI on that PC |
| `local` | Other terminals on this PC |
| `all` | Every TrueDeck session the bus can see |

Default `deliver` is `both`: store in the inbox **and** type the message into the recipient’s live terminal so they notice mid-turn. Use `inbox` if you only want a pollable mailbox.

Keep bodies short and actionable (cap 16KB).

## How it works

```
Agent A (MCP)  →  write ~/.…/memory/.agent-bus/messages/<id>.json
TrueDeck app   →  heartbeat devices/<deviceId>.json (live sessions)
Recipient app  →  match `to` against local PTYs → sessions.write
Agent B        →  sees injected text, or calls truedeck_inbox
```

Same-PC uses the shared app-data folder (immediate). PC-to-PC uses the **already-synced global memory** directory (`<dataDir>/memory/.agent-bus/`). If notes sync is set up between those TrueDeck installs, the bus rides along. Typical Syncthing delay is a few seconds.

Local-only files (not synced):

| Path | Role |
|------|------|
| `<dataDir>/device.json` | Stable device id + hostname |
| `<dataDir>/agent-bus/sessions.json` | Maps bus session id → PTY id |
| `<dataDir>/agent-bus/injected.json` | Messages already typed into a terminal |
| `<dataDir>/agent-bus/read.json` | Inbox read receipts |

## Env (spawned by TrueDeck)

| Variable | Purpose |
|----------|---------|
| `TRUEDECK_DEVICE_ID` | This PC |
| `TRUEDECK_DEVICE_NAME` | Hostname |
| `TRUEDECK_SESSION_ID` | This terminal (bus id) |
| `TRUEDECK_AGENT_ID` | Preset id (`grok`, …) |
| `TRUEDECK_BUS_DIR` | Public bus folder |

## Agent habit

At session start (and when coordinating parallel work): `truedeck_peers` then `truedeck_inbox`. Send updates with `truedeck_send` instead of asking the human to copy-paste between panes.

## Related

- [MCP](./mcp.md)
- [Architecture](./architecture.md)
- [Memory providers](./memory-providers.md) — global memory folder that carries the bus across PCs
