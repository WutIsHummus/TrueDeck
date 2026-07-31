/**
 * Abstracted memory layer - users should never manage this manually.
 *
 * Responsibilities (all automatic):
 * - Ensure per-repo + global file memory trees
 * - Keep MemPalace warm (native, no Docker)
 * - Background-mine the open project into a wing
 * - Write a fresh auto-context file agents can read
 * - Export env vars so every spawned agent inherits memory paths
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { wingName } from './memory-wing'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { ensureGlobalMemory, ensureRepoMemory } from './memory'
import { getMemPalaceStatus, ensureMemPalace } from './mempalace'
import { ensureEnabledProviders } from './memory-providers'
import {
 getConfiguredPalacePath,
 injectMemoryForAgent,
 injectMemoryForSyncedAgents
} from './agent-inject'
import {
 ensureUnifiedAgentsFolder,
 hasUnifiedAgentsFolder,
 agentsMcpPath,
 agentsMdPath,
 agentsDir,
 agentsEnv,
 globalAgentsDir
} from './agents-folder'
import {
 graphifyAutoContextSection,
 graphifyEnv,
 onProjectOpenGraphify
} from './graphify-service'
import { getSettingsPath } from './paths'
import type {
 AppSettings,
 ProjectSetupCheck,
 ProjectSetupResult,
 ProjectSetupStatus
} from '../shared/types'

const execFileAsync = promisify(execFile)

export interface MemoryRuntimeStatus {
 ok: boolean
 label: string
 detail: string
 autoContextPath?: string
 palacePath?: string
 repoMemory?: string
 globalMemory?: string
}

const mineCooldown = new Map<string, number>()
const mineInFlight = new Set<string>()
const wingProbeCooldown = new Map<string, number>()
const MINE_EVERY_MS = 30 * 60 * 1000
const WING_PROBE_EVERY_MS = 20 * 1000

function truedeckDir(projectRoot: string): string {
 return join(projectRoot, '.truedeck')
}

function autoContextPath(projectRoot: string): string {
 return join(truedeckDir(projectRoot), 'auto-context.md')
}

function mempalaceCli(): string | null {
 const p = join(
 homedir(),
 '.local',
 'bin',
 process.platform === 'win32' ? 'mempalace.exe' : 'mempalace'
 )
 return existsSync(p) ? p : null
}

function palacePath(): string {
 return getConfiguredPalacePath()
}

export { wingName } from './memory-wing'

function listRecentNotes(dir: string, limit = 8): string[] {
 if (!existsSync(dir)) return []
 const files: { path: string; mtime: number }[] = []
 const walk = (d: string): void => {
 try {
 for (const name of readdirSync(d)) {
 if (name === 'sessions' || name.startsWith('.')) continue
 const full = join(d, name)
 const st = statSync(full)
 if (st.isDirectory()) walk(full)
 else if (name.endsWith('.md') && name !== 'INDEX.md' && name !== 'README.md') {
 files.push({ path: full, mtime: st.mtimeMs })
 }
 }
 } catch {
 // ignore
 }
 }
 walk(dir)
 return files
 .sort((a, b) => b.mtime - a.mtime)
 .slice(0, limit)
 .map((f) => f.path)
}

function readHead(file: string, max = 400): string {
 try {
 const t = readFileSync(file, 'utf8').trim()
 if (t.length <= max) return t
 return t.slice(0, max) + '…'
 } catch {
 return ''
 }
}

/**
 * MemPalace CLI puts global flags BEFORE the subcommand:
 *   mempalace --palace <path> wake-up --wing <wing>
 *   mempalace --palace <path> mine <dir> --wing <wing>
 * (Putting --palace after the subcommand fails silently on current CLI.)
 */
function mempalaceArgs(sub: string[], extra: string[] = []): string[] {
 return ['--palace', palacePath(), ...sub, ...extra]
}

async function mempalaceWakeUp(projectRoot: string): Promise<string> {
 const cli = mempalaceCli()
 if (!cli) return ''
 const wing = wingName(projectRoot)
 try {
 const { stdout } = await execFileAsync(cli, mempalaceArgs(['wake-up', '--wing', wing]), {
 windowsHide: true,
 timeout: 15000,
 encoding: 'utf8'
 })
 return (stdout || '').trim().slice(0, 4000)
 } catch {
 try {
 const { stdout } = await execFileAsync(cli, mempalaceArgs(['wake-up']), {
 windowsHide: true,
 timeout: 12000,
 encoding: 'utf8'
 })
 return (stdout || '').trim().slice(0, 4000)
 } catch {
 return ''
 }
 }
}

