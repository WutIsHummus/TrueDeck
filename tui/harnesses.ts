/**
 * Harness = the CLI process. Model or named agent is chosen per run.
 */
import type { AgentPreset } from './agents'
import { canLaunch } from './resolve'

export interface ModelChoice {
  id: string
  label: string
  /** Pass --agent instead of --model. */
  asAgent?: boolean
}

export interface Harness {
  id: string
  name: string
  command: string
  args: string[]
  color: string
  modelFlag: string[]
  agentFlag?: string[]
  models: ModelChoice[]
}

export const HARNESSES: Harness[] = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    args: [],
    color: 'magenta',
    modelFlag: ['--model'],
    agentFlag: ['--agent'],
    models: [
      { id: 'default', label: 'Default model' },
      { id: 'opus', label: 'opus' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'haiku', label: 'haiku' },
      { id: 'agent', label: 'Named agent…', asAgent: true }
    ]
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    color: 'green',
    modelFlag: ['--model'],
    models: [
      { id: 'default', label: 'Default model' },
      { id: 'gpt-5.4', label: 'gpt-5.4' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' }
    ]
  },
  {
    id: 'grok',
    name: 'Grok',
    command: 'grok',
    args: [],
    color: 'cyan',
    modelFlag: ['--model'],
    agentFlag: ['--agent'],
    models: [
      { id: 'default', label: 'Default (grok-4.7)' },
      { id: 'grok-4.7', label: 'grok-4.7' },
      { id: 'grok-4.7-build-fast', label: 'grok-4.7-build-fast' },
      { id: 'grok-4.6', label: 'grok-4.6' },
      { id: 'grok-4.5', label: 'grok-4.5' },
      { id: 'agent', label: 'Named agent…', asAgent: true }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor-agent',
    args: ['--approve-mcps', '--trust'],
    color: 'blue',
    modelFlag: ['--model'],
    models: [
      { id: 'default', label: 'Default model' },
      { id: 'sonnet-4-thinking', label: 'sonnet-4-thinking' },
      { id: 'gpt-5', label: 'gpt-5' }
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini',
    args: [],
    color: 'yellow',
    modelFlag: ['--model'],
    models: [
      { id: 'default', label: 'Default model' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }
    ]
  },
  {
    id: 'kiro',
    name: 'Kiro',
    command: 'kiro-cli',
    args: [],
    color: 'magenta',
    modelFlag: ['--model'],
    models: [{ id: 'default', label: 'Default model' }]
  }
]

export function defaultModel(harness: Harness): ModelChoice {
  return harness.models.find((m) => m.id === 'default') || harness.models[0]
}

export function installedHarnesses(): Harness[] {
  return HARNESSES.filter((h) => canLaunch(h.id, h.command, h.args))
}

/** `claude, cursor: fix the login` names harnesses. Anything else is a normal task. */
export function harnessesNamedIn(
  text: string,
  harnesses: Harness[]
): { harnesses: Harness[]; task: string } | null {
  const colon = text.indexOf(':')
  if (colon <= 0 || colon > 80) return null
  const task = text.slice(colon + 1).trim()
  if (!task) return null
  const parts = text
    .slice(0, colon)
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return null
  const byName = new Map<string, Harness>()
  for (const harness of harnesses) {
    byName.set(harness.id.toLowerCase(), harness)
    byName.set(harness.name.toLowerCase(), harness)
  }
  const picked: Harness[] = []
  for (const part of parts) {
    const harness = byName.get(part.toLowerCase())
    if (!harness) return null
    if (!picked.some((item) => item.id === harness.id)) picked.push(harness)
  }
  return { harnesses: picked, task }
}

export function runLabel(harness: Harness, model: ModelChoice, namedAgent: string | null): string {
  if (namedAgent) return `${harness.name} · ${namedAgent}`
  if (!model.id || model.id === 'default') return harness.name
  return `${harness.name} · ${model.label}`
}

export function presetForRun(
  harness: Harness,
  model: ModelChoice,
  namedAgent: string | null,
  label: string
): AgentPreset {
  const args = [...harness.args]
  if (namedAgent && harness.agentFlag) {
    args.push(...harness.agentFlag, namedAgent)
  } else if (model.id && model.id !== 'default' && model.id !== 'agent') {
    args.push(...harness.modelFlag, model.id)
  }
  return {
    id: harness.id,
    name: label,
    command: harness.command,
    args,
    color: harness.color
  }
}
