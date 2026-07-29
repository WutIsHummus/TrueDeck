# TrueDeck demo - 35 second shot list

Record the **real app** with OBS (Window Capture → TrueDeck). 
Use the backgrounds in this folder for Twitter thumbnails / intro cards.

## Files

| File | Use |
|------|-----|
| `bg-branded.jpg` | Thumbnail, intro card, YouTube/X cover (logo left, dark right) |
| `bg-abstract.jpg` | Clean overlay under a floating app window / end card |
| `index.html` | Auto-playing intro cards - open in browser, record with OBS if you want a bumper |

## Prep (30s)

1. Open the **demo project** (not the full monorepo):
 ```
 C:\Users\alper\TrueDeck\demo-project
 ```
 (PulseBoard - zero-dep Node task API; see that folder’s README)
2. Dark UI; chrome should show `demo-project` / `main`
3. 2-3 agent tabs ready (or launch live on camera)
4. OBS: 1920×1080, 30fps, MP4

## Shot list (say this, or caption it)

**Memory-first cut** (recommended) - full detail in `demo-project/DEMO-MEMORY.md`:

| Time | On screen | VO / caption |
|------|-----------|--------------|
| 0-4s | Open `demo-project` | Project open - memory wires itself |
| 4-12s | `Ctrl+T` fresh agent | No paste, no memory panel |
| 12-25s | Ask codename / port / title max | Agent answers from `.memory` |
| 25-40s | Split + second agent implements from memory | Same facts in both panes |
| 40-45s | Hold | Memory automatic. MCP syncs your CLIs. |

**Split / multi-agent cut** (secondary):

| Time | On screen | VO / caption |
|------|-----------|--------------|
| 0-3s | App opens on project | **TrueDeck** multi-agent terminal deck |
| 3-10s | `Ctrl+T` → Claude, then Grok | Launch the CLIs you already use |
| 10-18s | `Ctrl+D` split | Split panes. Real agents. One deck. |
| 18-28s | Chrome + short prompt | Project, branch, and agents stay in view |
| 28-35s | Hold on multi-pane | Your tagline |

## One-line captions (pick one)

- Multi-agent terminal deck for Claude, Grok, Cursor, Codex…
- Not another chat window - a deck for coding agents
- Ctrl+T new agent · Ctrl+D split · stay in the terminal

## Edit in CapCut

1. Import OBS recording 
2. Auto captions 
3. Optional 0-2s intro using `bg-branded.jpg` + text “TrueDeck” 
4. Soft zoom on split-pane moment 
5. Export 1080p for X 

## I can’t remote-record your app

This environment can’t capture your running Electron window. 
Backgrounds + script + intro HTML are ready; you record TrueDeck once with OBS (~2 min of work).