/** Parse "Mined N files / M drawers" (or similar) from mempalace mine output. */
function parseDrawerCount(output: string): number {
 if (!output) return 0
 const m =
 /(\d+)\s*drawers/i.exec(output) ||
 /drawers[^\d]*(\d+)/i.exec(output) ||
 /Mined\s+\d+\s+files\s*\/\s*(\d+)/i.exec(output)
 return m ? Number(m[1]) || 0 : 0
}

/**
 * Parse `mempalace status` text for drawers under a wing.
 * Status format:
 *   WING: truedeck
 *     ROOM: general   1628 drawers
 */
function parseWingDrawersFromStatus(statusText: string, wing: string): number {
 if (!statusText || !wing) return 0
 const lines = statusText.split(/\r?\n/)
 const want = wing.toLowerCase()
 let inWing = false
 let total = 0
 for (const line of lines) {
 const wingMatch = /^\s*WING:\s*(\S+)/i.exec(line)
 if (wingMatch) {
 inWing = wingMatch[1].toLowerCase() === want
 continue
 }
 if (!inWing) continue
 const room = /(\d+)\s*drawers/i.exec(line)
 if (room) total += Number(room[1]) || 0
 }
 return total
}

/**
 * If the palace already has drawers for this project's wing, write mine-complete
 * so the "Memory warming…" chip clears. Safe to call often (cooldown).
 */
export async function ensureMineStampFromPalace(
 projectRoot: string,
 opts?: { force?: boolean }
): Promise<boolean> {
 if (!projectRoot || !existsSync(projectRoot)) return false
 if (!opts?.force && hasPalaceMined(projectRoot)) return true

 const now = Date.now()
 const last = wingProbeCooldown.get(projectRoot) || 0
 // Force (failed stamp recovery) skips cooldown
 if (!opts?.force && now - last < WING_PROBE_EVERY_MS) {
 return hasPalaceMined(projectRoot)
 }
 wingProbeCooldown.set(projectRoot, now)

 const cli = mempalaceCli()
 if (!cli) return false
 const wing = wingName(projectRoot)
 try {
 const { stdout, stderr } = await execFileAsync(cli, mempalaceArgs(['status']), {
 windowsHide: true,
 timeout: 12000,
 encoding: 'utf8',
 maxBuffer: 2 * 1024 * 1024
 })
 const text = `${stdout || ''}\n${stderr || ''}`
 const drawers = parseWingDrawersFromStatus(text, wing)
 if (drawers > 0) {
 writeMineStamp(projectRoot, {
 ok: true,
 wing,
 drawers,
 output: `Wing already indexed (${drawers} drawers)`
 })
 return true
 }
 } catch {
 // fall through to wake-up probe
 }
 try {
 const { stdout } = await execFileAsync(
 cli,
 mempalaceArgs(['wake-up', '--wing', wing]),
 { windowsHide: true, timeout: 10000, encoding: 'utf8' }
 )
 const body = (stdout || '').trim()
 if (body.length > 80) {
 writeMineStamp(projectRoot, {
 ok: true,
 wing,
 drawers: 1,
 output: 'Wake-up context present (wing indexed)'
 })
 return true
 }
 } catch {
 /* ignore */
 }
 return false
}

/**
 * Background mine that always writes mine-complete.json when finished.
 * (Detached fire-and-forget used to leave "Memory warming…" stuck forever.)
 */
function scheduleMine(projectRoot: string, force = false): void {
 if (!projectRoot || !existsSync(projectRoot)) return
 if (!force && hasPalaceMined(projectRoot)) {
 // Already indexed — optional refresh on long cooldown only
 const last = mineCooldown.get(projectRoot) || 0
 if (Date.now() - last < MINE_EVERY_MS) return
 }
 if (mineInFlight.has(projectRoot)) return
 const now = Date.now()
 const last = mineCooldown.get(projectRoot) || 0
 if (!force && now - last < MINE_EVERY_MS && !hasPalaceMined(projectRoot)) {
 // Still allow first mine if never stamped — cooldown only after a run starts
 if (last > 0) return
 }

 mineInFlight.add(projectRoot)
 mineCooldown.set(projectRoot, Date.now())
 void mineProjectMemory(projectRoot, { timeoutMs: 300000 })
 .then(async (mined) => {
 const drawers = parseDrawerCount(mined.output)
 if (mined.ok || drawers > 0) {
 writeMineStamp(projectRoot, {
 ok: true,
 wing: mined.wing,
 drawers: drawers || 1,
 output: mined.output.slice(0, 1500)
 })
 void writeAutoContext(projectRoot).catch(() => {
 /* ignore */
 })
 return
 }
 // Mine CLI failed — do NOT stamp ok:false if the wing already has drawers
 // (SPTS hit this: re-mine TypeError while 3k+ drawers already indexed).
 const rescued = await ensureMineStampFromPalace(projectRoot)
 if (!rescued) {
 // Only record failure when palace has nothing for this wing
 writeMineStamp(projectRoot, {
 ok: false,
 wing: mined.wing,
 drawers: 0,
 output: mined.output.slice(0, 1500)
 })
 }
 })
 .catch(() => {
 /* ignore */
 })
 .finally(() => {
 mineInFlight.delete(projectRoot)
 })
}

