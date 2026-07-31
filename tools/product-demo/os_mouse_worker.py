#!/usr/bin/env python3
"""
Real mouse worker for TrueDeck demos (Windows).

Primary API: map **window client coords** (Playwright bounding boxes) via
Win32 ClientToScreen — avoids DPI / CSS-screen mismatch with pyautogui.size().

Commands (stdin → stdout):
  READY on start
  FIND_WINDOW <substring>     → OK <hwnd>
  CLIENT_TO_SCREEN <hwnd> <cx> <cy>  → OK <sx> <sy>
  MOVE <x> <y> <duration_ms>
  CLICK [hold_ms]
  MOVECLICK <x> <y> <duration_ms> [hold_ms]
  CLIENT_MOVECLICK <hwnd> <cx> <cy> <duration_ms> [hold_ms]
  POS
  SIZE
  QUIT
"""
from __future__ import annotations

import ctypes
import sys
import time
from ctypes import wintypes

user32 = ctypes.windll.user32

# Per-monitor V2 so GetWindowRect / ClientToScreen match modern Electron
try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(POINT)]
user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.mouse_event.argtypes = [
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_ulong,
]

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004


def find_window(substr: str) -> int:
    needle = substr.lower()
    found = []

    @WNDENUMPROC
    def enum_proc(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(hwnd, buf, 512)
        title = buf.value or ""
        if needle in title.lower():
            found.append((hwnd, title))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not found:
        return 0
    # Prefer exact-ish TrueDeck main titles
    for hwnd, title in found:
        t = title.lower()
        if t == "truedeck" or t.startswith("truedeck ") or " - truedeck" in t:
            return int(hwnd)
    return int(found[0][0])


def client_to_screen(hwnd: int, cx: float, cy: float) -> tuple[int, int]:
    pt = POINT(int(round(cx)), int(round(cy)))
    if not user32.ClientToScreen(wintypes.HWND(hwnd), ctypes.byref(pt)):
        raise OSError("ClientToScreen failed")
    return int(pt.x), int(pt.y)


def set_cursor(x: int, y: int) -> None:
    user32.SetCursorPos(int(x), int(y))


def move_smooth(x: int, y: int, duration_ms: int) -> None:
    """Smooth move in OS coords (for Motionik tracking)."""
    # Get current pos
    cur = POINT()
    user32.GetCursorPos(ctypes.byref(cur))
    sx, sy = int(cur.x), int(cur.y)
    ex, ey = int(x), int(y)
    dur = max(0, int(duration_ms))
    if dur <= 0 or (sx == ex and sy == ey):
        set_cursor(ex, ey)
        return
    steps = max(8, dur // 12)
    for i in range(1, steps + 1):
        t = i / steps
        # ease-out quad
        e = 1 - (1 - t) * (1 - t)
        cx = int(sx + (ex - sx) * e)
        cy = int(sy + (ey - sy) * e)
        set_cursor(cx, cy)
        time.sleep(dur / steps / 1000.0)
    set_cursor(ex, ey)


def left_click(hold_ms: int = 40) -> None:
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(max(0.02, hold_ms / 1000.0))
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)


def main() -> None:
    print("READY", flush=True)
    last_hwnd = 0
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        parts = line.split()
        cmd = parts[0].upper()
        try:
            if cmd == "QUIT":
                print("OK", flush=True)
                break
            if cmd == "FIND_WINDOW":
                sub = " ".join(parts[1:]) if len(parts) > 1 else "TrueDeck"
                hwnd = find_window(sub)
                last_hwnd = hwnd
                if not hwnd:
                    print("ERR window not found", flush=True)
                else:
                    # also report client size for debugging
                    rc = RECT()
                    user32.GetClientRect(wintypes.HWND(hwnd), ctypes.byref(rc))
                    wr = RECT()
                    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(wr))
                    print(
                        f"OK {hwnd} client={rc.right - rc.left}x{rc.bottom - rc.top} "
                        f"win=({wr.left},{wr.top})-({wr.right},{wr.bottom})",
                        flush=True,
                    )
                continue
            if cmd == "CLIENT_TO_SCREEN" and len(parts) >= 4:
                hwnd = int(parts[1]) or last_hwnd
                sx, sy = client_to_screen(hwnd, float(parts[2]), float(parts[3]))
                print(f"OK {sx} {sy}", flush=True)
                continue
            if cmd == "POS":
                cur = POINT()
                user32.GetCursorPos(ctypes.byref(cur))
                print(f"OK {cur.x} {cur.y}", flush=True)
                continue
            if cmd == "SIZE":
                # Virtual screen (physical px)
                w = user32.GetSystemMetrics(78)  # SM_CXVIRTUALSCREEN
                h = user32.GetSystemMetrics(79)
                if w <= 0 or h <= 0:
                    w = user32.GetSystemMetrics(0)
                    h = user32.GetSystemMetrics(1)
                print(f"OK {w} {h}", flush=True)
                continue
            if cmd == "MOVE" and len(parts) >= 4:
                move_smooth(int(parts[1]), int(parts[2]), int(parts[3]))
                print("OK", flush=True)
                continue
            if cmd == "CLICK":
                hold = int(parts[1]) if len(parts) > 1 else 40
                left_click(hold)
                print("OK", flush=True)
                continue
            if cmd == "MOVECLICK" and len(parts) >= 4:
                hold = int(parts[4]) if len(parts) > 4 else 40
                move_smooth(int(parts[1]), int(parts[2]), int(parts[3]))
                time.sleep(0.05)
                left_click(hold)
                print("OK", flush=True)
                continue
            if cmd == "CLIENT_MOVECLICK" and len(parts) >= 5:
                hwnd = int(parts[1]) or last_hwnd
                cx, cy = float(parts[2]), float(parts[3])
                dur = int(parts[4])
                hold = int(parts[5]) if len(parts) > 5 else 40
                if hwnd:
                    user32.SetForegroundWindow(wintypes.HWND(hwnd))
                sx, sy = client_to_screen(hwnd, cx, cy)
                move_smooth(sx, sy, dur)
                time.sleep(0.05)
                left_click(hold)
                print(f"OK {sx} {sy}", flush=True)
                continue
            print(f"ERR unknown {line!r}", flush=True)
        except Exception as e:
            print(f"ERR {e}", flush=True)


if __name__ == "__main__":
    main()
