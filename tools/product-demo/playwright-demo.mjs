/**
 * TrueDeck product demo — attaches to a pre-opened Electron window via CDP,
 * but drives the **real Windows cursor** so FocuSee / OBS capture actual clicks.
 *
 *   npm run demo:open          # launch TrueDeck with --remote-debugging-port
 *   # frame window in FocuSee
 *   npm run demo:playwright    # real OS mouse
 *   npm run demo:playwright -- --cdp-mouse   # old synthetic CDP mouse (no OS cursor)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import {
  clientToScreen,
  leftClick as osLeftClick,
  locatorScreenPoint,
  logMouseCalibration,
  moveTo as osMoveTo,
  shutdownMouse
} from './os-input.mjs'

const root = resolve(import.meta.dirname, '..', '..')
const recorderPath = resolve(root, 'tools', 'video-recorder', 'record.mjs')
const outputArg = process.argv.indexOf('--record')
const recordingPath = outputArg >= 0 ? resolve(process.argv[outputArg + 1]) : null
const noRecord = process.argv.includes('--no-record')
/** When true, use Playwright page.mouse (invisible to most screen recorders). */
const useCdpMouse = process.argv.includes('--cdp-mouse')
const debugPort = Number(process.env.TRUDECK_DEMO_DEBUG_PORT || 9222)

if (!existsSync(recorderPath)) throw new Error(`Recorder was not found: ${recorderPath}`)
if (outputArg >= 0 && !process.argv[outputArg + 1]) throw new Error('--record needs an output path')

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function installDemoCursor(page) {
  // Optional visual only — real OS cursor is what recorders capture.
  // Keep a faint ring for CDP-mouse mode; hide in OS-mouse mode so double-cursor doesn't show.
  if (!useCdpMouse) {
    await page.evaluate(() => {
      document.getElementById('__truedeck-demo-cursor')?.remove()
    })
    return
  }
  await page.evaluate(() => {
    if (document.getElementById('__truedeck-demo-cursor')) return
    const cursor = document.createElement('div')
    cursor.id = '__truedeck-demo-cursor'
    cursor.innerHTML = `
      <svg viewBox="0 0 30 42" aria-hidden="true">
        <path d="M3 2v29l8-7 5 13 7-3-6-13 10-1L3 2Z" fill="#fff" stroke="#111827" stroke-width="2.6" stroke-linejoin="round" />
      </svg>
      <i></i>`
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '30px',
      height: '42px',
      filter: 'drop-shadow(0 3px 3px rgba(0,0,0,.6))',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transform: 'translate(-4px, -3px)',
      transition: 'transform 45ms linear'
    })
    Object.assign(cursor.querySelector('svg').style, {
      display: 'block',
      width: '30px',
      height: '42px'
    })
    Object.assign(cursor.querySelector('i').style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '10px',
      height: '10px',
      border: '2px solid rgba(255,255,255,.9)',
      borderRadius: '50%',
      opacity: '0'
    })
    document.body.append(cursor)
  })
}

async function moveCursor(page, clientX, clientY, duration = 560) {
  if (useCdpMouse) {
    const steps = Math.max(12, Math.round(duration / 20))
    await page.mouse.move(clientX, clientY, { steps })
    await page.evaluate(
      ({ x: px, y: py }) => {
        const cursor = document.querySelector('#__truedeck-demo-cursor')
        if (cursor) cursor.style.transform = `translate(${px - 4}px, ${py - 3}px)`
      },
      { x: clientX, y: clientY }
    )
    return
  }
  const screen = await clientToScreen(page, clientX, clientY)
  // Longer ease-out moves so Motionik cursor tracking can follow
  await osMoveTo(screen.x, screen.y, Math.max(400, duration))
}

async function parkCursor(page) {
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight
  }))
  await moveCursor(page, viewport.width - 46, viewport.height - 42, 180)
}

/**
 * Real click: resolve locator → screen coords → OS SetCursorPos + mouse_event.
 * Electron receives the click as a genuine WM_LBUTTON* (recordable cursor).
 */