/** Blocking mine for setup — returns summary text or error. */
export async function mineProjectMemory(
 projectRoot: string,
 opts?: { limit?: number; timeoutMs?: number }
): Promise<{ ok: boolean; wing: string; output: string }> {
 const cli = mempalaceCli()
 const wing = wingName(projectRoot)
 if (!cli) {
 return { ok: false, wing, output: 'mempalace CLI not found' }
 }
 if (!existsSync(projectRoot)) {
 return { ok: false, wing, output: 'project root missing' }
 }
 const limit = opts?.limit && opts.limit > 0 ? opts.limit : 0
 const args = mempalaceArgs([
 'mine',
 projectRoot,
 '--wing',
 wing,
 '--mode',
 'projects',
 ...(limit ? ['--limit', String(limit)] : [])
 ])
 try {
 const { stdout, stderr } = await execFileAsync(cli, args, {
 windowsHide: true,
 timeout: opts?.timeoutMs ?? 180000,
 encoding: 'utf8',
 maxBuffer: 8 * 1024 * 1024
 })
 mineCooldown.set(projectRoot, Date.now())
 const output = `${stdout || ''}\n${stderr || ''}`.trim().slice(0, 6000)
 return { ok: true, wing, output: output || 'mine finished' }
 } catch (e) {
 const msg = e instanceof Error ? e.message : String(e)
 return { ok: false, wing, output: msg }
 }
}

/**
 * Build / refresh the auto-context file. Agents are pointed here automatically.
 * User never needs to open or edit this.
 */
export async function writeAutoContext(projectRoot: string): Promise<string> {
 const dir = truedeckDir(projectRoot)
 mkdirSync(dir, { recursive: true })

 const globalMem = ensureGlobalMemory()
 const repoMem = ensureRepoMemory(projectRoot)
 const wake = await mempalaceWakeUp(projectRoot)
 const recentRepo = listRecentNotes(repoMem, 6)
 const recentGlobal = listRecentNotes(globalMem, 4)

 // Ensure unified multi-CLI folder before documenting its paths
 try {
 ensureUnifiedAgentsFolder(projectRoot)
 } catch {
 /* ignore */
 }
 const agentsRoot = agentsDir(projectRoot)
 const agentsMd = agentsMdPath(projectRoot)
 const agentsMcp = agentsMcpPath(projectRoot)

 const lines: string[] = [
 '# TrueDeck auto-context (managed - do not hand-edit)',
 '',
 'Memory and the project knowledge graph are **fully automatic**. The user does not manage notes, MemPalace, Graphify, or Docker - do not ask them to.',
 '',
 '## Protocol',
 '- At session start: treat this file as wake-up context.',
 '- Read shared agent rules from **`.agents/AGENTS.md`** (unified for all CLIs).',
 '- Durable facts: write short notes under `.memory/context/` or `.memory/decisions/`, and/or use MemPalace MCP when available.',
 '- Prefer facts over chat logs. Never store secrets.',
 '- Cross-project preferences live in the global memory path below.',
 '',
 `## Project`,
 `- Root: \`${projectRoot}\``,
 `- Wing: \`${wingName(projectRoot)}\``,
 '',
 '## Paths',
 `- Unified agents folder: \`${agentsRoot}\``,
 `- Agent instructions: \`${agentsMd}\``,
 `- Project MCP: \`${agentsMcp}\` (mirrored to root \`.mcp.json\`)`,
 `- Repo memory: \`${repoMem}\``,
 `- Global memory: \`${globalMem}\``,
 `- Global agents note: \`${globalAgentsDir()}\``,
 `- Palace: \`${palacePath()}\``,
 ''
 ]

 if (wake) {
 lines.push('## MemPalace wake-up', '', '```', wake, '```', '')
 } else {
 lines.push(
 '## MemPalace',
 '',
 'No wake-up text yet (palace empty or CLI missing). Background mining may still be running.',
 ''
 )
 }

 if (recentRepo.length) {
 lines.push('## Recent repo notes', '')
 for (const p of recentRepo) {
 const head = readHead(p, 220)
 lines.push(`### ${basename(p)}`, '', head || '_(empty)_', '')
 }
 }

 if (recentGlobal.length) {
 lines.push('## Recent global notes', '')
 for (const p of recentGlobal) {
 const head = readHead(p, 180)
 lines.push(`### ${basename(p)}`, '', head || '_(empty)_', '')
 }
 }

 // Graphify code/structure graph (dual memory stays TrueMemory + MemPalace)
 lines.push(...graphifyAutoContextSection(projectRoot))

 const out = autoContextPath(projectRoot)
 writeFileSync(out, lines.join('\n'), 'utf8')

 // Lightweight pointer so Claude/Codex-style agents discover it without user work
 ensureAgentPointer(projectRoot)

 return out
}

