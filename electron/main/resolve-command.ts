import { existsSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import { execFileSync } from 'child_process'
import { homedir } from 'os'

export interface ResolvedCommand {
 command: string
 args: string[]
 resolvedFrom?: string
 /** False when the CLI binary is not on disk / PATH */
 available: boolean
 /** How to install this CLI (shown in UI / shell helper) */
 installCommand?: string
}

/** Cache PATH lookups - `where.exe` on every spawn is a real Windows cost. */
const whichCache = new Map<string, string | null>()
const resolveCache = new Map<string, ResolvedCommand>()
const RESOLVE_TTL_MS = 5 * 60 * 1000
const resolveAt = new Map<string, number>()

/** Known install one-liners (Windows-first; Unix variants where noted). */
export const CLI_INSTALL: Record<string, string> = {
 cursor:
 process.platform === 'win32'
 ? 'irm https://cursor.com/install?win=1 | iex'
 : 'curl https://cursor.com/install -fsS | bash',
 claude:
 process.platform === 'win32'
 ? 'irm https://claude.ai/install.ps1 | iex'
 : 'curl -fsSL https://claude.ai/install.sh | bash',
 codex: 'npm install -g @openai/codex',
 grok: 'npm install -g @xai/grok',
 gemini: 'npm install -g @google/gemini-cli',
 opencode: 'npm install -g opencode-ai',
 aider: process.platform === 'win32' ? 'pip install aider-chat' : 'pip3 install aider-chat',
 // https://kiro.dev/docs/cli
 kiro: 'curl -fsSL https://cli.kiro.dev/install | bash'
}

function which(cmd: string): string | null {
 if (whichCache.has(cmd)) return whichCache.get(cmd) ?? null
 try {
 if (process.platform === 'win32') {
 const out = execFileSync('where.exe', [cmd], {
 encoding: 'utf8',
 windowsHide: true,
 stdio: ['ignore', 'pipe', 'ignore']
 })
 .split(/\r?\n/)
 .map((l) => l.trim())
 .filter(Boolean)
 const preferred =
 out.find((p) => p.toLowerCase().endsWith('.cmd')) ||
 out.find((p) => p.toLowerCase().endsWith('.exe')) ||
 out[0]
 whichCache.set(cmd, preferred || null)
 return preferred || null
 }
 const out = execFileSync('which', [cmd], {
 encoding: 'utf8',
 stdio: ['ignore', 'pipe', 'ignore']
 }).trim()
 whichCache.set(cmd, out || null)
 return out || null
 } catch {
 whichCache.set(cmd, null)
 return null
 }
}

export function clearResolveCache(): void {
 whichCache.clear()
 resolveCache.clear()
 resolveAt.clear()
}

function firstExisting(paths: string[]): string | null {
 for (const p of paths) {
 if (p && existsSync(p)) return p
 }
 return null
}

/**
 * Anything that opens a GUI IDE - never allowed as a TrueDeck agent.
 * Note: `cursor.cmd` under Program Files\cursor launches Cursor.exe (IDE).
 */
function isIdeBinary(path: string): boolean {
 const lower = path.toLowerCase().replace(/\\/g, '/')
 const base = basename(lower)
 if (base === 'cursor.exe' || base === 'code.exe' || base === 'code') return true
 // Windows install: C:\Program Files\cursor\...
 if (lower.includes('/program files/cursor/') && !lower.includes('cursor-agent')) return true
 if (lower.includes('/program files (x86)/cursor/') && !lower.includes('cursor-agent')) return true
 if (lower.includes('/programs/cursor/') && base.startsWith('cursor')) return true
 if (lower.includes('/cursor/resources/app/bin/cursor')) return true
 // `cursor.cmd` in IDE install tree is NOT the agent CLI
 if (lower.includes('/cursor/resources/app/bin/') && !lower.includes('cursor-agent')) return true
 if (lower.endsWith('/cursor.cmd') && !lower.includes('cursor-agent')) return true
 if (lower.endsWith('/cursor') && !lower.includes('cursor-agent')) return true
 return false
}

function isCursorAgentPath(path: string): boolean {
 const lower = path.toLowerCase().replace(/\\/g, '/')
 return lower.includes('cursor-agent') && !isIdeBinary(path)
}

/**
 * Resolve Cursor Agent as: node.exe + index.js (no PowerShell wrapper, no IDE).
 * Opening Cursor.exe is unsupported.
 */
export function resolveCursorAgent(): ResolvedCommand {
 const localApp = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
 const install = CLI_INSTALL.cursor
 const root = join(localApp, 'cursor-agent')
 const versionsDir = join(root, 'versions')

 const tryVersionDir = (versionPath: string, label: string): ResolvedCommand | null => {
 const node = join(versionPath, 'node.exe')
 const indexJs = join(versionPath, 'index.js')
 if (existsSync(node) && existsSync(indexJs)) {
 return {
 command: node,
 args: [indexJs],
 resolvedFrom: label,
 available: true,
 installCommand: install
 }
 }
 return null
 }

 if (existsSync(versionsDir)) {
 try {
 const dirs = readdirSync(versionsDir)
 .map((name) => ({ name, full: join(versionsDir, name) }))
 .filter((d) => {
 try {
 return statSync(d.full).isDirectory()
 } catch {
 return false
 }
 })
 .sort((a, b) => {
 try {
 return statSync(b.full).mtimeMs - statSync(a.full).mtimeMs
 } catch {
 return 0
 }
 })
 for (const d of dirs) {
 const hit = tryVersionDir(d.full, `cursor-agent@${d.name}`)
 if (hit) return hit
 }
 } catch {
 // fall through
 }
 }

 // Root install with node+index next to scripts
 const rootHit = tryVersionDir(root, 'cursor-agent-root')
 if (rootHit) return rootHit

 // PATH: only accept if path clearly is cursor-agent (not IDE `cursor`)
 const onPath = which('cursor-agent')
 if (onPath && isCursorAgentPath(onPath)) {
 // Prefer resolving .cmd → version node if possible
 const dir = dirname(onPath)
 const viaRoot = tryVersionDir(dir, 'cursor-agent-path-dir')
 if (viaRoot) return viaRoot
 // As last resort run the .cmd only if name is cursor-agent*
 if (basename(onPath).toLowerCase().startsWith('cursor-agent')) {
 return {
 command: onPath,
 args: [],
 resolvedFrom: 'PATH-cursor-agent',
 available: true,
 installCommand: install
 }
 }
 }

 return {
 command: 'cursor-agent',
 args: [],
 resolvedFrom: 'missing',
 available: false,
 installCommand: install
 }
}

/** Generic PATH + known-location resolution for agent presets. */
export function resolveAgentCommand(
 agentId: string,
 command: string,
 args: string[]
): ResolvedCommand {
 const cacheKey = `${agentId}\0${command}\0${args.join('\0')}`
 const cachedAt = resolveAt.get(cacheKey) || 0
 if (Date.now() - cachedAt < RESOLVE_TTL_MS) {
 const hit = resolveCache.get(cacheKey)
 if (hit) return hit
 }

 const resolved = resolveAgentCommandUncached(agentId, command, args)
 resolveCache.set(cacheKey, resolved)
 resolveAt.set(cacheKey, Date.now())
 return resolved
}

function resolveAgentCommandUncached(
 agentId: string,
 command: string,
 args: string[]
): ResolvedCommand {
 const installCommand = CLI_INSTALL[agentId]

 if (agentId === 'cursor') {
 return resolveCursorAgent()
 }

 // Built-in shell is always available
 if (agentId === 'shell') {
 if (process.platform === 'win32') {
 return {
 command: 'powershell.exe',
 args: args.length ? args : ['-NoLogo'],
 resolvedFrom: 'shell',
 available: true
 }
 }
 const sh = process.env.SHELL || '/bin/bash'
 return {
 command: existsSync(sh) ? sh : '/bin/bash',
 args,
 resolvedFrom: 'shell',
 available: true
 }
 }

 // Reject IDE names even if configured
 if (isIdeBinary(command) || command.toLowerCase() === 'cursor') {
 return {
 command,
 args,
 resolvedFrom: 'blocked-ide',
 available: false,
 installCommand
 }
 }

 // Absolute path already
 if (existsSync(command) && !isIdeBinary(command)) {
 return { command, args, resolvedFrom: 'absolute', available: true, installCommand }
 }

 const fromPath = which(command)
 if (fromPath && !isIdeBinary(fromPath)) {
 return { command: fromPath, args, resolvedFrom: 'PATH', available: true, installCommand }
 }

 // Common Windows locations for node-based CLIs (nvm, npm global)
 if (process.platform === 'win32') {
 const candidates = [
 join(process.env.APPDATA || '', 'npm', `${command}.cmd`),
 join(process.env.LOCALAPPDATA || '', 'nvm', 'nodejs', `${command}.cmd`),
 join('C:\\nvm4w\\nodejs', `${command}.cmd`),
 join(homedir(), '.grok', 'bin', `${command}.exe`),
 join(homedir(), '.local', 'bin', `${command}.exe`),
 join(homedir(), '.local', 'bin', command),
 // Kiro CLI install locations
 join(homedir(), '.kiro', 'bin', `${command}.exe`),
 join(homedir(), '.kiro', 'bin', command),
 join(process.env.LOCALAPPDATA || '', 'kiro', 'bin', `${command}.exe`),
 join(process.env.LOCALAPPDATA || '', 'kiro-cli', `${command}.exe`)
 ]
 const hit = firstExisting(candidates)
 if (hit && !isIdeBinary(hit)) {
 return { command: hit, args, resolvedFrom: 'known-path', available: true, installCommand }
 }
 } else {
 const candidates = [
 join(homedir(), '.grok', 'bin', command),
 join(homedir(), '.local', 'bin', command),
 join('/usr/local/bin', command)
 ]
 const hit = firstExisting(candidates)
 if (hit && !isIdeBinary(hit)) {
 return { command: hit, args, resolvedFrom: 'known-path', available: true, installCommand }
 }
 }

 return {
 command,
 args,
 resolvedFrom: 'missing',
 available: false,
 installCommand
 }
}

/** Probe all agents for CLI availability (for palette UI). Does not execute agents. */
export function probeAgents(
 agents: { id: string; command: string; args?: string[] }[]
): Array<{
 id: string
 available: boolean
 resolvedCommand?: string
 resolvedFrom?: string
 installCommand?: string
}> {
 // Don't clear entire cache every open - only refresh probe results
 return agents.map((a) => {
 // Force fresh resolve for probe accuracy without thrashing where.exe for every open
 const cacheKey = `${a.id}\0${a.command}\0${(a.args || []).join('\0')}`
 resolveCache.delete(cacheKey)
 const r = resolveAgentCommand(a.id, a.command, a.args || [])
 return {
 id: a.id,
 available: r.available,
 resolvedCommand: r.available ? `${r.command}${r.args.length ? ' ' + r.args.map((x) => basename(x)).join(' ') : ''}` : undefined,
 resolvedFrom: r.resolvedFrom,
 installCommand: r.installCommand || CLI_INSTALL[a.id]
 }
 })
}