async function demoClick(page, locator, dwell = 220) {
  if (useCdpMouse) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('Cannot click hidden element')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await moveCursor(page, x, y)
    await pause(dwell)
    await page.mouse.down()
    await page.evaluate(() => {
      const cursor = document.querySelector('#__truedeck-demo-cursor')
      const ripple = cursor?.querySelector('i')
      if (ripple)
        ripple.animate(
          [
            { transform: 'scale(.25)', opacity: '.9' },
            { transform: 'scale(4.5)', opacity: '0' }
          ],
          { duration: 340, easing: 'ease-out' }
        )
    })
    await page.mouse.up()
    await pause(450)
    await parkCursor(page)
    return
  }

  // Ensure target is in view (scroll) without CDP click
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await pause(80)
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error(
      `Cannot map element: ${await locator.evaluate((el) => el.outerHTML.slice(0, 120))}`
    )
  }
  // Win32 ClientToScreen on TrueDeck HWND (CSS → physical client → screen)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await osLeftClick({
    clientX: cx,
    clientY: cy,
    page,
    moveMs: Math.max(480, dwell + 260),
    holdMs: 50
  })
  await pause(400)
  await parkCursor(page)
}

async function typeTerminal(page, text) {
  const input = page.locator('textarea.xterm-helper-textarea').last()
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  const box = await input.boundingBox()
  if (box) {
    const cx = box.x + Math.min(100, box.width / 2)
    const cy = box.y + 8
    await moveCursor(page, cx, cy, 260)
    if (!useCdpMouse) {
      await osLeftClick({ clientX: cx, clientY: cy, page, moveMs: 0, holdMs: 40 })
      await pause(120)
    }
  }
  // Focus helper then type — keyboard via CDP is usually fine for recorders;
  // the visible cursor click is what people notice.
  await input.evaluate((element) => element.focus())
  await page.keyboard.type(text, { delay: 18 })
  await pause(300)
  await page.keyboard.press('Enter')
}

