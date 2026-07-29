/**
 * Task board store - BridgeBoard-style kanban cards per project.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalDataDir } from './paths'
import type { Task, TaskStatus } from '../shared/types'

const STORE = (): string => join(getGlobalDataDir(), 'tasks.json')

function loadAll(): Task[] {
 try {
 const p = STORE()
 if (!existsSync(p)) return []
 const raw = JSON.parse(readFileSync(p, 'utf8')) as Task[]
 return Array.isArray(raw) ? raw : []
 } catch {
 return []
 }
}

function saveAll(tasks: Task[]): void {
 const path = STORE()
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(tasks, null, 2), 'utf8')
}

export function listTasks(projectRoot?: string): Task[] {
 const all = loadAll()
 if (!projectRoot) return all.sort((a, b) => b.updatedAt - a.updatedAt)
 const root = projectRoot.replace(/\\/g, '/').toLowerCase()
 return all
 .filter((t) => t.projectRoot.replace(/\\/g, '/').toLowerCase() === root)
 .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getTask(id: string): Task | undefined {
 return loadAll().find((t) => t.id === id)
}

export function createTask(input: {
 projectRoot: string
 title: string
 body?: string
 status?: TaskStatus
 assigneeAgentId?: string
 roleId?: string
 /** When true, mark task for worktree isolation (dispatch honors settings too) */
 isolate?: boolean
}): Task {
 const now = Date.now()
 const task: Task = {
 id: randomUUID(),
 projectRoot: input.projectRoot,
 title: input.title.trim() || 'Untitled task',
 body: (input.body || '').trim(),
 status: input.status || 'backlog',
 assigneeAgentId: input.assigneeAgentId,
 roleId: input.roleId,
 // Placeholder path flag - real path filled at dispatch
 worktreePath: input.isolate ? '' : undefined,
 runIds: [],
 createdAt: now,
 updatedAt: now
 }
 const all = loadAll()
 all.push(task)
 saveAll(all)
 return task
}

export function updateTask(
 id: string,
 patch: Partial<
 Pick<
 Task,
 | 'title'
 | 'body'
 | 'status'
 | 'assigneeAgentId'
 | 'roleId'
 | 'sessionId'
 | 'worktreePath'
 | 'pipelineId'
 | 'runIds'
 >
 >
): Task | undefined {
 const all = loadAll()
 const idx = all.findIndex((t) => t.id === id)
 if (idx < 0) return undefined
 all[idx] = {
 ...all[idx],
 ...patch,
 updatedAt: Date.now()
 }
 saveAll(all)
 return all[idx]
}

export function deleteTask(id: string): boolean {
 const all = loadAll()
 const next = all.filter((t) => t.id !== id)
 if (next.length === all.length) return false
 saveAll(next)
 return true
}

export function attachRun(taskId: string, runId: string, sessionId?: string): Task | undefined {
 const t = getTask(taskId)
 if (!t) return undefined
 const runIds = t.runIds.includes(runId) ? t.runIds : [...t.runIds, runId]
 return updateTask(taskId, {
 runIds,
 sessionId: sessionId ?? t.sessionId,
 status: 'running'
 })
}

/** When a PTY exits, move linked running task → review (or blocked). */
export function onSessionExit(sessionId: string, exitCode?: number): Task | undefined {
 const all = loadAll()
 const t = all.find((x) => x.sessionId === sessionId && x.status === 'running')
 if (!t) return undefined
 return updateTask(t.id, {
 status: exitCode === 0 || exitCode === undefined ? 'review' : 'blocked',
 sessionId: undefined
 })
}
