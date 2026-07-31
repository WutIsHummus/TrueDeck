# TrueDeck product demo (recordable clicks)

Playwright attaches over CDP for **element discovery** (palette buttons, tabs, explorer).  
Clicks and moves use the **real Windows cursor** (`user32 SetCursorPos` / `mouse_event`) so FocuSee, OBS, and Loom capture the pointer.

| Mode | Flag | Cursor on recording |
|------|------|---------------------|
| **OS mouse (default)** | _(none)_ | Real system cursor ✓ |
| CDP mouse (old) | `--cdp-mouse` | Synthetic only — often invisible |

### Motionik / FocuSee cursor tracking

Default path uses a **long-lived pyautogui worker** (smooth ease-out moves), not PowerShell-per-click (that was delayed + offset on scaled displays).

If the click is still **offset** from the pointer:

```powershell
# try unscaled DIP coords
$env:TRUDECK_MOUSE_SCALE = "1"
npm run demo:playwright

# or force 150% physical (common on 2880×1620 logical desktop)
$env:TRUDECK_MOUSE_SCALE = "1.5"
npm run demo:playwright
```

Prefer **system cursor** capture in the recorder (not a software cursor overlay). Moves are intentionally ~0.5s so trackers can follow.

Requires: `tools/demo-clicker/.venv` with `pyautogui` (already used by `demo_clicker.py`).

## Flow

1. Open TrueDeck for automation (debug port **9222**):

```powershell
npm run demo:open
```

2. Frame that window in FocuSee / OBS (show system cursor).

3. Open the demo project in TrueDeck if needed, then:

```powershell
npm run demo:playwright
```

Optional built-in recorder:

```powershell
npm run demo:playwright -- --record product-demo-video/out/live-demo.mp4
```

## Don’t

- Don’t leave another window over TrueDeck — OS clicks go where the real cursor is.
- Don’t use `--cdp-mouse` if you need the cursor in the recording.
- Don’t call `setViewportSize` mid-record (it was removed so the window doesn’t jump).

## Files

| File | Role |
|------|------|
| `open-automation-window.mjs` | Launch Electron with `--remote-debugging-port` |
| `playwright-demo.mjs` | Demo script (attach + choreography) |
| `os-input.mjs` | Real Windows mouse move / click / drag |

## Fallback (keyboard-heavy, also real cursor)

```powershell
cd tools/demo-clicker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python demo_clicker.py --countdown 3
```

That path is pure **pyautogui** (always OS cursor). Prefer `demo:playwright` when you need precise element targeting.
