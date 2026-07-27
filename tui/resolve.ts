import { existsSync } from 'fs'
import { join } from 'path'
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

export function resolveCommand(
  agentId: string,
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (agentId === 'cursor') {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const agent = firstExisting([
      join(local, 'cursor-agent', 'cursor-agent.cmd'),
      which('cursor-agent') || ''
    ])
    if (agent) return { command: agent, args: [] }
    const cursor = firstExisting([
      join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      which('cursor.cmd') || '',
      which('cursor') || ''
    ])
    if (cursor) return { command: cursor, args: args.length ? args : ['agent'] }
  }

  if (existsSync(command)) return { command, args }
  const fromPath = which(command)
  if (fromPath) return { command: fromPath, args }

  if (process.platform === 'win32') {
    const hit = firstExisting([
      join(homedir(), '.grok', 'bin', `${command}.exe`),
      join(homedir(), '.local', 'bin', `${command}.exe`),
      join('C:\\nvm4w\\nodejs', `${command}.cmd`),
      join(process.env.APPDATA || '', 'npm', `${command}.cmd`)
    ])
    if (hit) return { command: hit, args }
  }

  return { command, args }
}
