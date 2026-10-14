/**
 * Parallel fan-out: one shared task, one fresh CLI + git worktree per available agent.
 * Lanes do not share a checkout or a notes file, so edits and comments stay apart.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { loadAgents } from './agents'
import { probeAgents } from './resolve-command'
import { createTask, updateTask } from './tasks'
import { dispatchTask } from './task-dispatch'
import { listSessions } from './sessions-rust'
import { isGitRepo, taskBranchName } from './worktrees'
import type { SessionInfo } from '../shared/types'

/** Stay under the Windows ConPTY crash line. Extra CLIs also restart their own MCP processes. */
const MAX_LANES = 4
const SPAWN_GAP_MS = 1200

export interface FanoutLane {
 agentId: string
 agentName: string
 taskId?: string
 session?: SessionInfo
 worktreePath?: string
 branch?: string
 error?: string
}

export interface FanoutResult {
 swarmId: string
 contextPath: string
 lanes: FanoutLane[]
}

function laneBrief(opts: {
 agentId: string
 peers: string[]
 title: string
 body: string
 branch: string
}): string {
 const others = opts.peers.filter((id) => id !== opts.agentId)
 return [
 `You are the ${opts.agentId} lane of a TrueDeck fan-out.`,
 others.length
 ? `Other lanes on their own worktrees: ${others.join(', ')}.`
 : 'You are the only lane.',
 'You all received this same task. Solve it on your own branch.',
 'This is a new CLI. Do not continue an older chat.',
 'Edit only this worktree. Leave the main checkout and every other .truedeck/worktrees directory alone.',
 `Commit only on ${opts.branch}.`,
 'Write comments and your summary in .truedeck/lane/notes.md in this worktree.',
 '',
 '## Shared task',
 opts.title,
 '',
 opts.body || '(no extra details)'
 ].join('\n')
}

export async function startFanout(opts: {
 projectRoot: string
 title: string
 body?: string
 agentIds?: string[]
}): Promise<FanoutResult> {
 const projectRoot = opts.projectRoot
 const title = (opts.title || '').trim()
 if (!title) throw new Error('title is required')
 if (!projectRoot || !existsSync(projectRoot)) throw new Error('Project root missing')
 if (!(await isGitRepo(projectRoot))) {
 throw new Error(
 'Fan-out needs a git repository so each agent gets its own worktree. One checkout would stack every edit together.'
 )
 }

 const agents = loadAgents().filter((a) => a.id !== 'shell' && a.id !== 't3')
 const probes = new Map(probeAgents(agents).map((p) => [p.id, p]))
 const requested = opts.agentIds?.map((id) => id.trim()).filter(Boolean)
 let picked = agents.filter((a) => probes.get(a.id)?.available)
 if (requested?.length) {
 const want = new Set(requested)
 picked = agents.filter((a) => want.has(a.id) && probes.get(a.id)?.available)
 const missing = requested.filter((id) => !picked.some((a) => a.id === id))
 if (missing.length && picked.length === 0) {
 throw new Error(`None of these agents are installed: ${missing.join(', ')}`)
 }
 }
 picked = picked.slice(0, MAX_LANES)
 if (!picked.length) {
 throw new Error('No installed agent CLIs to fan out. Install one from the agent palette.')
 }

 let alreadyOpen = new Set<string>()
 try {
 const root = projectRoot.replace(/\\/g, '/').toLowerCase()
 const live = await listSessions()
 alreadyOpen = new Set(
 live
 .filter((s) => s.status === 'running' && s.agentId && s.agentId !== 'shell')
 .filter((s) => {
 const sr = (s.projectRoot || '').replace(/\\/g, '/').toLowerCase()
 return sr === root || sr.startsWith(root + '/')
 })
 .map((s) => s.agentId)
 )
 } catch {
 alreadyOpen = new Set()
 }
 const skipped = picked.filter((a) => alreadyOpen.has(a.id))
 picked = picked.filter((a) => !alreadyOpen.has(a.id))
 if (!picked.length) {
 const names = skipped.map((a) => a.name).join(', ')
 throw new Error(
 names
 ? `${names} already have a terminal open. Close those old processes before fanning out — starting another copy of each one is what piles up.`
 : 'No free agent CLIs to fan out.'
 )
 }

 const swarmId = randomUUID()
 const short = swarmId.replace(/-/g, '').slice(0, 8)
 const swarmDir = join(projectRoot, '.truedeck', 'swarms', short)
 mkdirSync(swarmDir, { recursive: true })
 const sharedBody = (opts.body || '').trim()
 const contextPath = join(swarmDir, 'context.md')
 writeFileSync(
 contextPath,
 [`# ${title}`, '', sharedBody, '', `swarm: ${swarmId}`, ''].join('\n'),
 'utf8'
 )

 const peerIds = picked.map((a) => a.id)
 const lanes: FanoutLane[] = skipped.map((agent) => ({
 agentId: agent.id,
 agentName: agent.name,
 error: 'Already open — left the existing process alone'
 }))

 for (let i = 0; i < picked.length; i++) {
 const agent = picked[i]
 try {
 const task = createTask({
 projectRoot,
 title: title.slice(0, 140),
 status: 'ready',
 assigneeAgentId: agent.id,
 isolate: true
 })
 const branch = taskBranchName(task.id, agent.id)
 const body = laneBrief({
 agentId: agent.id,
 peers: peerIds,
 title,
 body: sharedBody,
 branch
 })
 updateTask(task.id, { body })
 const dispatched = await dispatchTask(task.id, agent.id, {
 forceIsolation: true,
 swarmId
 })
 lanes.push({
 agentId: agent.id,
 agentName: agent.name,
 taskId: task.id,
 session: dispatched.session,
 worktreePath: dispatched.task.worktreePath,
 branch: dispatched.session.gitBranch || branch
 })
 } catch (e) {
 lanes.push({
 agentId: agent.id,
 agentName: agent.name,
 error: e instanceof Error ? e.message : String(e)
 })
 }
 if (i < picked.length - 1) {
 await new Promise((r) => setTimeout(r, SPAWN_GAP_MS))
 }
 }

 const ok = lanes.filter((l) => l.session)
 if (!ok.length) {
 const why = lanes.map((l) => `${l.agentId}: ${l.error || 'failed'}`).join('; ')
 throw new Error(why || 'Fan-out failed')
 }
 for (const lane of ok) {
 if (!lane.session) continue
 lane.session.swarmId = swarmId
 lane.session.swarmSize = ok.length
 }

 const laneLog = lanes
 .map((l) =>
 l.session
 ? `- ${l.agentName} · ${l.branch || ''} · ${l.worktreePath || ''}`
 : `- ${l.agentName} · failed · ${l.error || ''}`
 )
 .join('\n')
 writeFileSync(join(swarmDir, 'lanes.md'), `# Lanes\n\n${laneLog}\n`, 'utf8')

 return { swarmId, contextPath, lanes }
}
