#!/usr/bin/env node
/**
 * TrueDeck agent frame TUI
 *
 * Wraps any coding CLI in a reserved header band. Child PTY output is rewritten
 * so absolute cursor / scroll / clear sequences land below the header (otherwise
 * agent TUIs paint over the chrome and it looks garbled).
 *
 * Usage:
 *   node truedeck-frame.mjs --agent codex --name Codex --color #34d399 -- -- codex
 *
 * Env: TRUEDECK_TASK, TRUEDECK_TASK_FILE, TRUEDECK_TASK_TITLE, TRUEDECK_TASK_IDEA,
 *      TRUEDECK_INTENT, TRUEDECK_PROJECT, TRUEDECK_FRAME_HEADER=3|4
 *      TRUEDECK_MEMORY, TRUEDECK_AGENT
 *
 * Also reads `.truedeck/current-focus.md` / task file for the main idea line.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { platform, homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function loadPty() {
  const candidates = [
    join(__dirname, '..', '..', 'node_modules', 'node-pty'),
    join(__dirname, '..', '..', '..', 'node_modules', 'node-pty'),
    join(process.cwd(), 'node_modules', 'node-pty'),
    'node-pty'
  ]
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      /* next */
    }
  }
  console.error('[truedeck-frame] node-pty not found. Run from TrueDeck with node_modules installed.')
  process.exit(1)
}

const pty = loadPty()

// ── Brand ───────────────────────────────────────────────────────────────────

const BRAND = {
  grok: { mark: '✦', label: 'GROK', ansi: '36' },
  codex: { mark: '◉', label: 'CODEX', ansi: '32' },
  cursor: { mark: '◆', label: 'CURSOR', ansi: '34' },
  claude: { mark: '◎', label: 'CLAUDE', ansi: '35' },
  gemini: { mark: '◇', label: 'GEMINI', ansi: '33' },
  shell: { mark: '▣', label: 'SHELL', ansi: '90' },
  aider: { mark: '▹', label: 'AIDER', ansi: '33' },
  opencode: { mark: '△', label: 'OPENCODE', ansi: '35' }
}

function brandFor(agentId) {
  const id = (agentId || 'shell').toLowerCase().replace(/^cmd-.*/, 'cmd')
  if (BRAND[id]) return BRAND[id]
  if (id === 'cmd') return { mark: '▶', label: 'CMD', ansi: '34' }
  return { mark: '●', label: (agentId || 'AGENT').toUpperCase().slice(0, 10), ansi: '37' }
}

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    agent: 'shell',
    name: '',
    color: '',
    cwd: process.cwd(),
    childCmd: null,
    childArgs: []
  }
  const a = [...argv]
  while (a.length) {
    const x = a.shift()
    if (x === '--') {
      while (a[0] === '--') a.shift()
      out.childCmd = a.shift() || null
      out.childArgs = a
      break
    }
    if (x === '--agent') out.agent = a.shift() || out.agent
    else if (x === '--name') out.name = a.shift() || ''
    else if (x === '--color') out.color = a.shift() || ''
    else if (x === '--cwd') out.cwd = a.shift() || out.cwd
    else if (!out.childCmd && !x.startsWith('-')) {
      out.childCmd = x
      out.childArgs = a
      break
    }
  }
  return out
}

const opts = parseArgs(process.argv.slice(2))
if (!opts.childCmd) {
  console.error('Usage: truedeck-frame --agent <id> -- -- <command> [args...]')
  process.exit(2)
}

const brand = brandFor(opts.agent)
const displayName = opts.name || brand.label
// 4 lines: brand · idea · context · rule
const headerH = Math.min(5, Math.max(4, parseInt(process.env.TRUEDECK_FRAME_HEADER || '4', 10) || 4))
const startedAt = Date.now()
const workCwd = existsSync(opts.cwd) ? opts.cwd : process.cwd()
const childLabel = basename(String(opts.childCmd).replace(/\.exe$/i, ''))

// ── Terminal helpers ────────────────────────────────────────────────────────

function ttySize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24
  }
}

function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

function fg(code, s) {
  return `\x1b[${code}m${s}\x1b[0m`
}

function dim(s) {
  return `\x1b[2m${s}\x1b[0m`
}

function bold(s) {
  return `\x1b[1m${s}\x1b[0m`
}