async function openPalette(page) {
  const palette = page.locator('.palette')
  if (await palette.isVisible().catch(() => false)) return palette

  // Keyboard first — no mouse coord issues
  await page.keyboard.press('Control+T')
  try {
    await palette.waitFor({ state: 'visible', timeout: 3_500 })
    return palette
  } catch {
    /* fall through to buttons */
  }

  const openers = [
    page.getByRole('button', { name: /^Launch agent$/i }),
    page.getByRole('button', { name: /Launch agent/i }),
    page.locator('button[title*="New agent" i]'),
    page.locator('button[title*="agent" i]').filter({ hasText: /new|launch|\+/i })
  ]
  for (const loc of openers) {
    if ((await loc.count()) === 0) continue
    try {
      await demoClick(page, loc.first(), 200)
      await palette.waitFor({ state: 'visible', timeout: 4_000 })
      return palette
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not open agent palette (Ctrl+T / Launch agent)')
}

async function launchAgent(page, name, prompt) {
  console.log(`[demo] launching ${name}`)
  const palette = await openPalette(page)
  // Match "Grok", "Codex", "Cursor Agent", etc.
  const agent = palette.getByRole('button', { name: new RegExp(name, 'i') }).first()
  await agent.waitFor({ state: 'visible', timeout: 8_000 })
  await demoClick(page, agent)
  await page
    .locator('textarea.xterm-helper-textarea')
    .last()
    .waitFor({ state: 'visible', timeout: 20_000 })
  await pause(900)
  await typeTerminal(page, prompt)
  console.log(`[demo] prompt sent to ${name}`)
  await pause(1_800)
}

async function clickGrokPath(page) {
  const grokChrome = page.locator('.pane-group').first().locator('.agent-chrome')
  await demoClick(page, grokChrome)
  const path = 'src/server.js'
  await page.waitForFunction(
    (needle) =>
      [...document.querySelectorAll('.xterm-rows > div')].some((line) =>
        line.textContent?.includes(needle)
      ),
    path,
    { timeout: 35_000 }
  )
  const point = await page.evaluate((needle) => {
    const line = [...document.querySelectorAll('.xterm-rows > div')].find((node) =>
      node.textContent?.includes(needle)
    )
    if (!line) return null
    const text = line.textContent || ''
    const offset = text.indexOf(needle) + Math.max(1, Math.floor(needle.length / 2))
    const rect = line.getBoundingClientRect()
    return {
      x: rect.left + (Math.max(0, offset) / Math.max(1, text.length)) * rect.width,
      y: rect.top + rect.height / 2
    }
  }, path)
  if (!point) throw new Error(`Grok did not render ${path}`)
  await moveCursor(page, point.x, point.y, 360)
  await pause(260)
  if (useCdpMouse) {
    await page.mouse.click(point.x, point.y)
  } else {
    await osLeftClick({ clientX: point.x, clientY: point.y, page, moveMs: 0, holdMs: 50 })
  }
  await page.locator('.document-pane').waitFor({ state: 'visible', timeout: 8_000 })
  await pause(1_000)
  await parkCursor(page)
}

async function showcaseExplorer(page) {
  const explorer = page.getByRole('button', { name: 'Toggle project explorer' })
  await demoClick(page, explorer)
  await pause(400)
  await demoClick(page, explorer)
  const src = page.getByRole('button', { name: 'src' })
  await demoClick(page, src)
  await pause(900)
}

async function closeExistingSessions(page) {
  const closers = page.locator('button[aria-label^="Close "]:not([aria-label="Close"])')
  while (await closers.count()) {
    if (useCdpMouse) {
      await closers.first().click()
    } else {
      await demoClick(page, closers.first(), 80)
    }
    await pause(220)
  }
}

async function startRecorder() {
  if (!recordingPath || noRecord) return null
  const child = spawn(
    process.execPath,
    [recorderPath, '--output', recordingPath, '--countdown', '0', '--duration', '120'],
    {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true
    }
  )
  await pause(800)
  return child
}

let recorder = null
let browser = null
try {
  console.log(
    useCdpMouse
      ? '[demo] mode: CDP mouse (synthetic — may not show in screen recorders)'
      : '[demo] mode: OS mouse (real Windows cursor — use this for FocuSee/OBS)'
  )

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const context = browser.contexts()[0]
  let page = null
  if (context) {
    for (const candidate of await context.pages()) {
      if (/TrueDeck/i.test(await candidate.title())) {
        page = candidate
        break
      }
    }
  }
  if (!page) {
    throw new Error(
      'No pre-opened TrueDeck recording window found. Run `npm run demo:open`, frame it in FocuSee, then start the demo.'
    )
  }
  await page.waitForLoadState('domcontentloaded')
  // Don't force viewport resize during recording — it can jump the window under the cursor.
  await installDemoCursor(page)
  await closeExistingSessions(page)
  await page.getByRole('button', { name: 'Launch agent' }).waitFor({ state: 'visible', timeout: 12_000 })

  // Bring window forward so real clicks hit Electron (not another app)
  await page.evaluate(() => {
    window.focus()
  })
  if (!useCdpMouse) {
    await logMouseCalibration(page)
  }
  await pause(300)

  recorder = await startRecorder()
  console.log('[demo] recording choreography started')
  await pause(600)

  // First agent: open palette via Ctrl+T (reliable), then pick Grok
  await launchAgent(
    page,
    'Grok',
    'Reply with the project-relative source file for the health endpoint only. No other text.'
  )
  await launchAgent(
    page,
    'Codex',
    'Implement GET /api/health returning { ok: true, service: "pulseboard" }. Add a focused test if practical, run npm test, then report the files changed.'
  )

  console.log('[demo] splitting Grok and Codex vertically')
  await page.keyboard.press('Control+D')
  await pause(900)
  await clickGrokPath(page)
  console.log('[demo] showcasing project explorer')
  await showcaseExplorer(page)

  console.log('[demo] returning to Codex')
  await demoClick(page, page.locator('.pane-group').last().locator('.agent-chrome'))
  await pause(4_000)
  await launchAgent(
    page,
    'Cursor Agent',
    'Inspect src/server.js and give one concise verification note about the health endpoint.'
  )

  // Horizontal split via keyboard only (no tab drag — Motionik loses the cursor on drag).
  console.log('[demo] splitting Codex and Cursor Agent horizontally (Ctrl+X)')
  await page.keyboard.press('Control+X')
  await pause(1_000)
  await parkCursor(page)

  await pause(8_000)
  console.log('[demo] complete')
} finally {
  if (recorder) recorder.kill('SIGINT')
  await shutdownMouse().catch(() => {})
  if (browser) browser = null
}
