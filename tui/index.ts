/**
 * TrueDeck desk. Run it as the Desk agent inside TrueDeck.
 *
 * Type a task, then mark the agents who should do it. Nothing starts until you do.
 * `claude, cursor: task` names them in the line.
 * Ctrl+N, or /new, starts one run on a harness and model you choose.
 * /fan <task> asks for agents even when a run is already idle.
 *
 * Ctrl+W closes the focused run. Ctrl+C quits the desk.
 */
import { existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import blessed from 'blessed'
import { SessionManager, type Session } from './sessions'
import { ensureFileMemory } from './memory'
import { followupSession, ptyLine, screenFrame, taskPrompt, writeBoard } from './desk'
import { taskWorktree } from './worktree'
import {
  defaultModel,
  harnessesNamedIn,
  installedHarnesses,
  presetForRun,
  runLabel,
  type Harness,
  type ModelChoice
} from './harnesses'

function parseProjectArg(): string {
  const fromEnv = process.env.TRUEDECK_PROJECT
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv)
  const arg = process.argv
    .slice(2)
    .find((a) => !a.startsWith('-') && !a.endsWith('.ts') && !a.endsWith('.js') && !a.endsWith('.mjs'))
  if (arg && existsSync(arg)) return resolve(arg)
  const spts = resolve(homedir(), 'SPTS')
  if (existsSync(spts)) return spts
  return process.cwd()
}

interface RunSpec {
  harness: Harness
  model: ModelChoice
  namedAgent: string | null
}

let project = parseProjectArg()
const mgr = new SessionManager()
let statusMsg = 'Type a task, then mark who should do it. Ctrl+N starts one run.'
let focusedId: string | null = null
let sending = false
let shownKey = '*'

function shortPath(p: string): string {
  return p.length > 56 ? '…' + p.slice(-54) : p
}

function runningSessions(): Session[] {
  return mgr.sessions.filter((s) => s.status === 'running')
}

function idleRun(): Session | null {
  const idle = runningSessions().filter((s) => !s.task)
  if (!idle.length) return null
  return idle.find((s) => s.id === focusedId) || idle[idle.length - 1]
}

