# Keyboard shortcuts

TrueDeck claims these shortcuts **before** xterm and agent CLIs, so they work while a terminal tab is focused. Hold **Ctrl** on Windows/Linux or **⌘** on macOS (`metaKey` is treated like Ctrl).

Normal terminal keys (including **Ctrl+C**) still reach the PTY unless listed below.

## Application

| Shortcut | Action |
|----------|--------|
| **Ctrl+O** | Open / add project folder |
| **Ctrl+Shift+O** | Open file to **read** (markdown, plans, source) as a tab |
| **Ctrl+T** | New agent (open agent palette) |
| **Ctrl+N** | Pop focused pane into a **new window** (also: drag a tab outside the deck) |
| **Ctrl+Shift+N** | New shell tab |
| **Ctrl+W** | Close active tab |
| **Ctrl+S** | Toggle settings (in a document tab: **save** the file) |
| **Escape** | Close settings and agent palette |

**Ctrl+S** and **Ctrl+T** still work when focus is in settings form fields (other shortcuts are ignored while typing outside the terminal). Document tabs use **Read** / **Edit** for markdown; code is always editable monospace.

## Tabs

| Shortcut | Action |
|----------|--------|
| **Ctrl+Tab** | Next tab in the **focused pane group** only |
| **Ctrl+Shift+Tab** | Previous tab in the focused pane group |
| **Ctrl+1** … **Ctrl+9** | Jump to tab 1-9 |

## Pane splits & pop-out windows

| Shortcut | Action |
|----------|--------|
| **Ctrl+D** | Split vertical (side-by-side) |
| **Ctrl+X** | Split horizontal (top / bottom) |
| **Ctrl+Z** | Undo last pane move (split / dock / unsplit) |
| **Ctrl+Alt+D** or **Ctrl+Alt+X** | **Unsplit** — merge all panes into one |
| **Ctrl+←** / **Ctrl+→** / **Ctrl+↑** / **Ctrl+↓** | Move focus to neighboring pane (spatial). With one pane, cycles tabs. |
| **Ctrl+N** | Detach focused tab into a new TrueDeck window |
| **Drag tab outside the deck** | Same as Ctrl+N (pop-out at drop position) |

Closing a pop-out window returns the tab to the main deck.

Notes:

- You need **2+ tabs** (or an existing multi-pane layout) to split.
- Max **16** panes.
- Split moves the **active** tab into a new leaf relative to the focused group.

## Terminal font zoom

These change **terminal font size** (saved in settings), not Chromium page zoom.

| Shortcut | Action |
|----------|--------|
| **Ctrl+=** or **Ctrl++** | Larger font (11-20px) |
| **Ctrl+-** | Smaller font |
| **Ctrl+0** | Reset to 13px |

## Agent TUI scroll (Grok, etc.)

| Input | Action |
|-------|--------|
| **Mouse wheel** | Sent to the agent’s custom TUI scroll (mouse reporting) |
| **Shift+wheel** | Host xterm scrollback (when available) |

Native scrollbars are suppressed while the agent owns the wheel so reporting is not stolen.

## Terminal copy / paste

| Shortcut | Action |
|----------|--------|
| **Ctrl+C** | Copy if text is selected (then clears selection); otherwise interrupt (SIGINT) |
| **Ctrl+Shift+C** | Copy selection to the OS clipboard (then clears selection) |
| **Ctrl+V** / **Ctrl+Shift+V** | Paste clipboard into the terminal |
| **Ctrl+Shift+A** | Select all terminal buffer (then copy with Ctrl+C) |
| **Middle-click** | Paste clipboard |

Drag to select text in the terminal (Shift+drag if the agent has mouse mode on). After copy, selection is cleared so the next Ctrl+C is SIGINT again.

## Terminal (not claimed)

TrueDeck intentionally leaves many combos to the shell / agent TUI, for example:

| Shortcut | Typical meaning |
|----------|-----------------|
| **Ctrl+A** | Start of line / agent TUI select-all - **not** the agent palette |
| **Ctrl+L** | Clear / redraw (agent-dependent) |

## Settings cheatsheet

Settings → Terminal shows a short hint:

> **T** new agent · **O** project · **W** close · **S** settings · **D** v-split · **X** h-split · **N** shell · **1-9** jump tab · **+/-** font zoom

## Ownership (avoid fighting)

| Layer | Owns |
|-------|------|
| Main `before-input-event` | Claims app chords only (arrows, Tab, zoom, plain Ctrl+letter, Ctrl+1-9, Ctrl+Alt+D/X). Does **not** claim Ctrl+C/V. |
| `App.tsx` `handleShortcut` | Runs the claimed app actions (IPC primary, DOM fallback). Dedupe guards double-fire. |
| `TerminalPane` | Copy/paste (C/V), scrollback keys, blocks app chords from the PTY. Clears selection after copy so the next Ctrl+C is SIGINT. |

Ctrl+Shift+letter (except C/V/A) is left for the agent or shell.

## Source of truth

| Area | File |
|------|------|
| Main claim list | `electron/main/index.ts` |
| Global handlers | `src/App.tsx` |
| xterm attach filter + wheel + clipboard | `src/components/TerminalPane.tsx` |
| UI titles | `TabBar`, chrome, Settings, title-bar buttons |
