# Grok TUI custom scrolling + copy (2026-07-30)

Per https://docs.x.ai/build/cli/terminal-support :

> If your terminal's native scrollbar takes over, mouse reporting is off.

## Why Grok felt broken vs other terminals
Grok runs a full-screen TUI (alt buffer + mouse tracking). Shell/codex often stay on the normal buffer, so host scrollback + drag-select just work.

## TrueDeck behavior (`TerminalPane.tsx`)
- **Grok/Gemini/Kiro always own the wheel** (`isCustomScrollTuiAgent`). Codex uses `tuiOwnsWheel` via mouse/alt detection only (do not force from frame 0 — caused open bounce).
- **Stick-to-bottom** (`TerminalPane`): after each PTY write on the *normal* buffer only, `scrollToBottom()` if following. **Never** host-scroll on alternate screen — fights Codex/Grok full redraws (vertical oscillation). Typing re-enables follow; wheel/PageUp pauses it.
- **Codex stream jitter** (2026-07-31): do not `forceRefresh` / fit on every `onRender` or idle mid alt-screen stream. Throttle scroll-class sync (120ms), debounce TUI-ownership fit (100ms), skip idle full-row refresh while `isStreamingTui()`, hysteresis when dropping mouse ownership.
- Wheel → **direct SGR 64/65** to PTY for Grok (do not rely only on xterm `triggerMouseEvent`).
- **Shift+wheel** → host xterm scrollback (when any exists).
- **PageUp/Down** → sent to PTY for Grok / mouse / alt TUI.
- **Shift+drag** → host text selection (xterm standard under mouse modes).
- **Mouseup with selection** → auto-copy to OS clipboard; Ctrl+C / Ctrl+Shift+C also copy.
- CSS `agent-tui-mouse`: hide native scrollbar so it cannot steal the wheel.

## User cheatsheet (Grok pane)
| Action | How |
|--------|-----|
| Scroll Grok UI | Wheel (no modifiers) |
| Select text | **Shift+drag** |
| Copy | Auto on mouseup, or **Ctrl+C** / **Ctrl+Shift+C** |
| Host scrollback | **Shift+wheel** (if buffer has history) |
| Long readable dump | Ask agent for `truedeck_show` (pop-out window) |
