/**
 * Real OS mouse for TrueDeck demos.
 *
 * Uses Win32 ClientToScreen on the TrueDeck HWND so Playwright client
 * coordinates map correctly under DPI scaling (no CSS-screen heuristics).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')
const VENV_PY = resolve(root, 'tools/demo-clicker/.venv/Scripts/python.exe')
const WORKER = resolve(__dirname, 'os_mouse_worker.py')

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let worker = null
/** @type {Promise<void> | null} */
let readyPromise = null
/** @type {number} */
let hwnd = 0
/** HWND client size in physical pixels (from GetClientRect) */
let hwndClient = { w: 0, h: 0 }

function resolvePython() {
  // Prefer system python — worker only needs ctypes (stdlib). venv optional.
  if (existsSync(VENV_PY)) return VENV_PY
  return process.platform === 'win32' ? 'python' : 'python3'
}

function ensureWorker() {
  if (worker && !worker.killed) return readyPromise
  const py = resolvePython()
  worker = spawn(py, [WORKER], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  readyPromise = new Promise((resolveReady, reject) => {
    let acc = ''
    const onData = (chunk) => {
      acc += chunk.toString()
      if (acc.includes('READY')) {
        worker.stdout.off('data', onData)
        resolveReady()
      }
    }
    worker.stdout.on('data', onData)
    worker.stderr.on('data', (c) => console.error('[os-mouse]', c.toString().trim()))
    worker.on('error', reject)
    worker.on('exit', () => {
      worker = null
      readyPromise = null
      hwnd = 0
    })
    setTimeout(() => reject(new Error('os_mouse_worker failed to start')), 8000)
  })
  return readyPromise
}

/**
 * @param {string} line
 * @returns {Promise<string>}
 */
async function sendLine(line) {
  await ensureWorker()
  const w = worker
  if (!w?.stdout || !w?.stdin) throw new Error('os-mouse worker not running')
  return new Promise((resolveDone, reject) => {
    let local = ''
    let settled = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        w.stdout.off('data', onData)
      } catch {
        /* ignore */
      }
      fn()
    }
    const onData = (chunk) => {
      local += chunk.toString()
      const parts = local.split(/\r?\n/)
      local = parts.pop() || ''
      for (const p of parts) {
        if (!p) continue
        if (p.startsWith('OK')) finish(() => resolveDone(p))
        else finish(() => reject(new Error(p)))
        return
      }
    }
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`os-mouse timeout: ${line}`)))
    }, 30_000)
    w.stdout.on('data', onData)
    w.stdin.write(line.trim() + '\n')
  })
}

export async function ensureTrueDeckWindow() {
  await ensureWorker()
  const r = await sendLine('FIND_WINDOW TrueDeck')
  // OK <hwnd> client=WxH win=(...)
  const m = r.match(/^OK\s+(\d+)/)
  if (!m) throw new Error(`TrueDeck window not found: ${r}`)
  hwnd = parseInt(m[1], 10)
  const cm = r.match(/client=(\d+)x(\d+)/)
  if (cm) {
    hwndClient = { w: parseInt(cm[1], 10), h: parseInt(cm[2], 10) }
  }
  console.log(`[os-mouse] ${r}`)
  return hwnd
}

/**
 * Playwright CSS client point → HWND client (physical) point.
 * Electron page is DIP; GetClientRect is often physical under Per-Monitor DPI.
 */
async function toHwndClient(page, cssX, cssY) {
  if (!hwnd) await ensureTrueDeckWindow()
  const layout = await page.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio || 1
  }))
  let sx = 1
  let sy = 1
  if (hwndClient.w > 0 && layout.w > 0) sx = hwndClient.w / layout.w
  if (hwndClient.h > 0 && layout.h > 0) sy = hwndClient.h / layout.h
  // If sizes match (or nearly), no scale
  if (Math.abs(sx - 1) < 0.02) sx = 1
  if (Math.abs(sy - 1) < 0.02) sy = 1
  return {
    cx: cssX * sx,
    cy: cssY * sy,
    scaleX: sx,
    scaleY: sy,
    layout,
    hwndClient: { ...hwndClient }
  }
}

