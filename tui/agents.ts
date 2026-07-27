import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

export interface AgentPreset {
  id: string
  name: string
  command: string
  args: string[]
  color: string
  key?: string
}

function configPath(): string {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.config'))
  return join(base, 'truedeck', 'data', 'agents.json')
}

export function defaultAgents(): AgentPreset[] {
  return [
    {
      id: 'shell',
      name: 'Shell',
      command: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
      args: process.platform === 'win32' ? ['-NoLogo'] : [],
      color: 'gray',
      key: 's'
    },
    {
      id: 'grok',
      name: 'Grok',
      command: 'grok',
      args: [],
      color: 'cyan',
      key: 'g'
    },
    {
      id: 'codex',
      name: 'Codex',
      command: 'codex',
      args: [],
      color: 'green',
      key: 'x'
    },
    {
      id: 'claude',
      name: 'Claude',
      command: 'claude',
      args: [],
      color: 'magenta',
      key: 'c'
    },
    {
      id: 'cursor',
      name: 'Cursor',
      command: process.platform === 'win32' ? 'cursor-agent' : 'cursor-agent',
      args: [],
      color: 'blue',
      key: 'u'
    },
    {
      id: 'gemini',
      name: 'Gemini',
      command: 'gemini',
      args: [],
      color: 'yellow',
      key: 'e'
    }
  ]
}

export function loadAgents(): AgentPreset[] {
  try {
    const p = configPath()
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as AgentPreset[]
      if (Array.isArray(raw) && raw.length) return raw
    }
  } catch {
    // ignore
  }
  const d = defaultAgents()
  try {
    const p = configPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(d, null, 2))
  } catch {
    // ignore
  }
  return d
}
