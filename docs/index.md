---
layout: home
title: TrueDeck
titleTemplate: Terminal-first multi-agent deck
hero:
 name: TrueDeck
 text: Terminal-first multi-agent coding deck
 tagline: Run Grok, Codex, Cursor, Claude, and more as live terminal tabs - with pane groups, automatic memory, and shortcuts that work inside the TUI.
 image:
 src: /studio-preview.svg
 alt: TrueDeck studio preview
 actions:
 - theme: brand
 text: Get started
 link: /getting-started
 - theme: alt
 text: User guide
 link: /user-guide
 - theme: alt
 text: View on GitHub
 link: https://github.com/WutIsHummus/TrueDeck
features:
 - title: Multi-agent tabs
 details: Grok · Codex · Cursor · Claude · Gemini · Shell and more - each in its own live PTY tab.
 - title: Pane groups
 details: Split vertical or horizontal like VS Code. Drag tabs between groups; each group keeps its own tab strip.
 - title: Shortcuts that work
 details: Ctrl+T / Ctrl+D / Ctrl+Arrow and friends are claimed before the agent TUI, so they always reach TrueDeck.
 - title: Automatic memory
 details: Project notes and MCP wiring inject into your CLIs on open - no badge babysitting.
 - title: Session restore
 details: Reopen last project and respawn agent tabs after quit, including multi-pane layouts.
 - title: MCP deck tools
 details: Agents launch briefed CLIs via truedeck_launch and related hub tools from inside the terminal.
---

## Download

Prebuilt apps (no clone required):

**[GitHub Releases](https://github.com/WutIsHummus/TrueDeck/releases)** - Windows installer + portable `.exe`.

## Develop from source

```bash
git clone https://github.com/WutIsHummus/TrueDeck.git
cd TrueDeck
npm install
npm start
```

Requires **Node.js 20+**. Contributors only - end users should use Releases.
## Where next

| Goal | Page |
|------|------|
| First project & agent | [Getting started](/getting-started) |
| Day-to-day Studio use | [User guide](/user-guide) |
| Full shortcut table | [Keyboard shortcuts](/keyboard-shortcuts) |
| Settings & paths | [Configuration](/configuration) |
| How it works | [Architecture](/architecture) |
| Something broke | [Troubleshooting](/troubleshooting) |

## Version

Documentation targets **TrueDeck 0.3.x**. The Studio UI (`npm start`) is the primary product; an optional terminal-only deck is available via `npm run tui`.