function padVisible(s, cols) {
  const vis = stripAnsi(s).length
  if (vis >= cols) {
    // Truncate plain length carefully
    let out = ''
    let n = 0
    for (let i = 0; i < s.length && n < cols - 1; ) {
      if (s[i] === '\x1b') {
        const m = s.slice(i).match(/^\x1b\[[0-9;?]*[a-zA-Z]/)
        if (m) {
          out += m[0]
          i += m[0].length
          continue
        }
      }
      out += s[i]
      n++
      i++
    }
    return out + (n >= cols - 1 ? '…' : '')
  }
  return s + ' '.repeat(cols - vis)
}

function shortPath(p, max = 40) {
  let s = String(p || '')
  try {
    const home = homedir()
    if (home && s.toLowerCase().startsWith(home.toLowerCase())) {
      s = '~' + s.slice(home.length)
    }
  } catch {
    /* ignore */
  }
  s = s.replace(/\\/g, '/')
  if (s.length <= max) return s
  return '…' + s.slice(-(max - 1))
}

/**
 * Main idea of the current agent task — title + short summary.
 * Sources (first hit wins, refreshed every few seconds):
 *   1. TRUEDECK_TASK_IDEA / TRUEDECK_TASK_TITLE / TRUEDECK_INTENT env
 *   2. TRUEDECK_TASK_FILE (board dispatch)
 *   3. .truedeck/current-focus.md — only when this session is board-linked
 *      (otherwise every free tab would inherit the last project board task)
 */
let focusCache = { at: 0, title: '', idea: '' }

function isBoardLinked() {
  return Boolean(
    (process.env.TRUEDECK_TASK || '').trim() ||
      (process.env.TRUEDECK_TASK_FILE || '').trim() ||
      (process.env.TRUEDECK_TASK_TITLE || '').trim() ||
      (process.env.TRUEDECK_TASK_IDEA || '').trim() ||
      (process.env.TRUEDECK_INTENT || '').trim()
  )
}

function firstSentence(text, max = 140) {
  const one = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!one) return ''
  const sent = one.split(/(?<=[.!?])\s+/).find((s) => s.length > 0) || one
  return sent.slice(0, max)
}

