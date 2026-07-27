import { existsSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { homedir } from 'os'

export interface ResolvedCommand {
  command: string
  args: string[]
  resolvedFrom?: string
}

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
      // Prefer .cmd/.exe over extensionless shims
      const preferred =
        out.find((p) => p.toLowerCase().endsWith('.cmd')) ||
        out.find((p) => p.toLowerCase().endsWith('.exe')) ||
        out[0]
      return preferred || null
    }
    const out = execFileSync('which', [cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p
  }
  return null
}

/** Resolve Cursor agent to a real executable that works in a PTY. */
export function resolveCursorAgent(originalArgs: string[]): ResolvedCommand {
  const localApp = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'

  // 1) Dedicated cursor-agent CLI (best)
  const agentCli = firstExisting([
    join(localApp, 'cursor-agent', 'cursor-agent.cmd'),
    join(localApp, 'cursor-agent', 'cursor-agent.exe'),
    which('cursor-agent') || ''
  ])
  if (agentCli) {
    return {
      command: agentCli,
      args: [],
      resolvedFrom: 'cursor-agent'
    }
  }

  // 2) cursor agent subcommand via official bin
  const cursorBin = firstExisting([
    join(localApp, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
    join(programFiles, 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
    which('cursor.cmd') || '',
    which('cursor') || ''
  ])
  if (cursorBin) {
    const args = originalArgs.length > 0 ? originalArgs : ['agent']
    return {
      command: cursorBin,
      args,
      resolvedFrom: 'cursor agent'
    }
  }

  // 3) Fall back to opening Cursor IDE on the folder (user still gets something)
  const cursorExe = firstExisting([
    join(localApp, 'Programs', 'cursor', 'Cursor.exe'),
    join(programFiles, 'cursor', 'Cursor.exe')
  ])
  if (cursorExe) {
    return {
      command: cursorExe,
      args: ['.'],
      resolvedFrom: 'Cursor.exe (IDE fallback)'
    }
  }

  return {
    command: process.platform === 'win32' ? 'cursor.cmd' : 'cursor',
    args: originalArgs.length ? originalArgs : ['agent'],
    resolvedFrom: 'unresolved'
  }
}

/** Generic PATH + known-location resolution for agent presets. */
export function resolveAgentCommand(
  agentId: string,
  command: string,
  args: string[]
): ResolvedCommand {
  if (agentId === 'cursor') {
    return resolveCursorAgent(args)
  }

  // Absolute path already
  if (existsSync(command)) {
    return { command, args, resolvedFrom: 'absolute' }
  }

  const fromPath = which(command)
  if (fromPath) {
    return { command: fromPath, args, resolvedFrom: 'PATH' }
  }

  // Common Windows locations for node-based CLIs (nvm, npm global)
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.APPDATA || '', 'npm', `${command}.cmd`),
      join(process.env.LOCALAPPDATA || '', 'nvm', 'nodejs', `${command}.cmd`),
      join('C:\\nvm4w\\nodejs', `${command}.cmd`),
      join(homedir(), '.grok', 'bin', `${command}.exe`),
      join(homedir(), '.local', 'bin', command)
    ]
    const hit = firstExisting(candidates)
    if (hit) {
      return { command: hit, args, resolvedFrom: 'known-path' }
    }
  } else {
    const candidates = [
      join(homedir(), '.grok', 'bin', command),
      join(homedir(), '.local', 'bin', command),
      join('/usr/local/bin', command)
    ]
    const hit = firstExisting(candidates)
    if (hit) {
      return { command: hit, args, resolvedFrom: 'known-path' }
    }
  }

  return { command, args, resolvedFrom: 'as-configured' }
}
