/**
 * Unified MCP hub - configure once in TrueDeck, inject into every agent client.
 *
 * Writes the same stdio MCP set to:
 * Cursor · Claude Code · Grok · Codex · project .mcp.json · TrueDeck export
 */
import {
 existsSync,
 mkdirSync,
 readFileSync,
 writeFileSync,
 appendFileSync
} from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { getGlobalDataDir } from './paths'
import { buildMcpServerMap, loadMemoryProviders } from './memory-providers'
import { getConfiguredPalacePath } from './agent-inject'

export interface McpStdioConfig {
 command: string
 args: string[]
 env?: Record<string, string>
}

export interface McpServerEntry {
 id: string
 name: string
 enabled: boolean
 /** user = managed here · memory = from memory backends · builtin = shipped defaults */
 source: 'user' | 'memory' | 'builtin'
 command: string
 args: string[]
 env?: Record<string, string>
 description?: string
}

export interface McpInjectResult {
 ok: boolean
 serverCount: number
 filesWritten: string[]
 message: string
}

const STORE = (): string => join(getGlobalDataDir(), 'mcp-servers.json')

function readJson(path: string): Record<string, unknown> {
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

function writeJson(path: string, data: unknown): void {
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function slugId(name: string): string {
 const base = name
 .toLowerCase()
 .replace(/[^a-z0-9]+/g, '-')
 .replace(/^-|-$/g, '')
 .slice(0, 40)
 return base || `mcp-${Date.now().toString(36)}`
}

/** User-managed MCP servers only (file store). */
export function loadUserMcpServers(): McpServerEntry[] {
 try {
 const path = STORE()
 if (!existsSync(path)) return []
 const raw = JSON.parse(readFileSync(path, 'utf8')) as McpServerEntry[]
 if (!Array.isArray(raw)) return []
 return raw
 .filter((s) => s && s.id && s.command)
 .map((s) => ({
 id: String(s.id),
 name: String(s.name || s.id),
 enabled: s.enabled !== false,
 source: 'user' as const,
 command: String(s.command),
 args: Array.isArray(s.args) ? s.args.map(String) : [],
 env: s.env && typeof s.env === 'object' ? s.env : undefined,
 description: s.description ? String(s.description) : undefined
 }))
 } catch {
 return []
 }
}

export function saveUserMcpServers(list: McpServerEntry[]): McpServerEntry[] {
 const cleaned = list
 .filter((s) => s.source === 'user' || !s.source)
 .map((s) => ({
 id: s.id,
 name: s.name,
 enabled: s.enabled !== false,
 source: 'user' as const,
 command: s.command,
 args: s.args || [],
 ...(s.env ? { env: s.env } : {}),
 ...(s.description ? { description: s.description } : {})
 }))
 writeJson(STORE(), cleaned)
 return cleaned
}

export function upsertUserMcpServer(
 entry: Omit<McpServerEntry, 'source'> & { source?: 'user' }
): McpServerEntry[] {
 const list = loadUserMcpServers()
 const id = entry.id || slugId(entry.name)
 const next: McpServerEntry = {
 id,
 name: entry.name || id,
 enabled: entry.enabled !== false,
 source: 'user',
 command: entry.command,
 args: entry.args || [],
 env: entry.env,
 description: entry.description
 }
 const idx = list.findIndex((s) => s.id === id)
 if (idx >= 0) list[idx] = next
 else list.push(next)
 return saveUserMcpServers(list)
}

export function removeUserMcpServer(id: string): McpServerEntry[] {
 return saveUserMcpServers(loadUserMcpServers().filter((s) => s.id !== id))
}

export function setUserMcpEnabled(id: string, enabled: boolean): McpServerEntry[] {
 return saveUserMcpServers(
 loadUserMcpServers().map((s) => (s.id === id ? { ...s, enabled } : s))
 )
}

/**
 * Full list for the UI: memory-backed MCPs + user MCPs.
 * Memory ones are read-only here (toggle them under Memory backends).
 */
export function listAllMcpEntries(): McpServerEntry[] {
 const out: McpServerEntry[] = []
 const hub = truedeckHubMcpEntry()
 if (hub) {
 out.push({
 id: 'truedeck-hub',
 name: 'TrueDeck MCP Hub',
 enabled: true,
 source: 'builtin',
 command: hub.command,
 args: hub.args || [],
 description:
 'Built-in tools for agents: list/add/remove MCP servers and sync to all CLIs'
 })
 }
 const memMap = buildMcpServerMap()
 const providers = loadMemoryProviders()
 for (const [id, cfg] of Object.entries(memMap)) {
 const p = providers.find((x) => x.id === id)
 out.push({
 id,
 name: p?.name || id,
 enabled: true,
 source: 'memory',
 command: cfg.command,
 args: cfg.args || [],
 env: cfg.env,
 description: p?.description || 'From memory backends'
 })
 }
 for (const u of loadUserMcpServers()) {
 // User entries override same id for display (but map merge prefers user enabled)
 const existing = out.findIndex((x) => x.id === u.id)
 if (existing >= 0) out[existing] = u
 else out.push(u)
 }
 return out
}

/** Absolute path to the TrueDeck hub MCP server script (agents use this tool). */
export function resolveTruedeckHubScript(): string | null {
 const candidates: string[] = []
 try {
 if (app.isPackaged) {
 candidates.push(join(process.resourcesPath, 'mcp-server', 'truedeck-mcp.mjs'))
 }
 } catch {
 /* ignore */
 }
 try {
 candidates.push(join(app.getAppPath(), 'resources', 'mcp-server', 'truedeck-mcp.mjs'))
 } catch {
 /* ignore */
 }
 candidates.push(join(process.cwd(), 'resources', 'mcp-server', 'truedeck-mcp.mjs'))
 candidates.push(join(__dirname, '../../resources/mcp-server/truedeck-mcp.mjs'))
 candidates.push(join(__dirname, '../../../resources/mcp-server/truedeck-mcp.mjs'))
 for (const p of candidates) {
 if (p && existsSync(p)) return p
 }
 return null
}

function findNodeExecutable(): string {
 try {
 if (process.platform === 'win32') {
 const out = execFileSync('where.exe', ['node'], {
 encoding: 'utf8',
 windowsHide: true,
 stdio: ['ignore', 'pipe', 'ignore']
 })
 .split(/\r?\n/)
 .map((l) => l.trim())
 .filter(Boolean)
 const hit =
 out.find((p) => p.toLowerCase().endsWith('node.exe')) || out[0]
 if (hit && existsSync(hit)) return hit
 } else {
 const out = execFileSync('which', ['node'], {
 encoding: 'utf8',
 stdio: ['ignore', 'pipe', 'ignore']
 }).trim()
 if (out && existsSync(out)) return out
 }
 } catch {
 /* ignore */
 }
 // Fallbacks
 if (process.platform === 'win32') {
 const nvm = join('C:\\nvm4w\\nodejs', 'node.exe')
 if (existsSync(nvm)) return nvm
 }
 return process.platform === 'win32' ? 'node.exe' : 'node'
}

/** Built-in MCP so agents can edit TrueDeck's hub and re-sync all CLIs. */
export function truedeckHubMcpEntry(): McpStdioConfig | null {
 const script = resolveTruedeckHubScript()
 if (!script) return null
 return {
 command: findNodeExecutable(),
 args: [script]
 }
}

/**
 * Single stdio MCP map for every client.
 * User servers override memory providers on the same id when both enabled.
 * Always includes `truedeck-hub` (tools to edit this map from any agent).
 */
export function buildUnifiedMcpMap(): Record<string, McpStdioConfig> {
 const out: Record<string, McpStdioConfig> = { ...buildMcpServerMap() }
 for (const s of loadUserMcpServers()) {
 if (!s.enabled || !s.command) continue
 if (isDockerCommand(s.command)) continue
 out[s.id] = {
 command: s.command,
 args: s.args || [],
 ...(s.env ? { env: s.env } : {})
 }
 }
 const hub = truedeckHubMcpEntry()
 if (hub) {
 out['truedeck-hub'] = hub
 }
 return out
}

function isDockerCommand(cmd: unknown): boolean {
 if (typeof cmd !== 'string') return false
 const c = cmd.toLowerCase().replace(/\\/g, '/')
 return (
 c === 'docker' ||
 c.endsWith('/docker') ||
 c.endsWith('/docker.exe') ||
 c.endsWith('\\docker.exe') ||
 c.includes('docker.exe')
 )
}

/**
 * Strip Docker-based memory MCP entries (they launch Docker Desktop on every
 * agent start). TrueDeck uses native mempalace-mcp only.
 */
function stripDockerMemoryServers(
 existing: Record<string, unknown>
): { map: Record<string, unknown>; removed: string[] } {
 const removed: string[] = []
 const map: Record<string, unknown> = {}
 for (const [id, cfg] of Object.entries(existing)) {
 const entry = cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : null
 const cmd = entry?.command
 const idLow = id.toLowerCase()
 const isMemoryId =
 idLow === 'mempalace' ||
 idLow === 'truedeck' ||
 idLow === 'openmemory' ||
 idLow.includes('mempalace')
 if (isDockerCommand(cmd) && isMemoryId) {
 removed.push(id)
 continue
 }
 // Also drop bare "docker run mempalace" under any id
 if (isDockerCommand(cmd) && Array.isArray(entry?.args)) {
 const args = (entry!.args as unknown[]).map(String).join(' ').toLowerCase()
 if (args.includes('mempalace')) {
 removed.push(id)
 continue
 }
 }
 map[id] = cfg
 }
 return { map, removed }
}

function mergeMcpJson(
 filePath: string,
 servers: Record<string, McpStdioConfig>,
 key: 'mcpServers' | 'servers' = 'mcpServers'
): string {
 const cur = readJson(filePath)
 const rawExisting =
 cur[key] && typeof cur[key] === 'object' && !Array.isArray(cur[key])
 ? { ...(cur[key] as Record<string, unknown>) }
 : {}
 const { map: existing, removed } = stripDockerMemoryServers(rawExisting)
 if (removed.length) {
 console.log(`[mcp-hub] stripped docker MCP from ${filePath}: ${removed.join(', ')}`)
 }
 // Replace TrueDeck-managed keys; keep unknown third-party servers
 for (const [id, cfg] of Object.entries(servers)) {
 // Never write docker for our servers
 if (isDockerCommand(cfg.command)) continue
 existing[id] = {
 command: cfg.command,
 args: cfg.args || [],
 ...(cfg.env ? { env: cfg.env } : {})
 }
 }
 writeJson(filePath, { ...cur, [key]: existing })
 return filePath
}

function toGrokToml(servers: Record<string, McpStdioConfig>): string {
 const lines = [
 '# Generated by TrueDeck - unified MCP for all clients',
 '# Do not hand-edit if you use TrueDeck Settings → MCP',
 ''
 ]
 for (const [id, cfg] of Object.entries(servers)) {
 const cmd = cfg.command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
 const args = (cfg.args || [])
 .map((a) => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
 .join(', ')
 lines.push(`[mcp_servers.${id}]`)
 lines.push(`command = "${cmd}"`)
 lines.push(`args = [${args}]`)
 lines.push('enabled = true')
 lines.push('startup_timeout_sec = 60')
 if (cfg.env && Object.keys(cfg.env).length) {
 lines.push(`[mcp_servers.${id}.env]`)
 for (const [k, v] of Object.entries(cfg.env)) {
 lines.push(`${k} = "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
 }
 }
 lines.push('')
 }
 return lines.join('\n')
}

/**
 * Inject the unified MCP map into every supported client.
 * Safe to call often - merges without wiping other MCP servers.
 */
export function injectMcpToAllClients(opts?: {
 projectRoot?: string
}): McpInjectResult {
 const servers = buildUnifiedMcpMap()
 const n = Object.keys(servers).length
 const written: string[] = []
 const home = homedir()

 // ── Project-local (Claude Code / Cursor / generic) ──
 if (opts?.projectRoot && existsSync(opts.projectRoot)) {
 try {
 written.push(mergeMcpJson(join(opts.projectRoot, '.mcp.json'), servers))
 } catch {
 /* ignore */
 }
 try {
 written.push(mergeMcpJson(join(opts.projectRoot, '.cursor', 'mcp.json'), servers))
 } catch {
 /* ignore */
 }
 // VS Code / Copilot style project mcp
 try {
 written.push(
 mergeMcpJson(join(opts.projectRoot, '.vscode', 'mcp.json'), servers, 'servers')
 )
 } catch {
 /* ignore */
 }
 }

 // ── Cursor user ──
 try {
 written.push(mergeMcpJson(join(home, '.cursor', 'mcp.json'), servers))
 } catch {
 /* ignore */
 }

 // ── Claude Code user ──
 try {
 const claudeJson = join(home, '.claude.json')
 // Surgical patch only (file is huge / may have quirks) - still strip docker
 const cur = readJson(claudeJson)
 const raw =
 cur.mcpServers && typeof cur.mcpServers === 'object'
 ? { ...(cur.mcpServers as Record<string, unknown>) }
 : {}
 const { map: mcpServers, removed } = stripDockerMemoryServers(raw)
 if (removed.length) {
 console.log(`[mcp-hub] stripped docker from ~/.claude.json: ${removed.join(', ')}`)
 }
 for (const [id, cfg] of Object.entries(servers)) {
 if (isDockerCommand(cfg.command)) continue
 mcpServers[id] = {
 command: cfg.command,
 args: cfg.args || [],
 ...(cfg.env ? { env: cfg.env } : {})
 }
 }
 writeJson(claudeJson, { ...cur, mcpServers })
 written.push(claudeJson)
 } catch (e) {
 console.warn('[mcp-hub] claude.json inject failed', e)
 }
 try {
 written.push(mergeMcpJson(join(home, '.claude', 'mcp.json'), servers))
 } catch {
 /* ignore */
 }

 // ── Grok Build ──
 try {
 const grokDir = join(home, '.grok')
 mkdirSync(grokDir, { recursive: true })
 const tomlPath = join(grokDir, 'truedeck-mcp.toml')
 writeFileSync(tomlPath, toGrokToml(servers), 'utf8')
 written.push(tomlPath)
 // Also JSON for clients that prefer it
 written.push(mergeMcpJson(join(grokDir, 'mcp.json'), servers))
 } catch {
 /* ignore */
 }

 // ── Codex (config note + optional mcp in config.toml if present) ──
 try {
 const codexDir = join(home, '.codex')
 mkdirSync(codexDir, { recursive: true })
 const note = join(codexDir, 'truedeck-mcp.md')
 writeFileSync(
 note,
 [
 '# TrueDeck unified MCP',
 '',
 'Managed by TrueDeck Settings → MCP. Same servers as Cursor / Claude / Grok.',
 '',
 '```json',
 JSON.stringify({ mcpServers: servers }, null, 2),
 '```',
 '',
 `Palace: ${getConfiguredPalacePath()}`,
 ''
 ].join('\n'),
 'utf8'
 )
 written.push(note)

 // If user has config.toml, append a TrueDeck block (idempotent marker)
 const configToml = join(codexDir, 'config.toml')
 const block = [
 '',
 '# BEGIN TRUEDECK-MCP',
 '# MCP servers are injected via TrueDeck; use Cursor/Claude JSON configs when possible.',
 `# ${n} server(s) active in TrueDeck hub`,
 '# END TRUEDECK-MCP',
 ''
 ].join('\n')
 if (existsSync(configToml)) {
 let cur = readFileSync(configToml, 'utf8')
 if (cur.includes('# BEGIN TRUEDECK-MCP')) {
 cur = cur.replace(
 /# BEGIN TRUEDECK-MCP[\s\S]*?# END TRUEDECK-MCP\n?/,
 block.trim() + '\n'
 )
 writeFileSync(configToml, cur, 'utf8')
 } else {
 appendFileSync(configToml, block, 'utf8')
 }
 written.push(configToml)
 }
 } catch {
 /* ignore */
 }

 // ── Gemini CLI (if config dir exists) ──
 try {
 const geminiDir = join(home, '.gemini')
 if (existsSync(geminiDir) || true) {
 mkdirSync(geminiDir, { recursive: true })
 written.push(mergeMcpJson(join(geminiDir, 'mcp.json'), servers))
 }
 } catch {
 /* ignore */
 }

 // ── TrueDeck copy ──
 try {
 const hub = join(getGlobalDataDir(), 'unified-mcp.json')
 writeJson(hub, {
 version: 1,
 generatedAt: Date.now(),
 mcpServers: servers
 })
 written.push(hub)
 } catch {
 /* ignore */
 }

 const unique = [...new Set(written)]
 return {
 ok: unique.length > 0,
 serverCount: n,
 filesWritten: unique,
 message:
 n === 0
 ? 'No MCP servers enabled - add some in Settings → MCP'
 : `Unified MCP: ${n} server(s) → ${unique.length} client config(s)`
 }
}

export function exportUnifiedMcpSnippets(): {
 cursor: string
 claude: string
 grokToml: string
 serverCount: number
} {
 const map = buildUnifiedMcpMap()
 return {
 cursor: JSON.stringify({ mcpServers: map }, null, 2),
 claude: JSON.stringify({ mcpServers: map }, null, 2),
 grokToml: toGrokToml(map),
 serverCount: Object.keys(map).length
 }
}

/**
 * On app launch: force native memory MCP into all clients and remove any
 * leftover `docker run mempalace` entries that start Docker Desktop.
 */
export function purgeDockerMemoryMcpOnStartup(projectRoot?: string): McpInjectResult {
 console.log('[mcp-hub] purging docker memory MCP entries (native only)')
 return injectMcpToAllClients({ projectRoot })
}
