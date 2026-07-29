import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { getGlobalDataDir } from './paths'
import { getMemPalaceStatus, ensureMemPalace } from './mempalace'
import type {
 MemoryProviderConfig,
 MemoryProviderStatus,
 AppSettings
} from '../shared/types'

const PROVIDERS_FILE = (): string => join(getGlobalDataDir(), 'memory-providers.json')

function localBin(name: string): string {
 return join(homedir(), '.local', 'bin', name)
}

function defaultMemPalaceCommand(): string {
 const exe =
 process.platform === 'win32'
 ? localBin('mempalace-mcp.exe')
 : localBin('mempalace-mcp')
 if (existsSync(exe)) return exe
 return process.platform === 'win32' ? 'mempalace-mcp.exe' : 'mempalace-mcp'
}

function defaultPalacePath(): string {
 return join(homedir(), '.mempalace', 'palace')
}

/** Factory defaults - MemPalace is native / no Docker. */
export function defaultMemoryProviders(): MemoryProviderConfig[] {
 return [
 {
 id: 'truememory',
 kind: 'truememory',
 name: 'TrueMemory (files)',
 enabled: true,
 description:
 'Markdown notes in each repo (.memory/) plus global app-data memory. Always available, no service.',
 preferNative: true,
 noDocker: true
 },
 {
 id: 'mempalace',
 kind: 'mempalace',
 name: 'MemPalace',
 enabled: true,
 description:
 'Graph/vector “mem space” via native mempalace-mcp. No Docker required.',
 command: defaultMemPalaceCommand(),
 args: ['--palace', defaultPalacePath()],
 dataPath: defaultPalacePath(),
 preferNative: true,
 noDocker: true
 },
 {
 id: 'openmemory',
 kind: 'openmemory',
 name: 'OpenMemory (Mem0)',
 enabled: false,
 description:
 'Optional Mem0 OpenMemory MCP. Enable and set command after you install it.',
 // Placeholder - user fills in after install (npx / docker / binary)
 command: 'npx',
 args: ['-y', 'openmemory', 'mcp'],
 preferNative: true,
 noDocker: true
 }
 ]
}

export function loadMemoryProviders(): MemoryProviderConfig[] {
 try {
 const path = PROVIDERS_FILE()
 if (existsSync(path)) {
 const raw = JSON.parse(readFileSync(path, 'utf8')) as MemoryProviderConfig[]
 if (Array.isArray(raw) && raw.length > 0) {
 return mergeWithDefaults(raw)
 }
 }
 } catch {
 // fall through
 }
 const defaults = defaultMemoryProviders()
 saveMemoryProviders(defaults)
 return defaults
}

/** Keep user toggles; ensure built-in kinds exist. */
function mergeWithDefaults(stored: MemoryProviderConfig[]): MemoryProviderConfig[] {
 const defaults = defaultMemoryProviders()
 const byId = new Map(stored.map((p) => [p.id, p]))
 const merged: MemoryProviderConfig[] = []

 for (const d of defaults) {
 const s = byId.get(d.id)
 if (s) {
 merged.push({
 ...d,
 ...s,
 // Force no-docker policy for mempalace unless user explicitly set docker command
 noDocker: s.noDocker !== false,
 preferNative: s.preferNative !== false
 })
 byId.delete(d.id)
 } else {
 merged.push(d)
 }
 }
 // user custom providers
 for (const [, s] of byId) {
 if (s.kind === 'custom-mcp' || !defaults.find((d) => d.id === s.id)) {
 merged.push(s)
 }
 }
 return merged
}

export function saveMemoryProviders(providers: MemoryProviderConfig[]): void {
 const path = PROVIDERS_FILE()
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(providers, null, 2), 'utf8')
}

export function upsertMemoryProvider(provider: MemoryProviderConfig): MemoryProviderConfig[] {
 const list = loadMemoryProviders()
 const idx = list.findIndex((p) => p.id === provider.id)
 if (idx >= 0) list[idx] = provider
 else list.push(provider)
 saveMemoryProviders(list)
 return list
}

export function removeMemoryProvider(id: string): MemoryProviderConfig[] {
 const list = loadMemoryProviders().filter((p) => p.id !== id || p.kind === 'truememory')
 // never remove TrueMemory
 if (!list.find((p) => p.id === 'truememory')) {
 list.unshift(defaultMemoryProviders()[0])
 }
 saveMemoryProviders(list)
 return list
}

export function setProviderEnabled(id: string, enabled: boolean): MemoryProviderConfig[] {
 const list = loadMemoryProviders().map((p) =>
 p.id === id ? { ...p, enabled: p.kind === 'truememory' ? true : enabled } : p
 )
 saveMemoryProviders(list)
 return list
}

