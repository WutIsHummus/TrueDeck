# Keyboard shortcuts

TrueDeck claims these shortcuts **before** xterm and agent CLIs, so they work while a terminal tab is focused. Hold **Ctrl** on Windows/Linux or **⌘** on macOS (`metaKey` is treated like Ctrl).

Normal terminal keys (including **Ctrl+C**) still reach the PTY unless listed below.

## Application

| Shortcut | Action |
|----------|--------|
| **Ctrl+O** | Open / add project folder |
| **Ctrl+T** | New agent (open agent palette) |
| **Ctrl+N** | New shell tab |
| **Ctrl+W** | Close active tab |
| **Ctrl+S** | Toggle settings |
| **Escape** | Close settings and agent palette |

**Ctrl+S** and **Ctrl+T** still work when focus is in settings form fields (other shortcuts are ignored while typing outside the terminal).

## Tabs

| Shortcut | Action |
|----------|--------|
| **Ctrl+Tab** | Next tab in the **focused pane group** only |
| **Ctrl+Shift+Tab** | Previous tab in the focused pane group |
| **Ctrl+1** … **Ctrl+9** | Jump to tab 1-9 |

## Pane splits

| Shortcut | Action |
|----------|--------|
| **Ctrl+D** | Split vertical (side-by-side) |
| **Ctrl+X** | Split horizontal (top / bottom) |
| **Ctrl+Alt+D** or **Ctrl+Alt+X** | Merge all groups into one pane |
| **Ctrl+←** / **Ctrl+→** / **Ctrl+↑** / **Ctrl+↓** | Move focus to neighboring pane (spatial). With one pane, cycles tabs. |

Notes:

- You need **2+ tabs** (or an existing multi-pane layout) to split.
- Max **16** panes.
- Split moves another tab into a new leaf relative to the focused group.

## Terminal (not claimed)

TrueDeck intentionally leaves many combos to the shell / agent TUI, for example:

| Shortcut | Typical meaning |
|----------|-----------------|
| **Ctrl+C** | Interrupt / copy (agent-dependent) |
| **Ctrl+A** | Start of line / agent TUI select-all - **not** the agent palette |
| **Ctrl+L** | Clear / redraw (agent-dependent) |

Older README drafts mapped **Ctrl+A** to the agent palette and **Ctrl+T** to “next tab”; **0.3.x Studio code uses the table above** (`src/App.tsx`).

## Settings cheatsheet

Settings → Terminal shows a short hint:

> **T** new agent · **O** project · **W** close · **S** settings · **D** v-split · **X** h-split · **N** shell · **1-9** jump tab

## Source of truth

| Area | File |
|------|------|
| Global handlers | `src/App.tsx` |
| xterm attach filter | `src/components/TerminalPane.tsx` |
| UI titles | `TabBar`, `TaskBoard`, `SettingsMenu`, title-bar buttons |
