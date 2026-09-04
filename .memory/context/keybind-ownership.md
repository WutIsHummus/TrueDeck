# Keybind ownership (2026-07-28)

Three layers used to fight (double paste, dead Ctrl+Shift chords, sticky Ctrl+C copy vs SIGINT).

## Ownership
- **Main `before-input-event`**: only claim chords App handles - arrows, Tab, zoom, plain Ctrl+w/t/o/s/n/d/x/z, Ctrl+M (minimize) / Ctrl+Shift+M (restore), Ctrl+Alt+d/x, Ctrl+1-9. Never Ctrl+C/V. Other Ctrl+Shift+letter left for agent.
- **App `handleShortcut`**: runs app actions (IPC primary, DOM fallback). Dedupe ~50ms.
- **TerminalPane**: copy/paste C/V, scrollback, blocks exact app chords from PTY. Clears selection after copy so next Ctrl+C is SIGINT. Paste debounced 80ms vs DOM paste event.

## Files
- `electron/main/index.ts`
- `src/App.tsx`
- `src/components/TerminalPane.tsx`
- `docs/keyboard-shortcuts.md`
