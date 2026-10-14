# Cursor scrolls down on load (2026-10-03)

**Symptom:** A Cursor tab in TrueDeck keeps scrolling down while it loads.

**Cause:** `cursor-agent` prints the chat into the normal buffer, and the load path sent extra rows-1 resizes for several seconds. Each resize made Cursor redraw, so the pane scrolled through the transcript again.

**Current method:** In `TerminalPane`, hold that opening burst until it goes quiet, parse it with the screen hidden, jump to the live bottom, then stop the late WINCH kicks. Do not call `scrollToBottom` on the alternate screen. A short live TUI frame is not held for the whole deadline.

**Desk pane:** The desk used to show only the last stripped line (`C:\Sync`) in a tall empty box, and that box could scroll. It now draws the current terminal frame and does not scroll.

**Key files:** `src/components/TerminalPane.tsx`, `src/styles.css`, `tui/desk.ts`, `tui/index.ts`