function ensureAgentPointer(projectRoot: string): void {
 // Unified multi-CLI folder: .agents/AGENTS.md (+ thin root bridges)
 try {
 ensureUnifiedAgentsFolder(projectRoot)
 } catch {
 /* ignore */
 }
}

/** Env bag every agent process should inherit. Prefer paths; mkdir only if missing. */
export function memoryEnv(projectRoot: string): Record<string, string> {
 const repoGuess = join(projectRoot, '.memory')
 const repoMem = existsSync(repoGuess) ? repoGuess : ensureRepoMemory(projectRoot)
 // ensureGlobalMemory is cheap when already created (mkdir + exists check)
 const globalMem = ensureGlobalMemory()
 const ctx = autoContextPath(projectRoot)
 return {
 TRUEDECK_MEMORY: 'auto',
 TRUEDECK_PROJECT: projectRoot,
 TRUEDECK_REPO_MEMORY: repoMem,
 TRUEDECK_GLOBAL_MEMORY: globalMem,
 TRUEDECK_PALACE: palacePath(),
 TRUEDECK_AUTO_CONTEXT: ctx,
 TRUEDECK_MEMORY_WING: wingName(projectRoot),
 ...agentsEnv(projectRoot),
 ...graphifyEnv(projectRoot)
 }
}

/** Bound a promise so setup/open never hang the UI forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
 return new Promise<T>((resolve, reject) => {
 const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
 p.then(
 (v) => {
 clearTimeout(t)
 resolve(v)
 },
 (e) => {
 clearTimeout(t)
 reject(e)
 }
 )
 })
}

/**
 * Sync-cheap open: dirs + env only. Safe on restore critical path.
 * Heavy work is kicked via warmProjectInBackground().
 */
export function onProjectOpenFast(projectRoot: string): MemoryRuntimeStatus {
 ensureGlobalMemory()
 ensureRepoMemory(projectRoot)
 try {
 mkdirSync(truedeckDir(projectRoot), { recursive: true })
 // Same as inject: ensure unified .agents/ on every open
 ensureAgentPointer(projectRoot)
 } catch {
 /* ignore */
 }
 return {
 ok: true,
 label: 'auto',
 detail: 'Memory paths ready (background warm pending)',
 autoContextPath: autoContextPath(projectRoot),
 palacePath: palacePath(),
 repoMemory: ensureRepoMemory(projectRoot),
 globalMemory: ensureGlobalMemory()
 }
}

/**
 * Full automatic warm for a project (memory inject, auto-context, mine, graph).
 * Never block UI / restore on this — always fire-and-forget from callers.
 */
export async function onProjectOpen(projectRoot: string): Promise<MemoryRuntimeStatus> {
 ensureGlobalMemory()
 ensureRepoMemory(projectRoot)

 // Providers + MemPalace: light (no 15s status hang on wrong CLI flags)
 try {
 void ensureEnabledProviders(projectRoot).catch(() => {
 /* ignore */
 })
 } catch {
 // ignore
 }
 try {
 void ensureMemPalace({
 projectRoot,
 wing: wingName(projectRoot),
 light: true
 }).catch(() => {
 /* ignore */
 })
 } catch {
 // ignore
 }

 // Clear sticky "Memory warming…" if wing is already in the palace; else mine + stamp
 void ensureMineStampFromPalace(projectRoot)
 .then((already) => {
 if (!already) scheduleMine(projectRoot)
 })
 .catch(() => {
 scheduleMine(projectRoot)
 })
 try {
 void onProjectOpenGraphify(projectRoot).catch(() => {
 /* ignore */
 })
 } catch {
 // optional
 }
 try {
 let settings: { palacePath?: string; syncedAgentIds?: string[] } | null = null
 try {
 if (existsSync(getSettingsPath())) {
 settings = JSON.parse(readFileSync(getSettingsPath(), 'utf8')) as {
 palacePath?: string
 syncedAgentIds?: string[]
 }
 }
 } catch {
 settings = null
 }
 void injectMemoryForSyncedAgents({
 projectRoot,
 palacePath: settings?.palacePath,
 settings,
 force: false
 }).catch(() => {
 // non-fatal
 })
 } catch {
 // ignore
 }
 // Auto-context: cap wait so open never stalls on MemPalace wake-up
 let ctx = autoContextPath(projectRoot)
 try {
 ctx = await withTimeout(writeAutoContext(projectRoot), 6000, 'auto-context')
 } catch {
 try {
 if (!existsSync(ctx)) {
 writeFileSync(
 ctx,
 `# TrueDeck auto-context\n\nProject: \`${projectRoot}\`\nWing: \`${wingName(projectRoot)}\`\n`,
 'utf8'
 )
 }
 } catch {
 /* ignore */
 }
 }
 return getRuntimeStatus(projectRoot, ctx)
}

