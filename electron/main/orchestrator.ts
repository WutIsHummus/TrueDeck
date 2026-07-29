/**
 * Sequential pipeline runner - BridgeSwarm-lite.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { listPipelines, getPipeline, renderPrompt, newPipelineRunId } from './pipelines'
import { createTask, updateTask } from './tasks'
import { dispatchTask } from './task-dispatch'
import type { PipelineRun, PipelineRunStatus, PipelineStepRun } from '../shared/types'
import { getGlobalDataDir } from './paths'
import { existsSync as ex, mkdirSync as mk, readFileSync, writeFileSync as wr } from 'fs'
import { dirname } from 'path'

const RUNS = (): string => join(getGlobalDataDir(), 'pipeline-runs.json')
const MAX = 100

const active = new Map<string, { cancelled: boolean; paused: boolean }>()

function loadRuns(): PipelineRun[] {
 try {
 if (!ex(RUNS())) return []
 const raw = JSON.parse(readFileSync(RUNS(), 'utf8')) as PipelineRun[]
 return Array.isArray(raw) ? raw : []
 } catch {
 return []
 }
}

function saveRuns(runs: PipelineRun[]): void {
 mk(dirname(RUNS()), { recursive: true })
 wr(
 RUNS(),
 JSON.stringify(runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX), null, 2),
 'utf8'
 )
}

export function listPipelineRuns(projectRoot?: string, limit = 50): PipelineRun[] {
 let runs = loadRuns()
 if (projectRoot) {
 const root = projectRoot.replace(/\\/g, '/').toLowerCase()
 runs = runs.filter((r) => r.projectRoot.replace(/\\/g, '/').toLowerCase() === root)
 }
 return runs.slice(0, limit)
}

export function getPipelineRun(id: string): PipelineRun | undefined {
 return loadRuns().find((r) => r.id === id)
}

function upsertRun(run: PipelineRun): void {
 const all = loadRuns().filter((r) => r.id !== run.id)
 all.unshift(run)
 saveRuns(all)
}

function knowledgeDir(projectRoot: string, runId: string): string {
 return join(projectRoot, '.truedeck', 'pipelines', runId.slice(0, 8))
}

function writeKnowledge(projectRoot: string, runId: string, name: string, text: string): string {
 const dir = knowledgeDir(projectRoot, runId)
 mkdirSync(dir, { recursive: true })
 const p = join(dir, name)
 writeFileSync(p, text, 'utf8')
 return p
}

export async function startPipeline(opts: {
 pipelineId: string
 projectRoot: string
 title: string
 body?: string
 isolationDefault?: boolean
}): Promise<PipelineRun> {
 const pipe = getPipeline(opts.pipelineId)
 if (!pipe) throw new Error(`Pipeline not found: ${opts.pipelineId}`)
 if (!opts.projectRoot || !existsSync(opts.projectRoot)) {
 throw new Error('Project root missing')
 }

 const id = newPipelineRunId()
 const stepRuns: PipelineStepRun[] = pipe.steps.map((s) => ({
 stepId: s.id,
 status: 'pending'
 }))

 const run: PipelineRun = {
 id,
 pipelineId: pipe.id,
 pipelineName: pipe.name,
 projectRoot: opts.projectRoot,
 goalTitle: (opts.title || pipe.name).trim(),
 goalBody: (opts.body || '').trim(),
 status: 'running',
 stepIndex: 0,
 stepRuns,
 startedAt: Date.now()
 }
 upsertRun(run)
 active.set(id, { cancelled: false, paused: false })

 writeKnowledge(
 opts.projectRoot,
 id,
 'goal.md',
 `# ${run.goalTitle}\n\n${run.goalBody}\n\npipeline: ${pipe.name}\n`
 )

 // Fire async runner (don't block IPC)
 void runPipelineLoop(run.id, opts.isolationDefault === true)

 return run
}

export function cancelPipelineRun(id: string): PipelineRun | undefined {
 const ctl = active.get(id)
 if (ctl) ctl.cancelled = true
 const run = getPipelineRun(id)
 if (!run || run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
 return run
 }
 const next = { ...run, status: 'cancelled' as PipelineRunStatus, endedAt: Date.now() }
 upsertRun(next)
 return next
}

export function pausePipelineRun(id: string): PipelineRun | undefined {
 const ctl = active.get(id)
 if (ctl) ctl.paused = true
 const run = getPipelineRun(id)
 if (!run || run.status !== 'running') return run
 const next = { ...run, status: 'paused' as const }
 upsertRun(next)
 return next
}

export function resumePipelineRun(id: string): PipelineRun | undefined {
 const ctl = active.get(id)
 if (ctl) ctl.paused = false
 const run = getPipelineRun(id)
 if (!run || run.status !== 'paused') return run
 const next = { ...run, status: 'running' as const }
 upsertRun(next)
 if (!active.has(id)) active.set(id, { cancelled: false, paused: false })
 void runPipelineLoop(id, false)
 return next
}

async function waitForSessionExit(
 sessionId: string,
 timeoutMs = 2 * 60 * 60 * 1000
): Promise<number | undefined> {
 const { ptyManager } = await import('./pty-manager')
 const start = Date.now()
 while (Date.now() - start < timeoutMs) {
 const live = ptyManager.list().find((s) => s.id === sessionId)
 if (!live || live.status !== 'running') {
 return live?.exitCode
 }
 const ctl = [...active.values()]
 void ctl
 await new Promise((r) => setTimeout(r, 1500))
 // Check if any pipeline cancelled that owns this - handled by outer loop
 }
 return undefined
}

async function runPipelineLoop(runId: string, isolationDefault: boolean): Promise<void> {
 let run = getPipelineRun(runId)
 if (!run) return
 const pipe = getPipeline(run.pipelineId)
 if (!pipe) return

 if (!active.has(runId)) active.set(runId, { cancelled: false, paused: false })

 while (run.stepIndex < pipe.steps.length) {
 const ctl = active.get(runId)
 if (ctl?.cancelled) {
 run = {
 ...run,
 status: 'cancelled',
 endedAt: Date.now()
 }
 upsertRun(run)
 active.delete(runId)
 return
 }
 while (ctl?.paused) {
 await new Promise((r) => setTimeout(r, 800))
 if (active.get(runId)?.cancelled) break
 }

 const step = pipe.steps[run.stepIndex]
 const prompt = renderPrompt(step.promptTemplate, {
 title: run.goalTitle,
 body: run.goalBody,
 repo: run.projectRoot
 })

 const stepRuns = [...run.stepRuns]
 stepRuns[run.stepIndex] = {
 ...stepRuns[run.stepIndex],
 status: 'running'
 }
 run = { ...run, stepRuns, status: 'running' }
 upsertRun(run)

 try {
 const task = createTask({
 projectRoot: run.projectRoot,
 title: `${run.pipelineName}: ${step.roleId || step.agentId || 'step'} - ${run.goalTitle}`.slice(
 0,
 120
 ),
 body: prompt,
 status: 'ready',
 assigneeAgentId: step.agentId,
 roleId: step.roleId
 })
 // isolation flag via worktreePath preference stored on task after dispatch
 updateTask(task.id, {
 pipelineId: run.pipelineId,
 status: 'ready'
 })

 // Pass isolation through body marker for dispatch - update createTask isolation later
 const { session, runId: agentRunId, task: dispatched } = await dispatchTask(
 task.id,
 step.agentId,
 {
 forceIsolation: step.isolation === true || isolationDefault,
 pipelineRunId: runId
 }
 )

 stepRuns[run.stepIndex] = {
 stepId: step.id,
 taskId: task.id,
 runId: agentRunId,
 sessionId: session.id,
 status: 'running'
 }
 run = { ...run, stepRuns }
 upsertRun(run)

 const exitCode = await waitForSessionExit(session.id)
 const failed = exitCode !== undefined && exitCode !== 0 && exitCode !== -1

 // Append knowledge note
 writeKnowledge(
 run.projectRoot,
 runId,
 `step-${run.stepIndex + 1}.md`,
 `# Step ${run.stepIndex + 1}: ${step.roleId || step.agentId}\n\nexit: ${exitCode}\ntask: ${task.id}\n\n${prompt.slice(0, 2000)}\n`
 )

 if (failed) {
 stepRuns[run.stepIndex] = {
 ...stepRuns[run.stepIndex],
 status: 'failed'
 }
 if (step.onFail === 'stop') {
 run = {
 ...run,
 stepRuns,
 status: 'failed',
 error: `Step ${run.stepIndex + 1} failed (exit ${exitCode})`,
 endedAt: Date.now()
 }
 upsertRun(run)
 active.delete(runId)
 return
 }
 if (step.onFail === 'retry') {
 // one retry
 stepRuns[run.stepIndex] = { ...stepRuns[run.stepIndex], status: 'pending' }
 run = { ...run, stepRuns }
 upsertRun(run)
 continue
 }
 // continue
 stepRuns[run.stepIndex] = { ...stepRuns[run.stepIndex], status: 'skipped' }
 } else {
 stepRuns[run.stepIndex] = {
 ...stepRuns[run.stepIndex],
 status: 'done'
 }
 }

 void dispatched
 run = {
 ...run,
 stepRuns,
 stepIndex: run.stepIndex + 1
 }
 upsertRun(run)
 } catch (e) {
 const msg = e instanceof Error ? e.message : String(e)
 stepRuns[run.stepIndex] = {
 ...stepRuns[run.stepIndex],
 status: 'failed'
 }
 if (step.onFail === 'continue') {
 run = { ...run, stepRuns, stepIndex: run.stepIndex + 1 }
 upsertRun(run)
 continue
 }
 run = {
 ...run,
 stepRuns,
 status: 'failed',
 error: msg,
 endedAt: Date.now()
 }
 upsertRun(run)
 active.delete(runId)
 return
 }
 }

 run = {
 ...getPipelineRun(runId)!,
 status: 'done',
 endedAt: Date.now(),
 stepIndex: pipe.steps.length
 }
 upsertRun(run)
 active.delete(runId)
}

export { listPipelines, getPipeline }
