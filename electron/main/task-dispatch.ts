/**
 * Dispatch a kanban task to a real agent CLI PTY.
 * Writes `.truedeck/tasks/<id>.md` and seeds context; best-effort stdin paste.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { loadAgents } from './agents'
import { ptyManager } from './pty-manager'
import { onAgentSpawnFast } from './memory-service'
import { getTask, attachRun, updateTask } from './tasks'
import { startRun } from './runs'
import { scheduleGraphifySync } from './graphify-service'
import { getRole } from './roles'
import { ensureTaskWorktree, worktreeLabel } from './worktrees'
import { getSettingsPath } from './paths'
import type { SessionInfo, Task } from '../shared/types'

function taskDir(projectRoot: string): string {
 return join(projectRoot, '.truedeck', 'tasks')
}

export function writeTaskFile(task: Task, cwdOverride?: string): string {
 const root = cwdOverride || task.projectRoot
 const dir = taskDir(task.projectRoot)
 mkdirSync(dir, { recursive: true })
 const path = join(dir, `${task.id.slice(0, 8)}.md`)
 const body = [
 `# ${task.title}`,
 '',
 `Status: ${task.status}`,
 `Agent: ${task.assigneeAgentId || '(unassigned)'}`,
 `Task id: ${task.id}`,
 task.worktreePath ? `Worktree: ${task.worktreePath}` : '',
 '',
 '## Instructions',
 '',
 task.body || '_No details provided._',
 '',
 '## TrueDeck',
 '',
 'This task was dispatched from the TrueDeck board.',
 'When finished, summarize what you did. The board will move the card to **Review** when this session exits.',
 cwdOverride && cwdOverride !== task.projectRoot
 ? `Working directory is an isolated git worktree: \`${cwdOverride}\`.`
 : '',
 ''
 ]
 .filter((l) => l !== '')
 .join('\n')
 writeFileSync(path, body, 'utf8')

 try {
 const focusDir = join(task.projectRoot, '.truedeck')
 mkdirSync(focusDir, { recursive: true })
 const ideaBody = (task.body || '').replace(/\s+/g, ' ').trim()
 const ideaLine =
 ideaBody && ideaBody.toLowerCase() !== task.title.trim().toLowerCase()
 ? `${task.title.trim()} - ${ideaBody.slice(0, 140)}`
 : task.title.trim()
 writeFileSync(
 join(focusDir, 'current-focus.md'),
 [
 `# ${task.title.trim()}`,
 '',
 ideaLine,
 '',
 `task: ${task.id}`,
 `agent: ${task.assigneeAgentId || ''}`,
 task.worktreePath ? `worktree: ${worktreeLabel(task.worktreePath)}` : '',
 ''
 ]
 .filter(Boolean)
 .join('\n'),
 'utf8'
 )
 } catch {
 /* ignore */
 }
 void root
 return path
}

function seedText(task: Task, taskFile: string, worktreePath?: string): string {
 const rel = taskFile.replace(task.projectRoot, '').replace(/^[\\/]/, '')
 return [
 `TrueDeck task: ${task.title}`,
 `Read the task file: ${rel}`,
 worktreePath ? `You are in isolated worktree: ${worktreePath}` : '',
 task.body ? `Details: ${task.body.slice(0, 500)}` : '',
 'Work on this task. Prefer durable notes under .memory/ when relevant.'
 ]
 .filter(Boolean)
 .join('\n')
}

function isolationDefault(): boolean {
 try {
 if (!existsSync(getSettingsPath())) return false
 const s = JSON.parse(readFileSync(getSettingsPath(), 'utf8')) as {
 worktreeIsolationDefault?: boolean
 }
 return s.worktreeIsolationDefault === true
 } catch {
 return false
 }
}

