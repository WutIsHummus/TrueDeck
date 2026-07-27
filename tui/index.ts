/**
 * TrueDeck TUI — full terminal multi-agent deck (no Electron GUI).
 *
 * Keys (deck mode):
 *   ↑/↓ or j/k   select session
 *   Enter        attach (full terminal takeover)
 *   1-9          select + attach
 *   n            new agent menu
 *   g/x/c/u/e/s  spawn Grok/Codex/Claude/Cursor/Gemini/Shell
 *   o            run on-open commands (e.g. rojo serve)
 *   G            open Windows Terminal multi-pane grid
 *   m            MemPalace status / mine project
 *   p            change project path
 *   w / d / Del  close selected tab
 *   W            close all tabs
 *   q            quit
 *
 * In attach mode: Ctrl+] detach · Ctrl+W close this tab + detach
 */
import { existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import blessed from 'blessed'
import { loadAgents, type AgentPreset } from './agents'
import { SessionManager } from './sessions'
import { ensureFileMemory, mempalaceStatus, mineProject, detectOnOpen } from './memory'
import { openWindowsTerminalGrid } from './grid'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty')

function parseProjectArg(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  if (arg && existsSync(arg)) return resolve(arg)
  const spts = resolve(homedir(), 'SPTS')
  if (existsSync(spts)) return spts
  return process.cwd()
}

let project = parseProjectArg()
const agents = loadAgents()
const mgr = new SessionManager()
let attached = false
let statusMsg = 'TrueDeck TUI — full terminal agent deck'

function agentByKey(ch: string): AgentPreset | undefined {
  return agents.find((a) => a.key === ch)
}

function shortPath(p: string): string {
  return p.length > 48 ? '…' + p.slice(-46) : p
}

async function main(): Promise<void> {
  // Memory is automatic — ensure trees + quiet mine; no user UI
  ensureFileMemory(project)
  try {
    mineProject(project)
  } catch {
    // optional
  }

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'TrueDeck',
    mouse: true,
    dockBorders: true
  })

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    label: ' TrueDeck '
  })

  const list = blessed.list({
    parent: screen,
    label: ' Tabs  (w=close) ',
    top: 3,
    left: 0,
    width: 30,
    height: '100%-6',
    keys: true,
    mouse: true,
    vi: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'gray' },
      selected: { bg: 'cyan', fg: 'black', bold: true },
      item: { fg: 'white' }
    },
    tags: true
  })

  const preview = blessed.box({
    parent: screen,
    label: ' Preview (Enter = full attach) ',
    top: 3,
    left: 30,
    width: '100%-30',
    height: '100%-6',
    border: { type: 'line' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    scrollbar: { ch: '│', style: { fg: 'cyan' } },
    style: { border: { fg: 'gray' }, fg: 'green' },
    content: '{gray-fg}No session. Press {bold}n{/bold} or {bold}g{/bold}/{bold}x{/bold}/{bold}c{/bold} to spawn agents.{/}'
  })

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    content: ''
  })

  function refreshHeader(): void {
    const mem = mempalaceStatus()
    header.setContent(
      ` {cyan-fg}{bold}project{/} ${shortPath(project)}\n` +
        ` {gray-fg}${mem} · TrueMemory .memory/{/}`
    )
  }

  function refreshList(): void {
    const items = mgr.sessions.map((s, i) => {
      const mark = s.id === mgr.activeId ? '▶' : ' '
      const st = s.status === 'exited' ? '{red-fg}exit{/}' : '{green-fg}run{/}'
      // Visible close affordance on every tab row
      return `${mark} ${i + 1}. ${s.name} ${st} {red-fg}[x]{/}`
    })
    list.setItems(items.length ? items : ['{gray-fg}(no tabs — press g/x/c to open){/}'])
    const idx = mgr.sessions.findIndex((s) => s.id === mgr.activeId)
    if (idx >= 0) list.select(idx)
  }

  function closeSelectedTab(): void {
    const s = mgr.active
    if (!s) {
      statusMsg = 'No tab to close'
      render()
      return
    }
    const name = s.name
    mgr.killActive()
    statusMsg = `Closed tab: ${name}`
    render()
  }

  function closeAllTabs(): void {
    const n = mgr.sessions.length
    mgr.dispose()
    statusMsg = n ? `Closed ${n} tab(s)` : 'No tabs open'
    render()
  }

  function refreshPreview(): void {
    const s = mgr.active
    if (!s) {
      preview.setContent(
        '{gray-fg}No tabs open.\n\n' +
          '  {bold}g{/} Grok   {bold}x{/} Codex   {bold}c{/} Claude\n' +
          '  {bold}u{/} Cursor {bold}e{/} Gemini  {bold}s{/} Shell\n' +
          '  {bold}n{/} menu   {bold}o{/} on-open  {bold}G{/} WT grid\n' +
          '  {bold}Enter{/} attach · {bold}w{/} close tab · {bold}W{/} close all{/}'
      )
      return
    }
    const tail = s.buf.slice(-6000)
    preview.setContent(
      `{bold}${s.name}{/} {gray-fg}${s.cwd}{/}  {red-fg}[w = close this tab]{/}\n\n${tail}`
    )
    preview.setScrollPerc(100)
  }

  function refreshFooter(): void {
    footer.setContent(
      ` {cyan-fg}${statusMsg}{/}\n` +
        ` {gray-fg}↑↓ tab · Enter attach · {bold}w{/}/{bold}Del{/} close tab · {bold}W{/} close all · g/x/c spawn · o on-open · G grid · q quit{/}`
    )
  }

  function render(): void {
    if (attached) return
    refreshHeader()
    refreshList()
    refreshPreview()
    refreshFooter()
    screen.render()
  }

  // live preview updates
  setInterval(() => {
    if (!attached) refreshPreview()
    if (!attached) screen.render()
  }, 400)

  function spawnAgent(agent: AgentPreset): void {
    const cols = Math.max(40, (preview.width as number) - 4 || 100)
    const rows = Math.max(10, (preview.height as number) - 4 || 28)
    mgr.spawn(agent, project, cols, rows)
    statusMsg = `Spawned ${agent.name}`
    render()
  }

  function runOnOpen(): void {
    const cmds = detectOnOpen(project)
    if (!cmds.length) {
      statusMsg = 'No on-open commands detected for this project'
      render()
      return
    }
    for (const c of cmds) {
      mgr.spawnCommand(c.label, c.command, project)
    }
    statusMsg = `On-open: ${cmds.map((c) => c.label).join(', ')}`
    render()
  }

  function showNewMenu(): void {
    const box = blessed.list({
      parent: screen,
      label: ' New agent ',
      top: 'center',
      left: 'center',
      width: 36,
      height: Math.min(12, agents.length + 4),
      keys: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'cyan', fg: 'black' }
      },
      items: agents.map((a) => `${a.key || ' '}  ${a.name}`)
    })
    box.focus()
    box.on('select', (_item, idx) => {
      const a = agents[idx]
      box.destroy()
      if (a) spawnAgent(a)
      render()
    })
    screen.key(['escape'], () => {
      box.destroy()
      render()
    })
    screen.render()
  }

  /** Full terminal takeover — real agent UI */
  function attach(): void {
    const s = mgr.active
    if (!s || s.status === 'exited') {
      statusMsg = 'No running session to attach'
      render()
      return
    }

    attached = true
    screen.leave()
    // clear and hand TTY to PTY
    process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H')
    process.stdout.write(
      `\x1b[36mTrueDeck attach: ${s.name}  ·  Ctrl+] detach\x1b[0m\r\n`
    )

    const { columns, rows } = process.stdout
    try {
      s.proc.resize(columns || 120, (rows || 30) - 1)
    } catch {
      // ignore
    }

    // flush recent buffer
    if (s.buf) process.stdout.write(s.buf.slice(-8000))

    const onData = (data: string): void => {
      process.stdout.write(data)
    }
    s.proc.onData(onData)

    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()

    const onStdin = (chunk: Buffer): void => {
      // Ctrl+] = 0x1d detach
      if (chunk.length === 1 && chunk[0] === 0x1d) {
        detach(s, onData, onStdin, false)
        return
      }
      // Ctrl+W = 0x17 close tab and detach
      if (chunk.length === 1 && chunk[0] === 0x17) {
        detach(s, onData, onStdin, true)
        return
      }
      s.proc.write(chunk.toString('utf8'))
    }
    process.stdin.on('data', onStdin)

    const onResize = (): void => {
      try {
        s.proc.resize(process.stdout.columns || 120, (process.stdout.rows || 30) - 1)
      } catch {
        // ignore
      }
    }
    process.stdout.on('resize', onResize)
    ;(s as unknown as { _detachResize?: () => void })._detachResize = () => {
      process.stdout.off('resize', onResize)
    }
  }

  function detach(
    s: { id: string; name: string; proc: { onData: (cb: (d: string) => void) => void } },
    onData: (data: string) => void,
    onStdin: (chunk: Buffer) => void,
    closeTab = false
  ): void {
    process.stdin.off('data', onStdin)
    void onData
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdout.write('\x1b[?1049l')
    attached = false
    if (closeTab) {
      mgr.kill(s.id)
      statusMsg = `Closed tab: ${s.name}`
    } else {
      statusMsg = 'Detached — back to deck (w closes tab)'
    }
    screen.enter()
    list.focus()
    render()
  }

  // Input handling (deck mode)
  screen.key(['q', 'C-c'], () => {
    mgr.dispose()
    process.exit(0)
  })

  screen.key(['up', 'k'], () => {
    const idx = mgr.sessions.findIndex((s) => s.id === mgr.activeId)
    if (idx > 0) mgr.selectIndex(idx - 1)
    render()
  })
  screen.key(['down', 'j'], () => {
    const idx = mgr.sessions.findIndex((s) => s.id === mgr.activeId)
    if (idx < mgr.sessions.length - 1) mgr.selectIndex(idx + 1)
    render()
  })

  screen.key(['enter'], () => attach())

  for (let n = 1; n <= 9; n++) {
    screen.key([String(n)], () => {
      mgr.selectIndex(n - 1)
      render()
      attach()
    })
  }

  screen.key(['n'], () => showNewMenu())
  screen.key(['o'], () => runOnOpen())
  screen.key(['S-g', 'G'], () => {
    openWindowsTerminalGrid(project)
    statusMsg = 'Opened Windows Terminal grid'
    render()
  })

  // spawn shortcuts
  for (const a of agents) {
    if (!a.key) continue
    screen.key([a.key], () => spawnAgent(a))
  }

  // Close tab: w, d, Delete, Backspace (common muscle memory)
  screen.key(['w', 'd', 'delete', 'backspace'], () => closeSelectedTab())
  screen.key(['S-w', 'W'], () => closeAllTabs())

  screen.key(['m'], () => {
    ensureFileMemory(project)
    mineProject(project)
    statusMsg = mempalaceStatus() + ' · mine started'
    render()
  })

  screen.key(['p'], () => {
    const prompt = blessed.textbox({
      parent: screen,
      label: ' Project path ',
      top: 'center',
      left: 'center',
      width: '70%',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      value: project,
      style: { border: { fg: 'cyan' }, fg: 'white' }
    })
    prompt.focus()
    prompt.on('submit', (val: string) => {
      const next = resolve(val.trim() || project)
      if (existsSync(next)) {
        project = next
        ensureFileMemory(project)
        statusMsg = `Project → ${project}`
      } else {
        statusMsg = `Path not found: ${next}`
      }
      prompt.destroy()
      list.focus()
      render()
    })
    prompt.on('cancel', () => {
      prompt.destroy()
      list.focus()
      render()
    })
    screen.render()
    prompt.readInput()
  })

  list.on('select', (_item, idx) => {
    mgr.selectIndex(idx)
    render()
  })
  list.on('click', () => {
    // mouse select then double-enter to attach — single click updates preview
    render()
  })

  list.focus()
  // Auto: on-open + one shell so deck isn't empty
  runOnOpen()
  if (!mgr.sessions.length) {
    const shell = agents.find((a) => a.id === 'shell')
    if (shell) spawnAgent(shell)
  }
  statusMsg = `Ready · ${shortPath(project)} · Enter attaches full terminal`
  render()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

// silence unused pty import warning path for types
void pty
