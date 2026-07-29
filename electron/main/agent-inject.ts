/**
 * Wire TrueDeck memory into the CLI the user actually runs
 * (Cursor MCP, Claude Code MCP, AGENTS.md / CLAUDE.md, env pointers).
 * Users should not hand-edit these during normal use.
 */
import {
 existsSync,
 mkdirSync,
 readFileSync,
 writeFileSync,
 readdirSync,
 statSync
} from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import { dialog } from 'electron'
import { getGlobalDataDir, getGlobalMemoryDir } from './paths'
import { getMemPalaceStatus } from './mempalace'
import { loadMemoryProviders, saveMemoryProviders } from './memory-providers'
import { ensureGlobalMemory, ensureRepoMemory } from './memory'
import { buildUnifiedMcpMap, injectMcpToAllClients } from './mcp-hub'
import type {
 AgentMemoryInjectResult,
 AppSettings,
 MemorySpaceInfo
} from '../shared/types'

function defaultPalace(): string {
 return join(homedir(), '.mempalace', 'palace')
}

export function getConfiguredPalacePath(settings?: Partial<AppSettings> | null): string {
 const fromSettings = settings?.palacePath?.trim()
 if (fromSettings) return fromSettings
 try {
 const providers = loadMemoryProviders()
 const mp = providers.find((p) => p.kind === 'mempalace' && p.dataPath)
 if (mp?.dataPath) return mp.dataPath
 } catch {
 // ignore
 }
 return defaultPalace()
}

/** Keep MemPalace provider args pointed at the active palace. */
export function applyPalaceToProviders(palacePath: string): void {
 const list = loadMemoryProviders()
 let changed = false
 const next = list.map((p) => {
 if (p.kind !== 'mempalace') return p
 changed = true
 return {
 ...p,
 enabled: true,
 dataPath: palacePath,
 args: ['--palace', palacePath]
 }
 })
 if (changed) saveMemoryProviders(next)
}

function readJsonFile(path: string): Record<string, unknown> {
 try {
 if (!existsSync(path)) return {}
 const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
 return raw && typeof raw === 'object' && !Array.isArray(raw)
 ? (raw as Record<string, unknown>)
 : {}
 } catch {
 return {}
 }
}