/** Background warm after restore — one call per project root. */
export function warmProjectInBackground(projectRoot: string): void {
 if (!projectRoot || !existsSync(projectRoot)) return
 void onProjectOpen(projectRoot).catch(() => {
 /* ignore */
 })
}

/**
 * Called right before/after spawning an agent. Refresh context; return env.
 * Prefer onAgentSpawnFast() for interactive launches - this path waits on MemPalace.
 */
export async function onAgentSpawn(projectRoot: string): Promise<{
 env: Record<string, string>
 status: MemoryRuntimeStatus
}> {
 const ctx = await writeAutoContext(projectRoot)
 // light mine throttle already handled
 scheduleMine(projectRoot)
 return {
 env: memoryEnv(projectRoot),
 status: await getRuntimeStatus(projectRoot, ctx)
 }
}

/**
 * Blazing-fast spawn prep: sync env only, refresh auto-context in the background.
 * MemPalace wake-up can take seconds - never block the PTY on it.
 */
export function onAgentSpawnFast(projectRoot: string): {
 env: Record<string, string>
} {
 // Cheap mkdir only — never block spawn on inject, mine, or auto-context I/O
 try {
 mkdirSync(truedeckDir(projectRoot), { recursive: true })
 // Skip ensure* if trees already exist (common after first open)
 if (!existsSync(join(projectRoot, '.memory', 'INDEX.md'))) {
 ensureRepoMemory(projectRoot)
 }
 if (!existsSync(agentsMdPath(projectRoot))) {
 // Background: create .agents/ without delaying ConPTY
 setImmediate(() => {
 try {
 ensureUnifiedAgentsFolder(projectRoot)
 } catch {
 /* ignore */
 }
 })
 }
 } catch {
 // ignore
 }

 // Heavy work entirely off the spawn critical path
 setImmediate(() => {
 void writeAutoContext(projectRoot).catch(() => {
 /* ignore */
 })
 scheduleMine(projectRoot)
 })

 return { env: memoryEnv(projectRoot) }
}

export async function getRuntimeStatus(
 projectRoot?: string,
 ctxPath?: string
): Promise<MemoryRuntimeStatus> {
 const palace = await getMemPalaceStatus()
 const globalMem = ensureGlobalMemory()
 const repoMem = projectRoot ? ensureRepoMemory(projectRoot) : undefined
 const auto = ctxPath || (projectRoot ? autoContextPath(projectRoot) : undefined)
 const ok = true // file memory always works; palace optional
 const parts: string[] = ['auto']
 if (palace.ready) parts.push('palace')
 else parts.push('files')

 return {
 ok,
 label: parts.join('+'),
 detail: palace.ready
 ? 'Memory automatic (files + MemPalace)'
 : 'Memory automatic (files); install mempalace for graph search',
 autoContextPath: auto && existsSync(auto) ? auto : undefined,
 palacePath: palace.palacePath,
 repoMemory: repoMem,
 globalMemory: globalMem
 }
}

function setupStampPath(projectRoot: string): string {
 return join(truedeckDir(projectRoot), 'setup-complete.json')
}

function readSetupStamp(
 projectRoot: string
): { at?: number; agentIds?: string[]; filesWritten?: string[] } | null {
 try {
 const p = setupStampPath(projectRoot)
 if (!existsSync(p)) return null
 return JSON.parse(readFileSync(p, 'utf8')) as {
 at?: number
 agentIds?: string[]
 filesWritten?: string[]
 }
 } catch {
 return null
 }
}