export async function shutdownMouse() {
  if (!worker) return
  try {
    await sendLine('QUIT')
  } catch {
    /* ignore */
  }
  try {
    worker.kill()
  } catch {
    /* ignore */
  }
  worker = null
  readyPromise = null
  hwnd = 0
}

export async function getCursorPos() {
  const r = await sendLine('POS')
  const [, xs, ys] = r.split(/\s+/)
  return { x: parseInt(xs, 10), y: parseInt(ys, 10) }
}

export async function moveTo(x, y, durationMs = 520) {
  await sendLine(`MOVE ${Math.round(x)} ${Math.round(y)} ${Math.max(0, Math.round(durationMs))}`)
}

/**
 * @param {{ x?: number, y?: number, moveMs?: number, holdMs?: number, clientX?: number, clientY?: number }} [opts]
 */
export async function leftClick(opts = {}) {
  const hold = Math.max(25, opts.holdMs ?? 45)
  const moveMs = opts.moveMs ?? 520

  // Preferred: Playwright CSS client coords → HWND physical → ClientToScreen
  if (Number.isFinite(opts.clientX) && Number.isFinite(opts.clientY)) {
    if (!hwnd) await ensureTrueDeckWindow()
    // page optional: if provided via opts.page, scale CSS→HWND client
    let cx = opts.clientX
    let cy = opts.clientY
    if (opts.page) {
      const m = await toHwndClient(opts.page, cx, cy)
      cx = m.cx
      cy = m.cy
    }
    await sendLine(
      `CLIENT_MOVECLICK ${hwnd} ${cx} ${cy} ${Math.round(moveMs)} ${hold}`
    )
    return
  }

  if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
    await sendLine(
      `MOVECLICK ${Math.round(opts.x)} ${Math.round(opts.y)} ${Math.round(moveMs)} ${hold}`
    )
    return
  }
  await sendLine(`CLICK ${hold}`)
}

/**
 * Locator → click using HWND ClientToScreen (Playwright client coords).
 */
export async function locatorScreenPoint(locator) {
  const box = await locator.boundingBox()
  if (!box) return null
  const page = locator.page()
  const cssX = box.x + box.width / 2
  const cssY = box.y + box.height / 2
  return clientToScreen(page, cssX, cssY)
}

/**
 * Page CSS client point → screen via HWND ClientToScreen (+ DPI scale).
 */
export async function clientToScreen(page, clientX, clientY) {
  const m = await toHwndClient(page, clientX, clientY)
  const r = await sendLine(`CLIENT_TO_SCREEN ${hwnd} ${m.cx} ${m.cy}`)
  const [, xs, ys] = r.split(/\s+/)
  return {
    x: parseInt(xs, 10),
    y: parseInt(ys, 10),
    clientX: m.cx,
    clientY: m.cy,
    cssX: clientX,
    cssY: clientY,
    meta: m
  }
}

export async function logMouseCalibration(page) {
  await ensureTrueDeckWindow()
  const launch = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (/launch agent/i.test(b.textContent || '')) {
        const r = b.getBoundingClientRect()
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
      }
    }
    return { cx: innerWidth / 2, cy: innerHeight / 2 }
  })
  const scr = await clientToScreen(page, launch.cx, launch.cy)
  console.log(
    `[os-mouse] HWND ${hwnd} client ${hwndClient.w}x${hwndClient.h} | CSS ${scr.meta.layout.w}x${scr.meta.layout.h} | scale ${scr.meta.scaleX.toFixed(3)}x${scr.meta.scaleY.toFixed(3)}`
  )
  console.log(
    `[os-mouse] Launch CSS (${launch.cx.toFixed(0)},${launch.cy.toFixed(0)}) → HWND (${scr.clientX.toFixed(0)},${scr.clientY.toFixed(0)}) → screen (${scr.x},${scr.y})`
  )
  // Hover without clicking so user can verify in recording software
  await moveTo(scr.x, scr.y, 350)
  const pos = await getCursorPos()
  console.log(`[os-mouse] cursor landed (${pos.x},${pos.y}) delta (${pos.x - scr.x},${pos.y - scr.y})`)
  return scr
}
