# Pane focus vs terminal visible

Multi-pane: each group's active tab stays `visible` (opacity/layout) while only the **focused** group's terminal should own keyboard input.

`TerminalPane` takes `focused` separately from `visible`. On `focused` true → `term.focus()`; on false → `term.blur()`. Relying only on `visible` broke Ctrl+Arrow / click-to-switch-pane (keys still went to the previous xterm).

# Ctrl+Arrow snap-back (2026-07-28)

**Symptom:** Move down/right to another pane, then focus jumps back to the previous tab.

**Cause:** `useEffect` re-ran `syncSessions(..., preferActive: activeSessionId)` on every `activeSessionId` change (and on session title patches). A one-frame-stale store id forced `focusedGroupId` back to the old pane after `navigatePanes` had already moved.

**Fix:**
1. Membership sync effect depends on `sessions` only — not `activeSessionId`.
2. `syncSessions` only applies `preferActive` when orphans were added or the focused group vanished.
3. Ctrl+Arrow navigates on `displayLayout` (visible geometry), then `focusSession` on the canonical tree.

# Terminal text cutting on CLI stream

Agent TUIs clear+redraw on every PTY WINCH. Never call `resizeSession` unless cols/rows actually changed. Keep scrollbar gutter stable (`overflow-y: scroll` + `scrollbar-gutter: stable`) so streaming text does not shrink cols by 1. Prefer `windowsMode: false` for modern VT agents.
