import { existsSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'

function which(cmd: string): string | null {
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
 return (
 out.find((p) => p.toLowerCase().endsWith('.cmd')) ||
 out.find((p) => p.toLowerCase().endsWith('.exe')) ||
 out[0] ||
 null
 )
 }
 return execFileSync('which', [cmd], {
 encoding: 'utf8',
 stdio: ['ignore', 'pipe', 'ignore']
 }).trim()
 } catch {
 return null
 }
}

function firstExisting(paths: string[]): string | null {
 for (const p of paths) if (p && existsSync(p)) return p
 return null
}

/** Never launch Cursor IDE / VS Code GUI. */
function isIdeBinary(path: string): boolean {
 const lower = path.toLowerCase().replace(/\\/g, '/')
 const base = basename(lower)
 if (base === 'cursor.exe' || base === 'code.exe' || base === 'code') return true
 if (lower.includes('/program files/cursor/') && !lower.includes('cursor-agent')) return true
 if (lower.includes('/programs/cursor/') && base.startsWith('cursor')) return true
 if (lower.includes('/cursor/resources/app/bin/') && !lower.includes('cursor-agent')) return true
 if (lower.endsWith('/cursor.cmd') && !lower.includes('cursor-agent')) return true
 if (lower.endsWith('/cursor') && !lower.includes('cursor-agent')) return true
 return false
}

/** Resolve Cursor Agent only: node.exe + index.js. Never Cursor.exe / cursor.cmd IDE shim. */
function resolveCursorAgent(): { command: string; args: string[] } {
 const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
 const root = join(local, 'cursor-agent')
 const versionsDir = join(root, 'versions')

 const tryDir = (dir: string): { command: string; args: string[] } | null => {
 const node = join(dir, 'node.exe')
 const indexJs = join(dir, 'index.js')
 if (existsSync(node) && existsSync(indexJs)) {
 return { command: node, args: [indexJs] }
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
 const hit = tryDir(d.full)
 if (hit) return hit
 }
 } catch {
 // fall through
 }
 }

 const rootHit = tryDir(root)
 if (rootHit) return rootHit

 const onPath = which('cursor-agent')
 if (onPath && !isIdeBinary(onPath) && basename(onPath).toLowerCase().includes('cursor-agent')) {
 const dir = dirname(onPath)
 const via = tryDir(dir)
 if (via) return via
 return { command: onPath, args: [] }
 }

 // Missing CLI - do NOT fall back to IDE `cursor`
 return { command: 'cursor-agent', args: [] }
}

export function resolveCommand(
 agentId: string,
 command: string,
 args: string[]
): { command: string; args: string[] } {
 if (agentId === 'cursor' || command.toLowerCase() === 'cursor') {
 return resolveCursorAgent()
 }

 if (isIdeBinary(command)) {
 return { command: 'cursor-agent', args: [] }
 }

 if (existsSync(command) && !isIdeBinary(command)) return { command, args }
 const fromPath = which(command)
 if (fromPath && !isIdeBinary(fromPath)) return { command: fromPath, args }

 if (process.platform === 'win32') {
 const hit = firstExisting([
 join(homedir(), '.grok', 'bin', `${command}.exe`),
 join(homedir(), '.local', 'bin', `${command}.exe`),
 join('C:\\nvm4w\\nodejs', `${command}.cmd`),
 join(process.env.APPDATA || '', 'npm', `${command}.cmd`)
 ])
 if (hit && !isIdeBinary(hit)) return { command: hit, args }
 }

 return { command, args }
}
