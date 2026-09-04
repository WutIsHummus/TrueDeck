# Ctrl+Shift+Tab on last visible tab

## Bug
On the last **visible** tab in a pane group, **Ctrl+Shift+Tab** (prev) could no-op while middle tabs still worked.

## Cause
`cycleTabsInFocusedGroup` used the raw group `sessionIds` + `activeSessionId`. The UI shows `displayLayout` / project-filtered tabs. If the group still had a hidden id (other project, dead id, orphan) after the last visible tab—or `activeSessionId` pointed at that hidden id—the cycle index was past the visible strip. Prev landed on the already-shown last visible tab.

## Fix
- `cycleableInGroup` + `CycleTabsOpts`: filter with `allowIds` (live project sessions), prefer store `activeSessionId` when it is in that list, else fall back like `filterLayoutToSessionIds` (last cycleable id when active is hidden).
- App handlers use functional `setPaneLayout` and pass `{ preferActive, allowIds }`.
- Same opts wired through `navigatePanes` for Ctrl+Arrow in-group tab cycle.