function parseTaskMarkdown(text) {
  const title = (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() || ''
  // Prefer ## Instructions body
  let body = ''
  const instr = text.split(/^##\s+Instructions\s*$/im)[1]
  if (instr) {
    body = instr.split(/^##\s+/m)[0] || ''
  }
  body = body
    .replace(/_No details provided\._/gi, '')
    .replace(/^Status:.*$/gim, '')
    .replace(/^Agent:.*$/gim, '')
    .replace(/^Task id:.*$/gim, '')
    .replace(/^#+\s+.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!body) {
    body =
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !/^Status:|^Agent:|^Task id:/i.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || ''
  }
  const idea =
    body && title && body.toLowerCase() !== title.toLowerCase()
      ? `${title} — ${firstSentence(body, 120)}`
      : title || firstSentence(body, 140)
  return { title: title.slice(0, 80), idea: idea.slice(0, 160) }
}

function readFocus() {
  const now = Date.now()
  // Refresh every 2s so board edits / focus file show up
  if (now - focusCache.at < 2000 && (focusCache.idea || focusCache.title)) {
    return focusCache
  }

  let title = (process.env.TRUEDECK_TASK_TITLE || '').trim()
  let idea = (process.env.TRUEDECK_TASK_IDEA || process.env.TRUEDECK_INTENT || '').trim()

  const tryFile = (path) => {
    if (!path || !existsSync(path)) return false
    try {
      const parsed = parseTaskMarkdown(readFileSync(path, 'utf8'))
      if (parsed.title || parsed.idea) {
        if (!title) title = parsed.title
        if (!idea) idea = parsed.idea
        return Boolean(idea || title)
      }
    } catch {
      /* ignore */
    }
    return false
  }

  if ((!idea || !title) && process.env.TRUEDECK_TASK_FILE) {
    tryFile(process.env.TRUEDECK_TASK_FILE)
  }
  // Project-wide focus only for board-dispatched sessions — free tabs keep their own identity
  if ((!idea || !title) && isBoardLinked()) {
    const root = process.env.TRUEDECK_PROJECT || workCwd
    tryFile(join(root, '.truedeck', 'current-focus.md'))
  }

  if (!idea && title) idea = title
  if (!title && idea) title = firstSentence(idea, 60)

  focusCache = { at: now, title: title.slice(0, 80), idea: idea.slice(0, 160) }
  return focusCache
}

function projectLabel() {
  const p = process.env.TRUEDECK_PROJECT || workCwd
  try {
    return basename(p)
  } catch {
    return p
  }
}

let cachedBranch = undefined
function gitBranch() {
  if (cachedBranch !== undefined) return cachedBranch
  try {
    cachedBranch = execFileSync('git', ['-C', workCwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500
    })
      .trim()
      .slice(0, 32)
  } catch {
    cachedBranch = ''
  }
  return cachedBranch
}

function memoryLabel() {
  if (process.env.TRUEDECK_MEMORY) return 'mem'
  if (process.env.TRUEDECK_AUTO_CONTEXT) return 'ctx'
  return ''
}

function elapsed() {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return `${m}m${r.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h${(m % 60).toString().padStart(2, '0')}m`
}

let phase = 'starting'
let childAlive = true
let dirtyHeader = true

function statusDot() {
  if (phase === 'exited') return fg('31', '● exit')
  if (phase === 'starting') return fg('90', '○ boot')
  return fg('32', '● live')
}

function buildHeaderLines(cols) {
  const focus = readFocus()
  const proj = projectLabel()
  const branch = gitBranch()
  const path = shortPath(workCwd, Math.max(16, Math.min(36, cols - 36)))
  const mem = memoryLabel()
  const time = elapsed()

  // Line 1: brand · agent · status ………… elapsed
  const left1 = `${brand.mark} ${bold(fg(brand.ansi, 'TRUEDECK'))}  ${fg(brand.ansi, displayName)}  ${statusDot()}`
  const right1 = dim(time)
  const gap1 = Math.max(1, cols - stripAnsi(left1).length - stripAnsi(right1).length)
  const line1 = padVisible(left1 + ' '.repeat(gap1) + right1, cols)

  // Line 2: MAIN IDEA — what *this* tab is about (task, or agent · project)
  let line2
  if (focus.idea) {
    const label = dim('▸ ')
    const text = fg('37', bold(focus.idea))
    line2 = padVisible(' ' + label + text, cols)
  } else {
    const proj = projectLabel()
    const about = proj
      ? `${displayName} · ${proj}`
      : `${displayName} session`
    line2 = padVisible(' ' + dim('▸ ') + fg('37', about), cols)
  }

  // Line 3: project · branch · path · cli · mem
  const bits = []
  bits.push(fg('37', proj))
  if (branch) bits.push(dim('⌥ ') + fg('33', branch))
  bits.push(dim(path))
  bits.push(dim(childLabel))
  if (mem) bits.push(fg('35', mem))
  if (focus.title && focus.idea && focus.title !== focus.idea) {
    bits.push(dim('task:') + ' ' + fg('36', focus.title.slice(0, 28)))
  }
  let line3 = ' ' + bits.join(dim('  ·  '))
  line3 = padVisible(line3, cols)

  const rule = fg(brand.ansi, '─'.repeat(Math.max(1, cols)))

  if (headerH >= 5) {
    const hints = dim(' Ctrl+D/X split  ·  Ctrl+T agent  ·  Ctrl+B board  ·  Ctrl+W close ')
    return [line1, line2, line3, padVisible(hints, cols), rule]
  }
  return [line1, line2, line3, rule]
}

let lastPaintKey = ''
function paintHeader(force = false) {
  const { cols, rows } = ttySize()
  if (cols < 12 || rows < headerH + 4) return
  const lines = buildHeaderLines(cols)
  const key = lines.map((l) => stripAnsi(l)).join('\n')
  if (!force && !dirtyHeader && key === lastPaintKey) return
  lastPaintKey = key
  dirtyHeader = false

  // Save cursor, paint header rows, restore
  let out = '\x1b7\x1b[?25l'
  for (let i = 0; i < lines.length; i++) {
    out += `\x1b[${i + 1};1H\x1b[2K${lines[i]}`
  }
  out += '\x1b8\x1b[?25h'
  try {
    process.stdout.write(out)
  } catch {
    /* ignore */
  }
}

function applyScrollRegion() {
  const { rows } = ttySize()
  try {
    process.stdout.write(`\x1b[${headerH + 1};${rows}r`)
  } catch {
    /* ignore */
  }
}

function contentHome() {
  return `\x1b[${headerH + 1};1H`
}

// ── Child output rewrite (keep agent below header) ──────────────────────────
// Agent TUIs emit absolute CUP / clear / DECSTBM against a *child* grid of
// height (rows - headerH). Write-through without offset paints over the chrome.

let escCarry = '' // incomplete ESC sequence across chunks
let needHeaderAfter = false

function offsetRow(row) {
  const r = Number.isFinite(row) && row > 0 ? row : 1
  return r + headerH
}

/**
 * Rewrite one complete CSI sequence so absolute geometry is shifted down.
 * Returns string to emit; may set needHeaderAfter.
 */
function rewriteCsi(params, intermediate, final) {
  const p = params || ''
  // DEC private modes: ?1049h alt screen, etc. — pass through, fix region after
  if (p.startsWith('?') || intermediate) {
    if (final === 'h' || final === 'l') {
      // After alt-screen toggle, reassert scroll region + header
      if (/\?1049|\?47|\?1047/.test(p)) needHeaderAfter = true
    }
    return `\x1b[${p}${intermediate || ''}${final}`
  }

  const nums = p === '' ? [] : p.split(';').map((x) => (x === '' ? undefined : parseInt(x, 10)))

  // CUP / HVP: cursor position
  if (final === 'H' || final === 'f') {
    const row = offsetRow(nums[0] ?? 1)
    const col = nums[1] ?? 1
    return `\x1b[${row};${col}${final}`
  }

  // VPA: vertical position absolute
  if (final === 'd') {
    return `\x1b[${offsetRow(nums[0] ?? 1)}d`
  }

  // DECSTBM: scroll region
  if (final === 'r') {
    const { rows } = ttySize()
    if (nums.length === 0) {
      return `\x1b[${headerH + 1};${rows}r`
    }
    const top = offsetRow(nums[0] ?? 1)
    const botRaw = nums[1]
    const bot = botRaw != null && Number.isFinite(botRaw) ? botRaw + headerH : rows
    return `\x1b[${top};${Math.min(bot, rows)}r`
  }

  // ED: erase display — never wipe header rows
  if (final === 'J') {
    const mode = nums[0] ?? 0
    if (mode === 2 || mode === 3) {
      // Clear content band only, then restore header
      needHeaderAfter = true
      const { rows, cols } = ttySize()
      let out = ''
      for (let r = headerH + 1; r <= rows; r++) {
        out += `\x1b[${r};1H\x1b[2K`
      }
      out += contentHome()
      // Also try to clear scrollback for mode 3 (best-effort)
      if (mode === 3) out += '\x1b[3J'
      void cols
      return out
    }
    // 0/1: leave as-is (cursor already offset if absolute)
    return `\x1b[${p}J`
  }

  // SU/SD scroll up/down — pass through (within scroll region)
  return `\x1b[${p}${final}`
}

/**
 * Transform a chunk of child PTY output. Handles split ESC sequences.
 */
function transformChildChunk(chunk) {
  const raw = escCarry + (typeof chunk === 'string' ? chunk : String(chunk))
  escCarry = ''
  let out = ''
  let i = 0
  needHeaderAfter = false

  while (i < raw.length) {
    const ch = raw[i]
    if (ch !== '\x1b') {
      // Fast path: copy run of plain text
      let j = i + 1
      while (j < raw.length && raw[j] !== '\x1b') j++
      out += raw.slice(i, j)
      i = j
      continue
    }

    // ESC …
    if (i + 1 >= raw.length) {
      escCarry = raw.slice(i)
      break
    }
    const next = raw[i + 1]

    // CSI: ESC [
    if (next === '[') {
      let k = i + 2
      while (k < raw.length) {
        const c = raw[k]
        const code = c.charCodeAt(0)
        // Final byte of CSI: 0x40–0x7E
        if (code >= 0x40 && code <= 0x7e) {
          const body = raw.slice(i + 2, k)
          // Split params / intermediate (intermediates are 0x20–0x2F)
          let params = body
          let intermediate = ''
          const m = body.match(/^([0-9;?]*)([ -/]*)$/)
          if (m) {
            params = m[1]
            intermediate = m[2]
          }
          out += rewriteCsi(params, intermediate, c)
          i = k + 1
          break
        }
        k++
      }
      if (k >= raw.length) {
        // Incomplete CSI
        escCarry = raw.slice(i)
        break
      }
      continue
    }

    // OSC: ESC ] … BEL or ST
    if (next === ']') {
      let k = i + 2
      let done = false
      while (k < raw.length) {
        if (raw[k] === '\x07') {
          out += raw.slice(i, k + 1)
          i = k + 1
          done = true
          break
        }
        if (raw[k] === '\x1b' && raw[k + 1] === '\\') {
          out += raw.slice(i, k + 2)
          i = k + 2
          done = true
          break
        }
        k++
      }
      if (!done) {
        escCarry = raw.slice(i)
        break
      }
      continue
    }

    // RIS: ESC c  full reset — reassert chrome after
    if (next === 'c') {
      needHeaderAfter = true
      out += '\x1bc'
      i += 2
      // Re-apply after caller paints
      continue
    }

    // Other ESC sequences (2-char): pass one more byte if present
    if (i + 2 <= raw.length) {
      out += raw.slice(i, i + 2)
      i += 2
    } else {
      escCarry = raw.slice(i)
      break
    }
  }

  return out
}

// ── Spawn child ─────────────────────────────────────────────────────────────

const size = ttySize()
const childRows = Math.max(5, size.rows - headerH)
const childCols = Math.max(20, size.cols)

const env = { ...process.env }
delete env.TRUEDECK_FRAME
env.TRUEDECK_FRAME_CHILD = '1'
env.TERM = env.TERM || 'xterm-256color'
env.COLORTERM = env.COLORTERM || 'truecolor'

// Init chrome
try {
  process.stdout.write('\x1b[2J\x1b[H')
} catch {
  /* ignore */
}
paintHeader(true)
applyScrollRegion()
try {
  process.stdout.write(contentHome())
} catch {
  /* ignore */
}

function resolveSpawnCommand(cmd) {
  if (!cmd) return cmd
  if (existsSync(cmd)) return cmd
  try {
    if (platform() === 'win32') {
      const out = execFileSync('where.exe', [cmd], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const hit =
        out.find((p) => p.toLowerCase().endsWith('.exe')) ||
        out.find((p) => p.toLowerCase().endsWith('.cmd')) ||
        out[0]
      if (hit) return hit
    } else {
      const out = execFileSync('which', [cmd], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      if (out) return out
    }
  } catch {
    /* ignore */
  }
  return cmd
}

const spawnCmd = resolveSpawnCommand(opts.childCmd)

let child
try {
  child = pty.spawn(spawnCmd, opts.childArgs, {
    name: 'xterm-256color',
    cols: childCols,
    rows: childRows,
    cwd: workCwd,
    env,
    useConpty: platform() === 'win32'
  })
} catch (e) {
  console.error(
    '[truedeck-frame] failed to spawn',
    spawnCmd,
    opts.childArgs.join(' '),
    e.message || e
  )
  process.exit(1)
}

phase = 'active'
dirtyHeader = true
paintHeader(true)

child.onData((data) => {
  try {
    const transformed = transformChildChunk(data)
    if (transformed) process.stdout.write(transformed)
    if (needHeaderAfter) {
      applyScrollRegion()
      paintHeader(true)
      needHeaderAfter = false
    }
  } catch {
    /* ignore */
  }
})

child.onExit(({ exitCode }) => {
  childAlive = false
  phase = 'exited'
  dirtyHeader = true
  try {
    process.stdout.write('\x1b[r')
  } catch {
    /* ignore */
  }
  paintHeader(true)
  const code = exitCode ?? 0
  try {
    process.stdout.write(
      `\r\n\x1b[90m── TrueDeck · ${displayName} exited (${code}) · Ctrl+C to close ──\x1b[0m\r\n`
    )
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(code), 80)
})

// stdin → child
if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true)
  } catch {
    /* ignore */
  }
}
process.stdin.resume()
process.stdin.on('data', (buf) => {
  if (!childAlive) {
    if (buf[0] === 3) process.exit(0)
    return
  }
  try {
    child.write(buf.toString('utf8'))
  } catch {
    /* ignore */
  }
})

function onResize() {
  const { cols, rows } = ttySize()
  const r = Math.max(5, rows - headerH)
  const c = Math.max(20, cols)
  try {
    child.resize(c, r)
  } catch {
    /* ignore */
  }
  applyScrollRegion()
  dirtyHeader = true
  paintHeader(true)
}
process.stdout.on('resize', onResize)

// Elapsed clock — light refresh
const headerTimer = setInterval(() => {
  dirtyHeader = true
  paintHeader(false)
}, 5000)

process.on('exit', () => {
  clearInterval(headerTimer)
  try {
    process.stdout.write('\x1b[r\x1b[?25h')
  } catch {
    /* ignore */
  }
})

process.on('SIGINT', () => {
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  process.exit(130)
})
)
