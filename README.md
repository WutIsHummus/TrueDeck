<p align="center">
  <img src="docs/public/logo.png" width="112" height="112" alt="TrueDeck logo" />
</p>

# TrueDeck

**Terminal-first multi-agent coding deck.** Run Grok, Codex, Cursor, Claude, Gemini, and more as live terminal tabs with VS Code-style pane groups, automatic memory, and shortcuts that work inside the TUI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/WutIsHummus/TrueDeck)](https://github.com/WutIsHummus/TrueDeck/releases)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-22d3ee)](https://wutishummus.github.io/TrueDeck/)

<p align="center">
  <img src="docs/public/screenshot.png" alt="TrueDeck multi-pane studio with Grok, Codex, Claude, and Cursor" width="100%" />
</p>

## Download

**Don’t clone the repo to run TrueDeck.** Grab a prebuilt binary from **[Releases](https://github.com/WutIsHummus/TrueDeck/releases)**:

| Asset | Platform | Notes |
|-------|----------|--------|
| `TrueDeck Setup 0.3.1.exe` | Windows x64 | Installer (recommended) |
| `TrueDeck 0.3.1.exe` | Windows x64 | Portable — no install |

macOS / Linux builds will land in the same Releases tab when available.

## Documentation

Full guides (install, panes, shortcuts, agents, MCP, architecture, troubleshooting):

**https://wutishummus.github.io/TrueDeck/**

## About

TrueDeck is a thin Electron studio around real coding CLIs — not a chat webview. Agents keep their own TUIs; TrueDeck handles multi-pane layout, project folders, session restore, and memory/MCP wiring.

| | |
|--|--|
| **Agents** | Grok · Codex · Cursor · Claude · Gemini · Shell · … |
| **Layout** | Tabs + split panes (vertical / horizontal) |
| **Memory** | Automatic inject into supported CLIs |
| **MCP** | Shared hub tools for launch / dispatch |

## Develop from source

Only if you’re contributing. End users should use **[Releases](https://github.com/WutIsHummus/TrueDeck/releases)**.

```bash
git clone https://github.com/WutIsHummus/TrueDeck.git
cd TrueDeck
npm install
npm start
```

See the [development docs](https://wutishummus.github.io/TrueDeck/development).

## License

MIT