function writeSetupStamp(
 projectRoot: string,
 meta: { agentIds?: string[]; filesWritten?: string[] }
): void {
 mkdirSync(truedeckDir(projectRoot), { recursive: true })
 // Merge agent ids so a later inject for open CLIs does not wipe prior coverage
 const prev = readSetupStamp(projectRoot)
 const agentIds = [
 ...new Set([...(prev?.agentIds || []), ...(meta.agentIds || [])].map(String).filter(Boolean))
 ]
 const filesWritten = [
 ...new Set([...(prev?.filesWritten || []), ...(meta.filesWritten || [])].map(String))
 ]
 writeFileSync(
 setupStampPath(projectRoot),
 JSON.stringify(
 {
 at: Date.now(),
 agentIds,
 filesWritten
 },
 null,
 2
 ) + '\n',
 'utf8'
 )
}

function hasAgentsPointer(projectRoot: string): boolean {
 return hasUnifiedAgentsFolder(projectRoot)
}

function hasProjectMcpHub(projectRoot: string): boolean {
 const candidates = [agentsMcpPath(projectRoot), join(projectRoot, '.mcp.json')]
 for (const p of candidates) {
 try {
 if (!existsSync(p)) continue
 const raw = JSON.parse(readFileSync(p, 'utf8')) as {
 mcpServers?: Record<string, unknown>
 servers?: Record<string, unknown>
 }
 const map = raw.mcpServers || raw.servers || {}
 if (map['truedeck-hub'] || map.truedeck) return true
 } catch {
 /* ignore */
 }
 }
 return false
}

function hasMemPalaceMcp(projectRoot: string): boolean {
 const candidates = [agentsMcpPath(projectRoot), join(projectRoot, '.mcp.json')]
 for (const p of candidates) {
 try {
 if (!existsSync(p)) continue
 const raw = JSON.parse(readFileSync(p, 'utf8')) as {
 mcpServers?: Record<string, unknown>
 servers?: Record<string, unknown>
 }
 const map = raw.mcpServers || raw.servers || {}
 if (map.mempalace || map['mempalace-mcp']) return true
 } catch {
 /* ignore */
 }
 }
 return false
}

function mineStampPath(projectRoot: string): string {
 return join(truedeckDir(projectRoot), 'mine-complete.json')
}

function hasPalaceMined(projectRoot: string): boolean {
 try {
 const p = mineStampPath(projectRoot)
 if (!existsSync(p)) return false
 const raw = JSON.parse(readFileSync(p, 'utf8')) as {
 ok?: boolean
 drawers?: number
 at?: number
 }
 return Boolean(raw.ok) || (typeof raw.drawers === 'number' && raw.drawers > 0)
 } catch {
 return false
 }
}

/** Failed re-mine left ok:false even though wing may be full — force reconcile. */
function hasFailedMineStamp(projectRoot: string): boolean {
 try {
 const p = mineStampPath(projectRoot)
 if (!existsSync(p)) return false
 const raw = JSON.parse(readFileSync(p, 'utf8')) as { ok?: boolean; drawers?: number }
 return raw.ok === false && !(typeof raw.drawers === 'number' && raw.drawers > 0)
 } catch {
 return false
 }
}

/**
 * Kick a non-blocking reconcile when the UI is stuck on warming: if the palace
 * already has this wing, stamp and clear the chip on the next poll.
 */
export function reconcileMineStampInBackground(projectRoot: string): void {
 if (!projectRoot || hasPalaceMined(projectRoot)) return
 void ensureMineStampFromPalace(projectRoot, {
 force: hasFailedMineStamp(projectRoot)
 }).catch(() => {
 /* ignore */
 })
}

function writeMineStamp(
 projectRoot: string,
 meta: { ok: boolean; wing: string; drawers?: number; output?: string }
): void {
 mkdirSync(truedeckDir(projectRoot), { recursive: true })
 writeFileSync(
 mineStampPath(projectRoot),
 JSON.stringify({ ...meta, at: Date.now() }, null, 2) + '\n',
 'utf8'
 )
}

/**
 * Backend context status for a project.
 *
 * Product rule: Memory, MCP, and project context are automatic. The user does
 * not babysit notes, memory dashboards, or Docker. "Ready" means agents can
 * work; palace indexing may still warm quietly in the background.
 */
