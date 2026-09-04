/**
 * Keep three-finger swipe inside TrueDeck (macOS Spaces style).
 *
 * Windows Precision Touchpad "Switch apps" is handled by the shell before
 * Chromium sees it. While this window is focused we turn that OS gesture
 * off, detect the swipe ourselves, and cycle projects in-place. The user's
 * setting is restored on blur / quit.
 */
import { execFile } from 'child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { getGlobalDataDir } from './paths'

const WM_POINTERUPDATE = 0x0245
const WM_POINTERDOWN = 0x0246
const WM_POINTERUP = 0x0247
const WM_POINTERCAPTURECHANGED = 0x024c

const CLAIM_FILE = (): string => join(getGlobalDataDir(), 'touchpad-claim.json')

type ClaimState = { threeFingerSlide: number | null }

function toU32(v: Buffer | number | unknown): number {
 if (typeof v === 'number' && Number.isFinite(v)) return v >>> 0
 if (Buffer.isBuffer(v)) {
 if (v.length >= 8) return Number(v.readBigUInt64LE(0) & 0xffffffffn)
 if (v.length >= 4) return v.readUInt32LE(0)
 }
 return 0
}

function signed16(n: number): number {
 return n > 32767 ? n - 65536 : n
}

function sendProjectSwipe(win: BrowserWindow, dir: 1 | -1): void {
 if (win.isDestroyed() || win.webContents.isDestroyed()) return
 win.webContents.send('app:shortcut', {
 key: dir === 1 ? 'ProjectNext' : 'ProjectPrev',
 shift: false,
 alt: false,
 ctrl: false,
 repeat: false
 })
}

function runPowershell(script: string): Promise<string> {
 return new Promise((resolve, reject) => {
 execFile(
 'powershell.exe',
 ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
 { windowsHide: true, timeout: 8000 },
 (err, stdout, stderr) => {
 if (err) {
 reject(new Error(stderr?.toString() || err.message))
 return
 }
 resolve(String(stdout || '').trim())
 }
 )
 })
}

const NOTIFY_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("c2f03a33-21f5-47fa-b4bb-156362a2f239")]
public class ImmersiveShell {}
[ComImport, Guid("6d5140c1-7436-11ce-8034-00aa006009fa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IServiceProviderWin {
  [PreserveSig] int QueryService(ref Guid guidService, ref Guid riid, out IntPtr ppvObject);
}
[ComImport, Guid("4214f6fa-eb36-4e2f-9ca2-23fdc1832df7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IImmersiveSettingsCache {
  [PreserveSig] int OnSettingChanged(int id);
}
public static class TouchpadNotify {
  static readonly Guid Sid = new Guid("53660488-8855-460b-a9ab-5cfc6b5012ca");
  static readonly Guid Iid = new Guid("4214f6fa-eb36-4e2f-9ca2-23fdc1832df7");
  public static void Run() {
    try {
      var shell = (IServiceProviderWin)new ImmersiveShell();
      Guid sid = Sid, iid = Iid;
      IntPtr p;
      if (shell.QueryService(ref sid, ref iid, out p) != 0 || p == IntPtr.Zero) return;
      var cache = (IImmersiveSettingsCache)Marshal.GetObjectForIUnknown(p);
      Marshal.Release(p);
      cache.OnSettingChanged(0x11);
      cache.OnSettingChanged(0x14);
      cache.OnSettingChanged(0x18);
    } catch {}
  }
}
"@
[TouchpadNotify]::Run()
`

async function readThreeFingerSlide(): Promise<number | null> {
 const out = await runPowershell(
 `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad';` +
 `$v=(Get-ItemProperty -LiteralPath $p -Name ThreeFingerSlideEnabled -ErrorAction SilentlyContinue).ThreeFingerSlideEnabled;` +
 `if ($null -eq $v) { 'MISSING' } else { [string]$v }`
 )
 if (!out || out === 'MISSING') return null
 const n = Number(out)
 return Number.isFinite(n) ? n : null
}

async function writeThreeFingerSlide(value: number | null): Promise<void> {
 const set =
 value == null
 ? `Remove-ItemProperty -LiteralPath $p -Name ThreeFingerSlideEnabled -ErrorAction SilentlyContinue;`
 : `New-ItemProperty -LiteralPath $p -Name ThreeFingerSlideEnabled -PropertyType DWord -Value ${value >>> 0} -Force | Out-Null;`
 await runPowershell(
 `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad';` +
 `if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null };` +
 set +
 NOTIFY_SCRIPT
 )
}

function loadClaimFile(): ClaimState | null {
 try {
 const p = CLAIM_FILE()
 if (!existsSync(p)) return null
 return JSON.parse(readFileSync(p, 'utf8')) as ClaimState
 } catch {
 return null
 }
}

