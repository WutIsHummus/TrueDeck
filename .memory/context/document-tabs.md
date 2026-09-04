# Document tabs (read plans / markdown / code)

Readable text tabs live in the same pane layout as agents (no PTY).

## Open
- **Ctrl+Shift+O** or title-bar file button
- Pick any project file (md, plans, ts, etc.)

## Behavior
- Markdown: **Read** (rendered) / **Edit** toggle; Ctrl+S saves
- Code/text: monospace editor; Ctrl+S saves
- Tabs drag/dock like agent tabs; restore reopens paths from layout

## Files
- `src/components/DocumentPane.tsx`
- `src/lib/simple-markdown.tsx`
- IPC `files:readText` / `files:writeText` / `files:pickOpen`
- `SessionInfo.kind: 'document'` + `documentPath`