function sectionText(session: Session, rows: number, cols: number): string {
  const task = session.task
  const tree = session.worktree ? session.worktree.replace(/\\/g, '/').split('/').pop() : ''
  const safe = (s: string) => s.replace(/\{/g, '(').replace(/\}/g, ')')
  if (!task) {
    return '{yellow-fg}idle{/}\n\nWaiting for a task.'
  }
  const frameRows = Math.max(1, rows - 2 - (tree ? 1 : 0))
  const frame = screenFrame(session.buf, frameRows, cols).trim()
  return [
    '{green-fg}working{/}',
    `{bold}${safe(task)}{/}`,
    frame ? safe(frame) : '{gray-fg}…{/}',
    tree ? `{gray-fg}worktree ${tree}{/}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

async function main(): Promise<void> {
  ensureFileMemory(project)

  const screen = blessed.screen({
    smartCSR: false,
    fullUnicode: true,
    title: 'TrueDeck Desk',
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
    label: ' Desk '
  })

  const stage = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: '100%-6',
    tags: true
  })

  const chat = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    keys: true,
    mouse: true,
    inputOnFocus: true,
    border: { type: 'line' },
    label: ' Talk ',
    style: {
      border: { fg: 'cyan' },
      fg: 'white',
      focus: { border: { fg: 'cyan' } }
    }
  })

  const boxes = new Map<string, blessed.Widgets.BoxElement>()

  function paintHeader(): void {
    const n = runningSessions().filter((s) => s.task).length
    header.setContent(
      ` {bold}project{/} ${shortPath(project)}  {gray-fg}${n} in flight{/}\n` +
        ` {cyan-fg}${statusMsg}{/}`
    )
  }

  function placeSections(): void {
    for (const box of boxes.values()) box.destroy()
    boxes.clear()
    const sessions = runningSessions()
    const width = (stage.width as number) || (screen.width as number) || 80
    const height = Math.max(4, (stage.height as number) || 10)
    if (!sessions.length) {
      const empty = blessed.box({
        parent: stage,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        border: { type: 'line' },
        tags: true,
        content:
          '{gray-fg}No runs yet.\n\nType a task, then mark the agents who should do it.\nOr name them: claude, cursor: fix the login\nCtrl+N starts one run on a harness and model you choose.{/}'
      })
      boxes.set('empty', empty)
      return
    }
    const cols = sessions.length === 1 ? 1 : sessions.length <= 4 ? 2 : 3
    const rows = Math.ceil(sessions.length / cols)
    const cw = Math.max(16, Math.floor(width / cols))
    const rh = Math.max(5, Math.floor(height / rows))
    sessions.forEach((session, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const box = blessed.box({
        parent: stage,
        top: row * rh,
        left: col * cw,
        width: col === cols - 1 ? width - col * cw : cw,
        height: row === rows - 1 ? height - row * rh : rh,
        border: { type: 'line' },
        label: ` ${session.name} `,
        tags: true,
        mouse: true,
        scrollable: false,
        style: {
          border: { fg: session.id === focusedId ? 'white' : session.color || 'gray' },
          fg: 'white'
        }
      })
      box.on('click', () => {
        focusedId = session.id
        paint()
      })
      boxes.set(session.id, box)
    })
  }

  function paint(): void {
    const key = runningSessions()
      .map((s) => s.id)
      .join(',')
    if (key !== shownKey) {
      shownKey = key
      placeSections()
    }
    paintHeader()
    for (const session of runningSessions()) {
      const box = boxes.get(session.id)
      if (!box) continue
      const innerH = Math.max(3, ((box.height as number) || 10) - 2)
      const innerW = Math.max(20, ((box.width as number) || 40) - 2)
      box.setContent(sectionText(session, innerH, innerW))
      try {
        box.setScroll(0)
      } catch {
        /* not scrollable */
      }
      box.style.border = { fg: session.id === focusedId ? 'white' : session.color || 'gray' }
    }
    screen.render()
  }

  function choose<T>(label: string, items: { label: string; value: T }[]): Promise<T | null> {
    return new Promise((resolveChoice) => {
      const box = blessed.list({
        parent: screen,
        label,
        top: 'center',
        left: 'center',
        width: 52,
        height: Math.min(18, items.length + 4),
        keys: true,
        mouse: true,
        vi: true,
        border: { type: 'line' },
        style: {
          border: { fg: 'cyan' },
          selected: { bg: 'cyan', fg: 'black', bold: true },
          item: { fg: 'white' }
        },
        items: items.map((item) => item.label)
      })
      const done = (value: T | null): void => {
        box.destroy()
        chat.focus()
        screen.render()
        resolveChoice(value)
      }
      box.on('select', (_item: unknown, index: number) => {
        done(items[index]?.value ?? null)
      })
      box.key(['escape'], () => done(null))
      box.focus()
      screen.render()
    })
  }

  function askText(label: string): Promise<string | null> {
    return new Promise((resolveText) => {
      const box = blessed.textbox({
        parent: screen,
        label,
        top: 'center',
        left: 'center',
        width: '70%',
        height: 3,
        border: { type: 'line' },
        inputOnFocus: true,
        keys: true,
        mouse: true,
        style: { border: { fg: 'cyan' }, fg: 'white' }
      })
      const done = (value: string | null): void => {
        box.destroy()
        chat.focus()
        screen.render()
        resolveText(value)
      }
      box.on('submit', (value: string) => done(String(value || '').trim() || null))
      box.on('cancel', () => done(null))
      box.focus()
      screen.render()
    })
  }

  async function chooseRun(): Promise<RunSpec | null> {
    const harnesses = installedHarnesses()
    if (!harnesses.length) {
      statusMsg = 'No harness CLIs are installed.'
      paint()
      return null
    }
    const harness = await choose(
      ' Harness ',
      harnesses.map((h) => ({ label: h.name, value: h }))
    )
    if (!harness) return null
    const models: ModelChoice[] = [...harness.models, { id: 'custom', label: 'Other model id…' }]
    const model = await choose(
      ' Model or agent ',
      models.map((m) => ({ label: m.label, value: m }))
    )
    if (!model) return null
    if (model.id === 'custom') {
      const id = await askText(' Model id ')
      if (!id) return null
      return { harness, model: { id, label: id }, namedAgent: null }
    }
    if (model.asAgent) {
      const namedAgent = await askText(` ${harness.name} agent name `)
      if (!namedAgent) return null
      return { harness, model, namedAgent }
    }
    return { harness, model, namedAgent: null }
  }

  async function startRun(
    spec: RunSpec,
    task: string | null,
    opts?: { deliver?: boolean; prompt?: string }
  ): Promise<Session> {
    const label = runLabel(spec.harness, spec.model, spec.namedAgent)
    const taskKey = Date.now().toString(36)
    const tree = await taskWorktree(project, spec.harness.id, taskKey)
    const cwd = tree?.path || project
    const cols = Math.max(40, (process.stdout.columns || 100) - 4)
    const rows = Math.max(12, (process.stdout.rows || 30) - 8)
    const preset = presetForRun(spec.harness, spec.model, spec.namedAgent, label)
    const argvTask = spec.harness.id === 'cursor' || spec.harness.id === 'codex'
    const prompt =
      opts?.prompt ||
      (task && opts?.deliver !== false ? taskPrompt(label, task, mgr.sessions) : '')
    const session = mgr.spawn(preset, cwd, cols, rows, argvTask && prompt ? prompt : null)
    session.name = label
    session.model = spec.namedAgent ? null : spec.model.id === 'default' ? null : spec.model.id
    session.namedAgent = spec.namedAgent
    session.worktree = tree?.path || null
    session.task = task
    focusedId = session.id
    writeBoard(project, mgr.sessions)
    if (task && prompt && !argvTask && opts?.deliver !== false) {
      setTimeout(() => {
        if (session.status === 'running') {
          try {
            session.proc.write(ptyLine(prompt))
          } catch {
            /* already exited */
          }
        }
      }, 1600)
    }
    statusMsg = task
      ? `${label} has that${tree ? ', in its own worktree' : ''}.`
      : `${label} is ready for the next task.`
    paint()
    return session
  }

  function chooseHarnesses(harnesses: Harness[]): Promise<Harness[] | null> {
    return new Promise((resolveChoice) => {
      const marked = new Set<string>()
      const row = (harness: Harness): string =>
        `${marked.has(harness.id) ? '[x]' : '[ ]'} ${harness.name}`
      const box = blessed.list({
        parent: screen,
        label: ' Agents — space marks, enter sends ',
        top: 'center',
        left: 'center',
        width: 52,
        height: Math.min(18, harnesses.length + 4),
        keys: false,
        mouse: true,
        tags: true,
        border: { type: 'line' },
        style: {
          border: { fg: 'cyan' },
          selected: { bg: 'cyan', fg: 'black', bold: true },
          item: { fg: 'white' }
        },
        items: harnesses.map(row)
      })
      let index = 0
      let redrawing = false
      const done = (value: Harness[] | null): void => {
        box.destroy()
        chat.focus()
        screen.render()
        resolveChoice(value)
      }
      const redraw = (): void => {
        const keep = index
        redrawing = true
        box.setItems(harnesses.map(row))
        box.select(keep)
        index = keep
        redrawing = false
        screen.render()
      }
      const toggle = (at: number): void => {
        const harness = harnesses[at]
        if (!harness) return
        index = at
        if (marked.has(harness.id)) marked.delete(harness.id)
        else marked.add(harness.id)
        redraw()
      }
      box.on('select item', (_item: unknown, at: number) => {
        if (!redrawing) index = at
      })
      box.key(['up', 'k'], () => {
        box.up(1)
        screen.render()
      })
      box.key(['down', 'j'], () => {
        box.down(1)
        screen.render()
      })
      box.key(['space'], () => toggle(index))
      box.on('select', (_item: unknown, at: number) => toggle(at))
      box.key(['enter'], () => {
        const picked = harnesses.filter((harness) => marked.has(harness.id))
        if (!picked.length) {
          box.setLabel(' Mark at least one agent ')
          screen.render()
          return
        }
        done(picked)
      })
      box.key(['escape'], () => done(null))
      box.focus()
      screen.render()
    })
  }

  async function launchTasks(task: string, targets: Harness[]): Promise<void> {
    const open = new Set(runningSessions().map((s) => s.agentId))
    const busy = targets.filter((harness) => open.has(harness.id))
    const free = targets.filter((harness) => !open.has(harness.id))
    if (!free.length) {
      statusMsg = busy.length
        ? `${busy.map((harness) => harness.name).join(', ')} already have a run.`
        : 'Mark at least one agent.'
      paint()
      return
    }
    statusMsg = `Starting ${free.map((harness) => harness.name).join(', ')}…`
    paint()
    const planned = free.map((harness) => ({
      harness,
      label: runLabel(harness, defaultModel(harness), null)
    }))
    const started: Session[] = []
    for (const item of planned) {
      const prompt = taskPrompt(
        item.label,
        task,
        planned.map((peer) => ({ name: peer.label, task }))
      )
      const argvTask = item.harness.id === 'cursor' || item.harness.id === 'codex'
      const session = await startRun(
        { harness: item.harness, model: defaultModel(item.harness), namedAgent: null },
        task,
        { deliver: !argvTask, prompt }
      )
      started.push(session)
      await new Promise((r) => setTimeout(r, 700))
    }
    writeBoard(project, mgr.sessions)
    const left = busy.length
      ? ` Left ${busy.map((harness) => harness.name).join(', ')} on their current run.`
      : ''
    statusMsg = `Sent that to ${started.map((session) => session.name).join(', ')}.${left}`
    paint()
  }

  async function sendSpecified(text: string): Promise<void> {
    const harnesses = installedHarnesses()
    if (!harnesses.length) {
      statusMsg = 'No harness CLIs are installed.'
      paint()
      return
    }
    const named = harnessesNamedIn(text, harnesses)
    if (named) {
      await launchTasks(named.task, named.harnesses)
      return
    }
    const open = new Set(runningSessions().map((s) => s.agentId))
    const free = harnesses.filter((harness) => !open.has(harness.id))
    if (!free.length) {
      statusMsg = 'Every agent already has a run. Ctrl+N starts another on a harness you choose.'
      paint()
      return
    }
    const picked = await chooseHarnesses(free)
    if (!picked?.length) {
      statusMsg = 'No agents picked.'
      paint()
      return
    }
    await launchTasks(text, picked)
  }

  async function onTalk(text: string): Promise<void> {
    if (sending) {
      statusMsg = 'Still starting the last run.'
      paint()
      return
    }
    sending = true
    try {
      const fanCmd = text === '/fan' || text.startsWith('/fan ')
      const fanBody = fanCmd ? text.replace(/^\/fan\s*/, '').trim() : ''
      if (fanCmd) {
        if (!fanBody) {
          statusMsg = 'Type /fan and the task, then mark the agents.'
          paint()
          return
        }
        await sendSpecified(fanBody)
        return
      }
      const newCmd = text === '/new' || text.startsWith('/new ')
      const taskFromNew = newCmd ? text.replace(/^\/new\s*/, '').trim() : ''
      if (newCmd && !taskFromNew) {
        const spec = await chooseRun()
        if (!spec) {
          statusMsg = 'No run started.'
          paint()
          return
        }
        await startRun(spec, null)
        return
      }
      if (newCmd && taskFromNew) {
        const spec = await chooseRun()
        if (!spec) {
          statusMsg = 'No run started.'
          paint()
          return
        }
        await startRun(spec, taskFromNew)
        return
      }
      const body = text
      const follow = followupSession(body, runningSessions())
      if (follow) {
        follow.proc.write(ptyLine(body))
        statusMsg = `Sent that to ${follow.name}.`
        writeBoard(project, mgr.sessions)
        paint()
        return
      }
      const idle = idleRun()
      if (idle) {
        idle.task = body
        writeBoard(project, mgr.sessions)
        idle.proc.write(ptyLine(taskPrompt(idle.name, body, mgr.sessions)))
        focusedId = idle.id
        statusMsg = `${idle.name} took that.`
        paint()
        return
      }
      await sendSpecified(body)
    } finally {
      sending = false
    }
  }

  function closeFocused(): void {
    const session = runningSessions().find((s) => s.id === focusedId)
    if (!session) {
      statusMsg = 'Click a run, then Ctrl+W closes it.'
      paint()
      return
    }
    const name = session.name
    mgr.kill(session.id)
    writeBoard(project, mgr.sessions)
    statusMsg = `Closed ${name}.`
    paint()
  }

  function spin(): void {
    if (sending) return
    sending = true
    void chooseRun()
      .then(async (spec) => {
        if (!spec) {
          statusMsg = 'No run started.'
          paint()
          return
        }
        await startRun(spec, null)
      })
      .finally(() => {
        sending = false
      })
  }

  screen.key(['C-c'], () => {
    mgr.dispose()
    process.exit(0)
  })
  screen.key(['C-n'], () => spin())
  screen.key(['C-w'], () => closeFocused())
  chat.key(['C-n'], () => spin())
  chat.key(['C-w'], () => closeFocused())

  chat.on('submit', (value: string) => {
    const text = String(value || '').trim()
    chat.clearValue()
    chat.focus()
    if (text) void onTalk(text)
    else paint()
  })
  chat.on('cancel', () => {
    chat.focus()
    screen.render()
  })

  screen.on('resize', () => {
    shownKey = ''
    paint()
  })

  setInterval(() => paint(), 500)
  chat.focus()
  paint()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
