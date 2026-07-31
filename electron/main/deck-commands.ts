/**
 * Deck command queue - agents launch work via MCP without a UI panel.
 * MCP writes pending commands; Electron main processes them into real PTYs / viewers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalDataDir } from './paths'
import { createTask, getTask } from './tasks'
import { dispatchTask } from './task-dispatch'
import { startPipeline } from './orchestrator'
import { getRole } from './roles'
import {
  buildDocumentSession,
  openDocumentPopout,
  resolveShowDocumentPath
} from './document-viewer'
import type { SessionInfo } from '../shared/types'

export type DeckCommandType = 'launch' | 'dispatch' | 'pipeline' | 'show'

export interface DeckCommand {
  id: string
  type: DeckCommandType
  createdAt: number
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  projectRoot?: string
  title?: string
  body?: string
  agentId?: string
  roleId?: string
  isolate?: boolean
  taskId?: string
  pipelineId?: string
  /** Absolute file path for type === 'show' */
  path?: string
  /** Inline text/code/md content for type === 'show' (written to scratch if no path) */
  content?: string
  /** Language / extension hint for inline content (ts, md, py, …) */
  language?: string
  /**
   * For show: open a dedicated TrueDeck Electron window (default true).
   */
  popout?: boolean
  /**
   * For show: also open as a dockable document tab (default false).
   */
  asTab?: boolean
  result?: {
    taskId?: string
    sessionId?: string
    agentName?: string
    pipelineRunId?: string
    pipelineName?: string
    /** Full session after dispatch (for chrome stamp / UI re-emit). */
    session?: SessionInfo
    documentPath?: string
    written?: boolean
    popout?: boolean
  }
}

function queuePath(): string {
  return join(getGlobalDataDir(), 'deck-command-queue.json')
}

function loadQueue(): DeckCommand[] {
  try {
    const p = queuePath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8')) as DeckCommand[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveQueue(list: DeckCommand[]): void {
  const p = queuePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(list.slice(-80), null, 2), 'utf8')
}

function patchCommand(id: string, patch: Partial<DeckCommand>): DeckCommand | undefined {
  const all = loadQueue()
  const idx = all.findIndex((c) => c.id === id)
  if (idx < 0) return undefined
  all[idx] = { ...all[idx], ...patch }
  saveQueue(all)
  return all[idx]
}

export function getDeckCommand(id: string): DeckCommand | undefined {
  return loadQueue().find((c) => c.id === id)
}

export function listDeckCommands(limit = 20): DeckCommand[] {
  return loadQueue()
    .slice()
    .reverse()
    .slice(0, limit)
}

export function enqueueDeckCommand(
  input: Omit<DeckCommand, 'id' | 'createdAt' | 'status' | 'result' | 'error'> & {
    type: DeckCommandType
  }
): DeckCommand {
  const cmd: DeckCommand = {
    id: randomUUID(),
    createdAt: Date.now(),
    status: 'pending',
    type: input.type,
    projectRoot: input.projectRoot,
    title: input.title,
    body: input.body,
    agentId: input.agentId,
    roleId: input.roleId,
    isolate: input.isolate,
    taskId: input.taskId,
    pipelineId: input.pipelineId,
    path: input.path,
    content: input.content,
    language: input.language,
    popout: input.popout,
    asTab: input.asTab
  }
  const all = loadQueue()
  all.push(cmd)
  saveQueue(all)
  return cmd
}

async function executeCommand(cmd: DeckCommand): Promise<DeckCommand> {
  if (cmd.type === 'launch') {
    if (!cmd.projectRoot) throw new Error('projectRoot required')
    if (!cmd.title?.trim()) throw new Error('title required')
    const role = cmd.roleId ? getRole(cmd.roleId) : undefined
    const agentId = cmd.agentId || role?.agentId || 'claude'
    const task = createTask({
      projectRoot: cmd.projectRoot,
      title: cmd.title.trim(),
      body: cmd.body,
      status: 'ready',
      assigneeAgentId: agentId,
      roleId: cmd.roleId,
      isolate: cmd.isolate
    })
    const { session } = await dispatchTask(task.id, agentId)
    return {
      ...cmd,
      status: 'done',
      result: {
        taskId: task.id,
        sessionId: session.id,
        agentName: session.agentName,
        session
      }
    }
  }

  if (cmd.type === 'dispatch') {
    if (!cmd.taskId) throw new Error('taskId required')
    const task = getTask(cmd.taskId)
    if (!task) throw new Error(`Task not found: ${cmd.taskId}`)
    const { session } = await dispatchTask(cmd.taskId, cmd.agentId)
    return {
      ...cmd,
      status: 'done',
      result: {
        taskId: task.id,
        sessionId: session.id,
        agentName: session.agentName,
        session
      }
    }
  }

  if (cmd.type === 'pipeline') {
    if (!cmd.pipelineId) throw new Error('pipelineId required')
    if (!cmd.projectRoot) throw new Error('projectRoot required')
    const run = await startPipeline({
      pipelineId: cmd.pipelineId,
      projectRoot: cmd.projectRoot,
      title: (cmd.title || 'Pipeline run').trim(),
      body: cmd.body
    })
    return {
      ...cmd,
      status: 'done',
      result: {
        pipelineRunId: run.id,
        pipelineName: run.pipelineName
      }
    }
  }

  if (cmd.type === 'show') {
    const resolved = resolveShowDocumentPath({
      path: cmd.path,
      content: cmd.content,
      title: cmd.title,
      language: cmd.language,
      projectRoot: cmd.projectRoot
    })
    // Default: TrueDeck native pop-out window (never the system browser)
    const wantPopout = cmd.popout !== false
    const wantTab = cmd.asTab === true

    if (wantPopout) {
      openDocumentPopout({ path: resolved.path, title: resolved.title })
    }

    let session: SessionInfo | undefined
    if (wantTab) {
      session = buildDocumentSession({
        path: resolved.path,
        title: resolved.title,
        projectRoot: cmd.projectRoot
      })
    }

    // Always open at least the in-app window
    if (!wantPopout && !wantTab) {
      openDocumentPopout({ path: resolved.path, title: resolved.title })
    }

    return {
      ...cmd,
      status: 'done',
      result: {
        sessionId: session?.id,
        agentName: session?.agentName || 'Doc',
        session,
        documentPath: resolved.path,
        written: resolved.written,
        popout: wantPopout || (!wantPopout && !wantTab)
      }
    }
  }

  throw new Error(`Unknown command type: ${(cmd as DeckCommand).type}`)
}

/**
 * Poll pending queue and execute. Returns stop fn.
 * Sessions are spawned via the Rust backend (emits pty:spawned to renderer).
 * Document show sessions are emitted the same way (no PTY).
 */
export function startDeckCommandWorker(opts?: {
  onSession?: (session: SessionInfo) => void
  onError?: (err: unknown, cmd: DeckCommand) => void
}): () => void {
  let stopped = false
  let busy = false

  const tick = async (): Promise<void> => {
    if (stopped || busy) return
    const all = loadQueue()
    const pending = all.find((c) => c.status === 'pending')
    if (!pending) return
    busy = true
    patchCommand(pending.id, { status: 'running' })
    try {
      const done = await executeCommand(pending)
      patchCommand(pending.id, {
        status: 'done',
        result: done.result,
        error: undefined
      })
      if (done.result?.session && opts?.onSession) {
        opts.onSession(done.result.session)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patchCommand(pending.id, { status: 'error', error: msg })
      opts?.onError?.(e, pending)
      console.warn('[deck-commands]', pending.id, msg)
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => {
    void tick()
  }, 400)
  void tick()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