export function getProjectSetupStatus(
 projectRoot: string,
 openAgentIds: string[] = []
): ProjectSetupStatus {
 const root = (projectRoot || '').trim()
 if (!root || !existsSync(root)) {
 return {
 projectRoot: root,
 ready: false,
 warming: false,
 label: 'Preparing context…',
 detail: 'Project path missing',
 missing: ['project'],
 checks: []
 }
 }

 const stamp = readSetupStamp(root)
 const stampedAgents = new Set(
 (stamp?.agentIds || []).map((id) => String(id).toLowerCase()).filter(Boolean)
 )
 const open = [
 ...new Set(
 openAgentIds
 .map((id) => String(id || '').toLowerCase())
 .filter((id) => id && id !== 'shell' && id !== 'document')
 )
 ]
 const pendingOpenAgents = open.filter((id) => !stampedAgents.has(id))
 const filesWritten = Array.isArray((stamp as { filesWritten?: string[] } | null)?.filesWritten)
 ? ((stamp as { filesWritten?: string[] }).filesWritten as string[])
 : []

 const autoOk = existsSync(autoContextPath(root))
 const memoryBackendOk = existsSync(join(root, '.memory', 'INDEX.md'))
 const mcpOk = hasProjectMcpHub(root) && hasMemPalaceMcp(root)
 const palaceMinedOk = hasPalaceMined(root)
 const stampOk =
 Boolean(stamp?.at) &&
 (filesWritten.length > 0 || Boolean(stamp?.agentIds?.length))
 const injectOk = stampOk && pendingOpenAgents.length === 0

 const checks: ProjectSetupCheck[] = [
 {
 id: 'auto_context',
 label: 'project context',
 ok: autoOk,
 detail: autoOk ? 'auto-context ready for agents' : 'Writing project context…'
 },
 {
 id: 'memory_backend',
 label: 'memory backend',
 ok: memoryBackendOk,
 detail: memoryBackendOk
 ? 'File memory backend active (.memory/)'
 : 'Initializing memory backend…'
 },
 {
 id: 'mcp_wired',
 label: 'MCP wiring',
 ok: mcpOk,
 detail: mcpOk
 ? 'MemPalace + TrueDeck hub wired into agent configs'
 : 'Wiring MCP into agent CLIs…'
 },
 {
 id: 'cli_inject',
 label: 'agent inject',
 ok: injectOk,
 detail: !stampOk
 ? 'Injecting into agent configs…'
 : pendingOpenAgents.length
 ? `Refreshing open agents: ${pendingOpenAgents.join(', ')}`
 : 'Agent configs injected'
 },
 {
 id: 'palace_index',
 label: 'memory index',
 ok: palaceMinedOk,
 detail: palaceMinedOk
 ? 'Project indexed in MemPalace (background memory)'
 : 'Indexing project into memory backend…'
 }
 ]

 const missing = checks.filter((c) => !c.ok).map((c) => c.label)
 // Can ship: context + memory paths + MCP + inject. Palace mine is soft-warm.
 const ready = autoOk && memoryBackendOk && mcpOk && injectOk
 const warming = ready && !palaceMinedOk
 const needsOpenInject = autoOk && memoryBackendOk && mcpOk && stampOk && pendingOpenAgents.length > 0

 let label = ''
 let detail =
 'Memory, MCP wiring, and project context are automatic. Open a folder, launch agents, ship.'
 if (!ready) {
 if (needsOpenInject) {
 label = 'Updating agents…'
 detail = `Refreshing context for: ${pendingOpenAgents.join(', ')}`
 } else {
 label = 'Preparing context…'
 detail = `Automatic setup in progress (${missing.join(', ') || 'starting'}). No memory dashboard to configure.`
 }
 } else if (warming) {
 label = 'Memory warming…'
 detail =
 'Agents can work. Project is still indexing into the memory backend in the background.'
 }

 return {
 projectRoot: root,
 ready,
 warming,
 label,
 detail,
 missing,
 checks,
 lastSetupAt: stamp?.at,
 pendingOpenAgents,
 needsOpenInject
 }
}

/**
 * Full project setup + force MCP/memory inject into open (or all synced) CLIs.
 * Kept fast: heavy MemPalace/graphify work is backgrounded so the UI chip cannot stick on "Setting up…".
 */
