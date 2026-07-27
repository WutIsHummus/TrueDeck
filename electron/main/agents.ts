import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { getAgentsConfigPath } from './paths'
import type { AgentPreset } from '../shared/types'

const DEFAULT_AGENTS: AgentPreset[] = [
  {
    id: 'grok',
    name: 'Grok',
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
    id: 'cursor',
    name: 'Cursor',
    // resolve-command.ts prefers cursor-agent.cmd, then cursor agent, then IDE
    command: process.platform === 'win32' ? 'cursor-agent' : 'cursor-agent',
    args: [],
    color: '#60a5fa',
    icon: '◆',
    description: 'Cursor Agent CLI (native). Opens in a TrueDeck tab.'
  },
  {
    id: 'claude',
    name: 'Claude',
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
    id: 'shell',
    name: 'Shell',
    command: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
    args: process.platform === 'win32' ? ['-NoLogo'] : [],
    color: '#6b7280',
    icon: '▣',
    description: 'Plain shell in the project folder'
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

/** Merge saved list with defaults so new options (e.g. Cursor) always appear. */
function mergeAgents(stored: AgentPreset[]): AgentPreset[] {
  const byId = new Map(stored.map((a) => [a.id, a]))
  const out: AgentPreset[] = []
  for (const d of DEFAULT_AGENTS) {
    const s = byId.get(d.id)
    if (s) {
      out.push({ ...d, ...s, id: d.id })
      byId.delete(d.id)
    } else {
      out.push({ ...d })
    }
  }
  for (const [, s] of byId) out.push(s)
  return out
}

export function loadAgents(): AgentPreset[] {
  const path = getAgentsConfigPath()
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as AgentPreset[]
      if (Array.isArray(raw) && raw.length > 0) {
        const merged = mergeAgents(raw)
        // Persist if Cursor (or other defaults) were missing
        if (merged.length !== raw.length || !raw.some((a) => a.id === 'cursor')) {
          saveAgents(merged)
        }
        return merged
      }
    }
  } catch {
    // fall through
  }
  saveAgents(DEFAULT_AGENTS)
  return DEFAULT_AGENTS.map((a) => ({ ...a }))
}

export function saveAgents(agents: AgentPreset[]): void {
  const path = getAgentsConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(agents, null, 2), 'utf8')
}

export function getDefaultAgents(): AgentPreset[] {
  return DEFAULT_AGENTS.map((a) => ({ ...a }))
}