function saveClaimFile(state: ClaimState): void {
 try {
 writeFileSync(CLAIM_FILE(), JSON.stringify(state), 'utf8')
 } catch {
 /* ignore */
 }
}

function clearClaimFile(): void {
 try {
 const p = CLAIM_FILE()
 if (existsSync(p)) unlinkSync(p)
 } catch {
 /* ignore */
 }
}

let claimed = false
let restoring = false
let original: number | null | undefined

async function claimOsSwipe(): Promise<void> {
 if (process.platform !== 'win32' || claimed || restoring) return
 try {
 const crashed = loadClaimFile()
 if (crashed && !claimed) {
 await writeThreeFingerSlide(crashed.threeFingerSlide)
 clearClaimFile()
 }
 original = await readThreeFingerSlide()
 // 0 = Nothing: shell stops switching apps so the swipe can stay in-window.
 await writeThreeFingerSlide(0)
 saveClaimFile({ threeFingerSlide: original ?? null })
 claimed = true
 console.log('[swipe] claimed three-finger slide for in-window project switch')
 } catch (e) {
 console.warn('[swipe] claim failed', e)
 }
}

async function restoreOsSwipe(): Promise<void> {
 if (process.platform !== 'win32' || restoring) return
 if (!claimed && !loadClaimFile()) return
 restoring = true
 try {
 const fromFile = loadClaimFile()
 const value = claimed ? original ?? null : fromFile?.threeFingerSlide ?? null
 await writeThreeFingerSlide(value)
 claimed = false
 original = undefined
 clearClaimFile()
 console.log('[swipe] restored three-finger OS setting')
 } catch (e) {
 console.warn('[swipe] restore failed', e)
 } finally {
 restoring = false
 }
}

function attachPointerSwipe(win: BrowserWindow): () => void {
 const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>()
 let armedAt = 0
 const onPtr = (kind: 'down' | 'move' | 'up') => (wParam: unknown, lParam: unknown) => {
 const id = toU32(wParam) & 0xffff
 const lp = toU32(lParam)
 const x = signed16(lp & 0xffff)
 const y = signed16((lp >>> 16) & 0xffff)
 if (kind === 'down') {
 pointers.set(id, { x, y, sx: x, sy: y })
 return
 }
 if (kind === 'up') {
 pointers.delete(id)
 return
 }
 const cur = pointers.get(id)
 if (cur) {
 cur.x = x
 cur.y = y
 }
 if (pointers.size < 3) return
 const now = Date.now()
 if (now - armedAt < 450) return
 let dx = 0
 let dy = 0
 let n = 0
 for (const p of pointers.values()) {
 dx += p.x - p.sx
 dy += p.y - p.sy
 n += 1
 }
 dx /= n
 dy /= n
 if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.6) return
 armedAt = now
 sendProjectSwipe(win, dx > 0 ? 1 : -1)
 pointers.forEach((p) => {
 p.sx = p.x
 p.sy = p.y
 })
 }
 try {
 win.hookWindowMessage(WM_POINTERDOWN, onPtr('down'))
 win.hookWindowMessage(WM_POINTERUPDATE, onPtr('move'))
 win.hookWindowMessage(WM_POINTERUP, onPtr('up'))
 win.hookWindowMessage(WM_POINTERCAPTURECHANGED, onPtr('up'))
 } catch (e) {
 console.warn('[swipe] pointer hook failed', e)
 }
 return () => {
 try {
 win.unhookWindowMessage(WM_POINTERDOWN)
 win.unhookWindowMessage(WM_POINTERUPDATE)
 win.unhookWindowMessage(WM_POINTERUP)
 win.unhookWindowMessage(WM_POINTERCAPTURECHANGED)
 } catch {
 /* ignore */
 }
 }
}

/** Attach in-window three-finger project switching. Returns a dispose fn. */
export function attachProjectSwipe(win: BrowserWindow): () => void {
 const unhookPtr = process.platform === 'win32' ? attachPointerSwipe(win) : () => undefined

 const onSwipe = (_e: Electron.Event, direction: string): void => {
 if (direction === 'left') sendProjectSwipe(win, 1)
 if (direction === 'right') sendProjectSwipe(win, -1)
 }
 // macOS: BrowserWindow 'swipe' stays in this window.
 win.on('swipe', onSwipe)

 const onFocus = (): void => {
 void claimOsSwipe()
 }
 const onBlur = (): void => {
 void restoreOsSwipe()
 }
 win.on('focus', onFocus)
 win.on('blur', onBlur)
 if (win.isFocused()) void claimOsSwipe()
 else void restoreOsSwipe().catch(() => undefined)

 return () => {
 win.removeListener('focus', onFocus)
 win.removeListener('blur', onBlur)
 win.removeListener('swipe', onSwipe)
 unhookPtr()
 void restoreOsSwipe()
 }
}

export function restoreProjectSwipeOnQuit(): void {
 void restoreOsSwipe()
}
