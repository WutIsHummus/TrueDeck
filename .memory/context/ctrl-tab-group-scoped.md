# Ctrl+Tab is group-scoped

**Ctrl+Tab** / **Ctrl+Shift+Tab** cycle tabs only inside the **focused pane group**, not across other split panes.

- Helper: `cycleTabsInFocusedGroup` in `src/lib/pane-layout.ts`
- Handler: `src/App.tsx` (was previously all `projectSessions`)
- Use **Ctrl+Arrow** to move focus between pane groups
