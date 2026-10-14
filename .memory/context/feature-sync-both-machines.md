# TrueDeck feature sync: laptop + desktop (2026-09-04)

Both machines were on `v0.3.5` (`204d21f`) with divergent uncommitted work.

## Result
Merged branch `sync/both` (`3373985`) is checked out on:

- SamsungS22: `C:\Users\alper\TrueDeck`
- MACBOOK: `C:\Users\alper\TrueDeck`

Not pushed to `origin`. `master` stays at the 0.3.5 release.

## Kept from laptop (SamsungS22)
- Session restore / layout persist
- Agent resume / CLI session env
- MCP stdout NDJSON (Grok was dying on Content-Length framing)

## Kept from desktop (MACBOOK)
- Agent bus (peers / send / inbox)
- Project tab bar + Ctrl+P switcher
- Session colors
- Memory / MCP hub / docs for the bus

## Overlap
`index.ts`, `App.tsx`, `ProjectMenu.tsx`, `configuration.md` were hand-merged so tab bar + colors + resume env all stay.

Three-finger project swipe was removed (2026-09-04) — it did not work. Switch projects from the tab bar, menu, or Ctrl+P.