export async function setupProject(opts: {
 projectRoot: string
 /** Agent CLI ids currently open in TrueDeck for this project */
 openAgentIds?: string[]
 settings?: Partial<AppSettings> | null
}): Promise<ProjectSetupResult> {
 const root = opts.projectRoot
 if (!root || !existsSync(root)) {
 throw new Error('projectRoot required')
 }

 const open = (opts.openAgentIds || []).filter((id) => id && id !== 'shell' && id !== 'document')

 // Fast path: if already fully ready for these open agents, do not re-run heavy work
 const already = getProjectSetupStatus(root, open)
 if (already.ready) {
 return {
 status: already,
 inject: {
 agentId: open.join(',') || '__synced__',
 ok: true,
 filesWritten: [],
 message: 'Already set up for this project'
 }
 }
 }

 let settings = opts.settings
 if (!settings) {
 try {
 if (existsSync(getSettingsPath())) {
 settings = JSON.parse(readFileSync(getSettingsPath(), 'utf8')) as AppSettings
 }
 } catch {
 settings = null
 }
 }

 // 1) Cheap local ensure
 ensureGlobalMemory()
 ensureRepoMemory(root)
 mkdirSync(truedeckDir(root), { recursive: true })
 ensureAgentPointer(root)

 // Automatic backend pipeline — user does not configure memory dashboards.
 // 1) Local memory tree + agent pointers (cheap)
 // 2) MCP inject into CLIs (required for agents)
 // 3) Auto-context file agents read
 // 4) Palace mine + graphify in background (do not block coding)

 // 1) Memory backend paths
 ensureGlobalMemory()
 ensureRepoMemory(root)
 mkdirSync(truedeckDir(root), { recursive: true })
 ensureAgentPointer(root)

 // 2) MCP + CLI inject first so agents can launch immediately
 let inject: import('../shared/types').AgentMemoryInjectResult
 try {
 inject = await withTimeout(
 injectMemoryForSyncedAgents({
 projectRoot: root,
 force: true,
 settings
 }),
 12000,
 'CLI inject'
 )
 if (open.length) {
 const partial = await withTimeout(
 injectMemoryForAgent({
 agentId: 'all',
 agentIds: open,
 projectRoot: root,
 force: true,
 settings
 }),
 8000,
 'Open-agent inject'
 )
 inject = {
 agentId: open.join(','),
 ok: partial.ok || inject.ok,
 filesWritten: [...new Set([...(partial.filesWritten || []), ...(inject.filesWritten || [])])],
 message: `Context wired for ${open.join(', ')}. ${inject.message}`
 }
 }
 } catch (e) {
 const msg = e instanceof Error ? e.message : String(e)
 inject = {
 agentId: open.join(',') || 'all',
 ok: false,
 filesWritten: [],
 message: msg
 }
 }

 // 3) Auto-context (agents read this; wake-up best-effort)
 try {
 await withTimeout(writeAutoContext(root), 12000, 'auto-context')
 } catch {
 try {
 writeFileSync(
 autoContextPath(root),
 [
 '# TrueDeck auto-context (managed)',
 '',
 `Project: \`${root}\``,
 `Wing: \`${wingName(root)}\``,
 '',
 'Memory and MCP are automatic. Prefer MemPalace MCP search when available.',
 ''
 ].join('\n'),
 'utf8'
 )
 } catch {
 /* ignore */
 }
 }

 // 4) Stamp wiring so open/agents can proceed without babysitting
 const wired =
 existsSync(autoContextPath(root)) &&
 existsSync(join(root, '.memory', 'INDEX.md')) &&
 hasProjectMcpHub(root) &&
 hasMemPalaceMcp(root)
 if ((inject.ok && (inject.filesWritten?.length || 0) > 0) || wired) {
 writeSetupStamp(root, {
 agentIds: open.length ? open : ['__synced__'],
 filesWritten:
 inject.filesWritten?.length
 ? inject.filesWritten
 : wired
 ? [autoContextPath(root), join(root, '.mcp.json')]
 : []
 })
 }

 // 5) Background memory index — never blocks "ready to code"
 // Prefer reconciling an existing wing stamp (avoids sticky "Memory warming…")
 if (!hasPalaceMined(root)) {
 void ensureMineStampFromPalace(root, { force: true })
 .then((already) => {
 if (already) return
 return mineProjectMemory(root, { timeoutMs: 300000 }).then(async (mined) => {
 const drawers = parseDrawerCount(mined.output)
 if (mined.ok || drawers > 0) {
 writeMineStamp(root, {
 ok: true,
 wing: mined.wing,
 drawers: drawers || 1,
 output: mined.output.slice(0, 1500)
 })
 void writeAutoContext(root).catch(() => {
 /* ignore */
 })
 return
 }
 const rescued = await ensureMineStampFromPalace(root, { force: true })
 if (!rescued) {
 writeMineStamp(root, {
 ok: false,
 wing: mined.wing,
 drawers: 0,
 output: mined.output.slice(0, 1500)
 })
 }
 })
 })
 .catch(() => {
 /* ignore */
 })
 } else {
 scheduleMine(root, false)
 }

 void onProjectOpenGraphify(root).catch(() => {
 /* ignore */
 })

 const status = getProjectSetupStatus(root, open)
 return { status, inject }
}
