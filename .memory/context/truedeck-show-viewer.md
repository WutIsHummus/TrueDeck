# truedeck_show — TrueDeck native pop-out window

## Why
Agent TUIs cannot freely scroll and copy. Use **`truedeck_show`** on **`truedeck-hub`**.

## UX (user preference)
- **In-app separate Electron window** (TrueDeck-owned BrowserWindow)
- **Not** the system browser / HTML tab
- Optional document tab only if `asTab: true`

## Requirements
- TrueDeck app must be **running** — `truedeck-hub` **refuses to connect** otherwise (`app.lock` + live pid)
- Current build for `type: show` pop-out window
- MCP server: **`truedeck-hub`** (not the mempalace alias often named `truedeck`)

## Flow
1. MCP enqueues `deck-command-queue.json` → `type: "show"`
2. Electron `startDeckCommandWorker` → `openDocumentPopout`
3. Native window: scroll, select, Copy all / selection (OS clipboard via `viewer-preload.cjs`)

## Code
- `resources/mcp-server/truedeck-mcp.mjs` — tool only queues (no browser open)
- `electron/main/deck-commands.ts`
- `electron/main/document-viewer.ts`
- `resources/viewer-preload.cjs`
