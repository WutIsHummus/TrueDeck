/**
 * Agent run history - what ran when (not only live tabs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalDataDir } from './paths'
import type { AgentRun } from '../shared/types'

const STORE = (): string => join(getGlobalDataDir(), 'runs.json')
const MAX_RUNS = 500

function loadAll(): AgentRun[] {
 try {
 const p = STORE()
 if (!existsSync(p)) return []
 const raw = JSON.parse(readFileSync(p, 'utf8')) as AgentRun[]
 return Array.isArray(raw) ? raw : []
 } catch {
 return []
 }
}

function saveAll(runs: AgentRun[]): void {
 const path = STORE()
 mkdirSync(dirname(path), { recursive: true })
 const trimmed = runs
 .sort((a, b) => b.startedAt - a.startedAt)
 .slice(0, MAX_RUNS)
 writeFileSync(path, JSON.stringify(trimmed, null, 2), 'utf8')
}

export function listRuns(opts?: {
 projectRoot?: string
 taskId?: string
 limit?: number
}): AgentRun[] {
 let runs = loadAll()
 if (opts?.projectRoot) {
 const root = opts.projectRoot.replace(/\\/g, '/').toLowerCase()
 runs = runs.filter((r) => r.projectRoot.replace(/\\/g, '/').toLowerCase() === root)
 }
 if (opts?.taskId) {
 runs = runs.filter((r) => r.taskId === opts.taskId)
 }
 const limit = opts?.limit ?? 100
 return runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}

export function getRun(id: string): AgentRun | undefined {
 return loadAll().find((r) => r.id === id)
}

export function startRun(input: {
 taskId?: string
 agentId: string
 agentName: string
 projectRoot: string
 worktreePath?: string
 sessionId?: string
 pipelineRunId?: string
}): AgentRun {
 const run: AgentRun = {
 id: randomUUID(),
 taskId: input.taskId,
 agentId: input.agentId,
 agentName: input.agentName,
 projectRoot: input.projectRoot,
 worktreePath: input.worktreePath,
 sessionId: input.sessionId,
 pipelineRunId: input.pipelineRunId,
 startedAt: Date.now()
 }
 const all = loadAll()
 all.unshift(run)
 saveAll(all)
 return run
}

export function endRun(sessionId: string, exitCode?: number, summary?: string): AgentRun | undefined {
 const all = loadAll()
 const idx = all.findIndex((r) => r.sessionId === sessionId && !r.endedAt)
 if (idx < 0) return undefined
 all[idx] = {
 ...all[idx],
 endedAt: Date.now(),
 exitCode,
 summary
 }
 saveAll(all)
 return all[idx]
}