function writeJsonFile(path: string, data: unknown): void {
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function mempalaceMcpEntry(palacePath: string): {
 command: string
 args: string[]
} {
 const providers = loadMemoryProviders()
 const mp = providers.find((p) => p.kind === 'mempalace')
 const command =
 mp?.command ||
 (process.platform === 'win32'
 ? join(homedir(), '.local', 'bin', 'mempalace-mcp.exe')
 : join(homedir(), '.local', 'bin', 'mempalace-mcp'))
 const cmd =
 existsSync(command) || !command.includes(homedir())
 ? command
 : process.platform === 'win32'
 ? 'mempalace-mcp.exe'
 : 'mempalace-mcp'
 return {
 command: cmd,
 args: mp?.args?.length ? mp.args : ['--palace', palacePath]
 }
}

function mergeMcpServers(
 filePath: string,
 servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
 key: 'mcpServers' | 'servers' = 'mcpServers'
): string {
 const cur = readJsonFile(filePath)
 const existing =
 (cur[key] as Record<string, unknown> | undefined) &&
 typeof cur[key] === 'object' &&
 !Array.isArray(cur[key])
 ? { ...(cur[key] as Record<string, unknown>) }
 : {}
 for (const [id, cfg] of Object.entries(servers)) {
 existing[id] = cfg
 }
 writeJsonFile(filePath, { ...cur, [key]: existing })
 return filePath
}

const POINTER_MARK = 'truedeck-memory'

function ensureMarkdownPointer(projectRoot: string, fileName: string, forceCreate: boolean): string | null {
 const p = join(projectRoot, fileName)
 const block = [
 '',
 `<!-- ${POINTER_MARK} -->`,
 '## TrueDeck memory (automatic)',
 'At session start, read `.truedeck/auto-context.md` for project memory.',
 'Durable facts: write short notes under `.memory/context/` or `.memory/decisions/`.',
 'If MemPalace MCP tools are available, use them for search/recall - do not ask the user to manage memory.',
 'TrueDeck MCP hub (`truedeck-hub`): `truedeck_launch` opens a briefed agent in TrueDeck; `truedeck_start_pipeline` for multi-agent; `truedeck_list_agents` / `truedeck_list_roles` / `truedeck_list_tasks`; MCP config via `truedeck_list_mcp` / `truedeck_add_mcp` / `truedeck_apply_mcp`.',
 `<!-- /${POINTER_MARK} -->`,
 ''
 ].join('\n')

 try {
 if (existsSync(p)) {
 const cur = readFileSync(p, 'utf8')
 if (cur.includes(POINTER_MARK)) return p
 writeFileSync(p, cur.trimEnd() + '\n' + block, 'utf8')
 return p
 }
 if (forceCreate) {
 writeFileSync(p, `# Agent instructions\n${block}`, 'utf8')
 return p
 }
 } catch {
 // ignore
 }
 return null
}

/** Skip redundant injects within a few minutes for the same agent set+project+palace. */
const injectCooldown = new Map<string, number>()
const INJECT_TTL_MS = 10 * 60 * 1000

/** Default CLIs that get MCP + memory wiring (not shell). */
export const DEFAULT_SYNCED_AGENT_IDS = [
 'claude',
 'cursor',
 'codex',
 'grok',
 'gemini',
 'opencode',
 'aider'
] as const

export function resolveSyncedAgentIds(
 settings?: Partial<AppSettings> | null,
 agentIdHint?: string
): string[] {
 if (agentIdHint && agentIdHint !== 'all') {
 // Single-agent request still expands to full synced set when we want bulk
 // sync - callers use injectMemoryForSyncedAgents for that.
 return [agentIdHint]
 }
 const fromSettings = settings?.syncedAgentIds
 if (Array.isArray(fromSettings) && fromSettings.length > 0) {
 return [...new Set(fromSettings.map(String).filter((id) => id && id !== 'shell'))]
 }
 return [...DEFAULT_SYNCED_AGENT_IDS]
}

function writeCliMemoryNote(
 agentId: string,
 palace: string,
 projectRoot?: string
): string | null {
 const body = [
 '# TrueDeck memory (automatic)',
 '',
 'When running under TrueDeck:',
 '- Read project `.truedeck/auto-context.md` at session start.',
 `- MemPalace palace: \`${palace}\``,
 '- Durable notes: `.memory/` in the repo (TrueMemory).',
 '- MCP servers are injected by TrueDeck into this CLI (shared hub).',
 projectRoot ? `- Project: \`${projectRoot}\`` : '',
 '- Do not ask the user to manage memory, Graphify, or MCP wiring.',
 ''
 ]
 .filter(Boolean)
 .join('\n')

 try {
 if (agentId === 'codex') {
 const codexDir = join(homedir(), '.codex')
 mkdirSync(codexDir, { recursive: true })
 const note = join(codexDir, 'truedeck-memory.md')
 writeFileSync(note, body, 'utf8')
 return note
 }
 if (agentId === 'gemini') {
 const dir = join(homedir(), '.gemini')
 mkdirSync(dir, { recursive: true })
 const note = join(dir, 'truedeck-memory.md')
 writeFileSync(note, body, 'utf8')
 return note
 }
 if (agentId === 'grok') {
 const dir = join(homedir(), '.grok')
 mkdirSync(dir, { recursive: true })
 const note = join(dir, 'truedeck-memory.md')
 writeFileSync(note, body, 'utf8')
 return note
 }
 if (agentId === 'opencode' || agentId === 'aider') {
 const dir = join(homedir(), `.${agentId}`)
 mkdirSync(dir, { recursive: true })
 const note = join(dir, 'truedeck-memory.md')
 writeFileSync(note, body, 'utf8')
 return note
 }
 } catch {
 return null
 }
 return null
}

/**
 * Inject memory + unified MCP into every supported client config, and write
 * per-CLI notes for each id in `agentIds` (or default synced set).
 */
export async function injectMemoryForAgent(opts: {
 agentId: string
 projectRoot?: string
 palacePath?: string
 /** Force rewrite even if recently injected */
 force?: boolean
 /** Explicit list; when set, overrides agentId expansion */
 agentIds?: string[]
 settings?: Partial<AppSettings> | null
}): Promise<AgentMemoryInjectResult> {
 const palace = opts.palacePath || getConfiguredPalacePath(opts.settings)
 const agentIds =
 opts.agentIds && opts.agentIds.length
 ? [...new Set(opts.agentIds.filter((id) => id && id !== 'shell'))]
 : opts.agentId === 'all' || !opts.agentId
 ? resolveSyncedAgentIds(opts.settings)
 : resolveSyncedAgentIds(opts.settings, opts.agentId)

 // If single non-all request, still wire MCP for everyone (cheap merge) but
 // mark result as that agent; for 'all' or multi list use full set.
 const targets =
 opts.agentId === 'all' || (opts.agentIds && opts.agentIds.length > 1)
 ? agentIds
 : opts.agentIds?.length
 ? agentIds
 : opts.agentId && opts.agentId !== 'all'
 ? [opts.agentId]
 : agentIds

 const label = targets.length > 1 ? `all (${targets.join(', ')})` : targets[0] || 'all'
 const coolKey = `${targets.slice().sort().join(',')}|${opts.projectRoot || ''}|${palace}`
 const last = injectCooldown.get(coolKey) || 0
 if (!opts.force && Date.now() - last < INJECT_TTL_MS) {
 return {
 agentId: label,
 ok: true,
 filesWritten: [],
 message: `Memory already wired for ${label} (cached)`
 }
 }

 applyPalaceToProviders(palace)
 mkdirSync(palace, { recursive: true })

 const written: string[] = []

 // Always ensure file memory trees + markdown pointers
 ensureGlobalMemory()
 if (opts.projectRoot && existsSync(opts.projectRoot)) {
 ensureRepoMemory(opts.projectRoot)
 const agentsMd = ensureMarkdownPointer(opts.projectRoot, 'AGENTS.md', true)
 if (agentsMd) written.push(agentsMd)
 // CLAUDE.md for Claude / Cursor / bulk sync
 if (
 targets.includes('claude') ||
 targets.includes('cursor') ||
 targets.includes('codex') ||
 targets.length > 1
 ) {
 const claude = ensureMarkdownPointer(opts.projectRoot, 'CLAUDE.md', true)
 if (claude) written.push(claude)
 }
 }

 // Unified MCP → every client (Cursor, Claude, Grok, Codex, Gemini, project files)
 try {
 const hub = injectMcpToAllClients({ projectRoot: opts.projectRoot })
 written.push(...hub.filesWritten)
 } catch {
 try {
 const servers = buildUnifiedMcpMap()
 if (opts.projectRoot) {
 written.push(mergeMcpServers(join(opts.projectRoot, '.mcp.json'), servers))
 written.push(mergeMcpServers(join(opts.projectRoot, '.cursor', 'mcp.json'), servers))
 }
 written.push(mergeMcpServers(join(homedir(), '.cursor', 'mcp.json'), servers))
 } catch {
 // ignore
 }
 }

 // Per-CLI memory notes for each synced agent
 for (const id of targets) {
 const note = writeCliMemoryNote(id, palace, opts.projectRoot)
 if (note) written.push(note)
 }

 // TrueDeck-local record of last inject
 try {
 const rec = join(getGlobalDataDir(), 'last-memory-inject.json')
 writeJsonFile(rec, {
 agentId: label,
 agentIds: targets,
 palacePath: palace,
 projectRoot: opts.projectRoot || null,
 servers: Object.keys(buildUnifiedMcpMap()),
 written,
 at: Date.now()
 })
 written.push(rec)
 } catch {
 // ignore
 }

 injectCooldown.set(coolKey, Date.now())

 const unique = [...new Set(written)]
 const serverCount = Object.keys(buildUnifiedMcpMap()).length
 return {
 agentId: label,
 ok: unique.length > 0,
 filesWritten: unique,
 message:
 unique.length > 0
 ? `Memory + ${serverCount} MCP server(s) synced to ${targets.length} CLI(s): ${targets.join(', ')} (${unique.length} paths)`
 : `No config files written for ${label}`
 }
}

/** Sync every CLI in settings.syncedAgentIds (or all defaults). */
export async function injectMemoryForSyncedAgents(opts: {
 projectRoot?: string
 palacePath?: string
 force?: boolean
 settings?: Partial<AppSettings> | null
}): Promise<AgentMemoryInjectResult> {
 const ids = resolveSyncedAgentIds(opts.settings)
 return injectMemoryForAgent({
 agentId: 'all',
 agentIds: ids,
 projectRoot: opts.projectRoot,
 palacePath: opts.palacePath,
 force: opts.force,
 settings: opts.settings
 })
}

/** Discover existing memory spaces the user can pick during onboarding. */
export async function listMemorySpaces(): Promise<MemorySpaceInfo[]> {
 const spaces: MemorySpaceInfo[] = []
 const defaultP = defaultPalace()
 const status = await getMemPalaceStatus()

 spaces.push({
 id: 'palace-default',
 label: 'Default MemPalace',
 path: status.palacePath || defaultP,
 kind: 'palace',
 exists: existsSync(status.palacePath || defaultP),
 detail: status.ready ? 'Ready' : status.message
 })

 // Alternate palace folders under ~/.mempalace
 const memRoot = join(homedir(), '.mempalace')
 try {
 if (existsSync(memRoot)) {
 for (const name of readdirSync(memRoot)) {
 const full = join(memRoot, name)
 try {
 if (!statSync(full).isDirectory()) continue
 if (full === (status.palacePath || defaultP)) continue
 // Heuristic: palace-like if has chroma / collections / or any files
 spaces.push({
 id: `palace-${name}`,
 label: `MemPalace · ${name}`,
 path: full,
 kind: 'palace',
 exists: true,
 detail: 'Found under ~/.mempalace'
 })
 } catch {
 // skip
 }
 }
 }
 } catch {
 // ignore
 }

 const globalMem = getGlobalMemoryDir()
 spaces.push({
 id: 'global-files',
 label: 'TrueDeck global notes',
 path: globalMem,
 kind: 'global-memory',
 exists: existsSync(globalMem),
 detail: 'Markdown notes (always on)'
 })

 return spaces
}

export async function pickMemorySpaceFolder(): Promise<string | null> {
 const res = await dialog.showOpenDialog({
 title: 'Select existing memory space (palace folder)',
 properties: ['openDirectory', 'createDirectory']
 })
 if (res.canceled || !res.filePaths[0]) return null
 return res.filePaths[0]
}

export function describeSpacePath(path: string): MemorySpaceInfo {
 const name = basename(path)
 return {
 id: `custom-${path}`,
 label: name || path,
 path,
 kind: 'custom',
 exists: existsSync(path),
 detail: 'Custom path'
 }
}
