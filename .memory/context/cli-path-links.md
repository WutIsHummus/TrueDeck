# CLI path links → Document view

Clickable paths in agent terminals open as Document tabs (when setting enabled).

## Formats detected (`src/lib/path-links.ts`)
- Absolute Win/Unix/UNC
- Project-relative with `/` or `\` and a known extension
- Agent tool lines: `◆ Edit ReplicatedStorage\Shared\Modules\Foo.luau`

## Resolve
Relative paths join `session.projectRoot` (e.g. `C:\SPTS\ReplicatedStorage\...`).

## UX
Ctrl/cmd-less click on underlined path in the terminal.