async function statusForProvider(p: MemoryProviderConfig): Promise<MemoryProviderStatus> {
 if (!p.enabled) {
 return {
 id: p.id,
 kind: p.kind,
 name: p.name,
 enabled: false,
 ready: false,
 mode: 'disabled',
 message: 'Disabled - enable in Memory backends to use with agents.'
 }
 }

 if (p.kind === 'truememory') {
 return {
 id: p.id,
 kind: p.kind,
 name: p.name,
 enabled: true,
 ready: true,
 mode: 'files',
 message: 'Markdown files in .memory/ (repo) + global app data. Always on.'
 }
 }

 if (p.kind === 'mempalace') {
 // Respect noDocker - only native path
 const st = await getMemPalaceStatus()
 const cmd = p.command || st.mcpPath || defaultMemPalaceCommand()
 const args = p.args?.length
 ? p.args
 : ['--palace', p.dataPath || st.palacePath || defaultPalacePath()]
 return {
 id: p.id,
 kind: p.kind,
 name: p.name,
 enabled: true,
 ready: st.ready,
 mode: st.mode === 'native' ? 'native' : st.mode === 'missing' ? 'missing' : 'native',
 message: st.message + (p.noDocker !== false ? ' (Docker disabled by policy)' : ''),
 version: st.version,
 mcp: st.ready
 ? { command: cmd, args }
 : undefined
 }
 }

 // openmemory / custom-mcp - check command exists if absolute path
 const cmd = p.command || ''
 const looksAbsolute = cmd.includes('\\') || cmd.includes('/') || cmd.endsWith('.exe')
 const cmdExists = looksAbsolute ? existsSync(cmd) : true // PATH commands assumed present
 const ready = Boolean(cmd) && cmdExists

 return {
 id: p.id,
 kind: p.kind,
 name: p.name,
 enabled: true,
 ready,
 mode: ready ? 'mcp' : 'missing',
 message: ready
 ? `MCP: ${cmd} ${(p.args || []).join(' ')}`.trim()
 : cmd
 ? `Command not found: ${cmd}. Install the tool or edit the path.`
 : 'Set a command for this provider.',
 mcp: ready && cmd ? { command: cmd, args: p.args || [] } : undefined
 }
}

export async function listProviderStatuses(): Promise<MemoryProviderStatus[]> {
 const providers = loadMemoryProviders()
 return Promise.all(providers.map((p) => statusForProvider(p)))
}

export async function ensureEnabledProviders(projectRoot?: string): Promise<MemoryProviderStatus[]> {
 const providers = loadMemoryProviders().filter((p) => p.enabled)
 for (const p of providers) {
 if (p.kind === 'mempalace') {
 await ensureMemPalace({
 projectRoot,
 wing: projectRoot?.split(/[/\\]/).filter(Boolean).pop()
 })
 }
 }
 return listProviderStatuses()
}

/** Generate MCP server entries for enabled non-file providers (Cursor/Grok). */
export function buildMcpServerMap(
 providers?: MemoryProviderConfig[]
): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
 const list = providers || loadMemoryProviders()
 const out: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {}
 for (const p of list) {
 if (!p.enabled) continue
 if (p.kind === 'truememory') continue
 if (!p.command) continue
 // Never emit docker run for mempalace when noDocker
 if (p.kind === 'mempalace' && p.noDocker !== false) {
 const cmd = p.command.includes('docker') ? defaultMemPalaceCommand() : p.command
 if (cmd.includes('docker')) continue
 out[p.id] = {
 command: cmd,
 args: p.args?.length ? p.args : ['--palace', p.dataPath || defaultPalacePath()],
 ...(p.env ? { env: p.env } : {})
 }
 continue
 }
 if (p.command === 'docker' || p.command.endsWith('docker.exe')) {
 // user explicitly chose docker for a custom/openmemory provider - allow
 if (p.noDocker) continue
 }
 out[p.id] = {
 command: p.command,
 args: p.args || [],
 ...(p.env ? { env: p.env } : {})
 }
 }
 return out
}

export function providersFromSettings(settings: AppSettings): MemoryProviderConfig[] {
 if (settings.memoryProviders?.length) {
 saveMemoryProviders(mergeWithDefaults(settings.memoryProviders))
 return loadMemoryProviders()
 }
 return loadMemoryProviders()
}

export function addCustomMcpProvider(opts: {
 name: string
 command: string
 args?: string[]
 env?: Record<string, string>
}): MemoryProviderConfig[] {
 const id = `custom-${Date.now().toString(36)}`
 return upsertMemoryProvider({
 id,
 kind: 'custom-mcp',
 name: opts.name || 'Custom MCP memory',
 enabled: true,
 description: 'User-defined MCP memory server',
 command: opts.command,
 args: opts.args || [],
 env: opts.env,
 preferNative: true,
 noDocker: true
 })
}