export async function dispatchTask(
 taskId: string,
 agentIdOverride?: string,
 opts?: {
 forceIsolation?: boolean
 pipelineRunId?: string
 }
): Promise<{ task: Task; session: SessionInfo; runId: string; taskFile: string }> {
 const task = getTask(taskId)
 if (!task) throw new Error(`Task not found: ${taskId}`)
 if (!task.projectRoot || !existsSync(task.projectRoot)) {
 throw new Error('Task project path missing')
 }

 const role = task.roleId ? getRole(task.roleId) : undefined
 const agentId = agentIdOverride || task.assigneeAgentId || role?.agentId || 'shell'
 const agents = loadAgents()
 const agent = agents.find((a) => a.id === agentId)
 if (!agent) throw new Error(`Unknown agent: ${agentId}`)

 let worktreePath =
 task.worktreePath && task.worktreePath.length > 0 ? task.worktreePath : undefined
 const wantIsolation =
 opts?.forceIsolation === true ||
 isolationDefault() ||
 task.worktreePath !== undefined

 if (wantIsolation && !worktreePath) {
 try {
 const wt = await ensureTaskWorktree(task.projectRoot, task.id)
 worktreePath = wt.path
 updateTask(task.id, { worktreePath })
 } catch {
 // Non-git or failure - fall back to main root
 worktreePath = undefined
 updateTask(task.id, { worktreePath: undefined })
 }
 }

 const cwd = worktreePath && existsSync(worktreePath) ? worktreePath : task.projectRoot

 const taskForFile: Task = {
 ...(role?.prefixPrompt
 ? {
 ...task,
 body: [role.prefixPrompt.trim(), '', '---', '', task.body || ''].join('\n').trim()
 }
 : task),
 worktreePath
 }

 const taskFile = writeTaskFile(taskForFile, cwd)
 const { env } = onAgentSpawnFast(task.projectRoot)
 const title = (task.title || 'Untitled').trim()
 const bodyOneLine = (task.body || '').replace(/\s+/g, ' ').trim()
 const firstSentence =
 bodyOneLine.split(/(?<=[.!?])\s+/).find((s) => s.length > 0) || bodyOneLine
 let idea = title
 if (firstSentence && firstSentence.length > 8 && firstSentence.toLowerCase() !== title.toLowerCase()) {
 idea = `${title} - ${firstSentence}`.slice(0, 160)
 }
 if (role?.label) idea = `[${role.label}] ${idea}`.slice(0, 160)
 if (worktreePath) idea = `${idea} · wt:${worktreeLabel(worktreePath)}`.slice(0, 160)

 const extraEnv = {
 ...env,
 TRUEDECK_TASK: task.id,
 TRUEDECK_TASK_FILE: taskFile,
 TRUEDECK_TASK_TITLE: title.slice(0, 80),
 TRUEDECK_TASK_IDEA: idea.slice(0, 160),
 TRUEDECK_PROJECT: cwd,
 ...(worktreePath
 ? {
 TRUEDECK_WORKTREE: worktreePath,
 TRUEDECK_WORKTREE_LABEL: worktreeLabel(worktreePath)
 }
 : {}),
 ...(role ? { TRUEDECK_ROLE: role.id, TRUEDECK_ROLE_LABEL: role.label } : {}),
 ...(opts?.pipelineRunId ? { TRUEDECK_PIPELINE_RUN: opts.pipelineRunId } : {})
 }

 const session = await ptyManager.spawn({
 projectRoot: cwd,
 agent,
 extraEnv
 })
 // Keep session metadata pointing at main project for board filters
 session.projectRoot = task.projectRoot
 // Always stamp task chrome fields (not only when isolated worktree)
 session.focusTitle = title.slice(0, 80)
 session.focusIdea = idea.slice(0, 160)
 session.title = title.slice(0, 80)
 session.taskId = task.id
 session.taskStatus = 'running'
 if (role?.label) session.roleLabel = role.label
 if (worktreePath) session.worktreeLabel = worktreeLabel(worktreePath)

 const run = startRun({
 taskId: task.id,
 agentId: agent.id,
 agentName: agent.name,
 projectRoot: task.projectRoot,
 worktreePath,
 sessionId: session.id,
 pipelineRunId: opts?.pipelineRunId
 })

 const updated =
 attachRun(task.id, run.id, session.id) ||
 updateTask(task.id, {
 status: 'running',
 sessionId: session.id,
 assigneeAgentId: agent.id,
 worktreePath
 })
 if (updated?.status) session.taskStatus = updated.status

 const seed = seedText(task, taskFile, worktreePath)
 setTimeout(() => {
 try {
 const payload =
 process.platform === 'win32' ? seed.replace(/\n/g, '\r') + '\r' : seed + '\n'
 ptyManager.write(session.id, payload)
 } catch {
 // ignore
 }
 }, 1200)

 scheduleGraphifySync(task.projectRoot, 'update')

 return {
 task: updated || { ...task, worktreePath, sessionId: session.id, status: 'running' },
 session,
 runId: run.id,
 taskFile
 }
}
