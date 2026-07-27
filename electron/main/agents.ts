import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { getAgentsConfigPath } from './paths'
import type { AgentPreset } from '../shared/types'

const DEFAULT_AGENTS: AgentPreset[] = [
  {
    id: 'shell',
    name: 'Shell',
    command: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
    args: process.platform === 'win32' ? ['-NoLogo'] : [],
    color: '#6b7280',
    icon: '▣',
    description: 'Plain shell in the project folder'
  },
  {
    id: 'grok',
    name: 'Grok Build',
    command: 'grok',
    args: [],
    color: '#22d3ee',
    icon: '✦',
    description: 'xAI Grok Build coding agent'
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    color: '#34d399',
    icon: '◉',
    description: 'OpenAI Codex CLI'
  },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    color: '#c084fc',
    icon: '◎',
    description: 'Anthropic Claude Code CLI'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini',
    args: [],
    color: '#fbbf24',
    icon: '◇',
    description: 'Google Gemini CLI'
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    // Prefer dedicated cursor-agent CLI; resolve-command.ts rewrites at spawn time.
    command: process.platform === 'win32' ? 'cursor-agent' : 'cursor-agent',
    args: [],
    color: '#60a5fa',
    icon: '◆',
    description:
      'Cursor Agent CLI (cursor-agent). Auto-resolves to cursor agent or Cursor.exe if needed.'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    color: '#f472b6',
    icon: '△',
    description: 'OpenCode open-source agent'
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    args: [],
    color: '#fb923c',
    icon: '▹',
    description: 'Aider pair-programming agent'
  }
]

export function loadAgents(): AgentPreset[] {
  const path = getAgentsConfigPath()
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as AgentPreset[]
      if (Array.isArray(raw) && raw.length > 0) return raw
    }
  } catch {
    // fall through
  }
  saveAgents(DEFAULT_AGENTS)
  return DEFAULT_AGENTS
}

export function saveAgents(agents: AgentPreset[]): void {
  const path = getAgentsConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(agents, null, 2), 'utf8')
}

export function getDefaultAgents(): AgentPreset[] {
  return DEFAULT_AGENTS.map((a) => ({ ...a }))
}
