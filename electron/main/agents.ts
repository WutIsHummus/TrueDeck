import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { getAgentsConfigPath } from './paths'
import type { AgentPreset } from '../shared/types'

/**
 * Banner / chrome accents = each company's real brand color (dark-UI friendly).
 * Verified 2026-07:
 * - Claude #D97757 (Brandfetch / Claude peach accent)
 * - Codex/OpenAI #10A37F (ChatGPT product green)
 * - Cursor #F54E00 (Cursor design system accent / Ember)
 * - Gemini #4796E3 (Gemini product blue)
 * - Grok #F5F5F5 (xAI monochrome - light for dark UI)
 * - OpenCode #CFCECD (opencode.ai/brand monochrome - no chromatic brand)
 * - Shell #5391FE (PowerShell logo blue)
 * - Aider #0088FF (no public brand kit; matches default user-input blue)
 */
const DEFAULT_AGENTS: AgentPreset[] = [
 {
 id: 'grok',
 name: 'Grok',
 command: 'grok',
 args: [],
 // xAI brand is black/white; light mark so chrome is visible on dark UI
 color: '#f5f5f5',
 icon: '✦',
 description: 'xAI Grok CLI (coding agent)',
 installCommand: 'npm install -g @xai/grok'
 },
 {
 id: 'codex',
 name: 'Codex',
 command: 'codex',
 args: [],
 // OpenAI / ChatGPT signature green
 color: '#10a37f',
 icon: '◉',
 description: 'OpenAI Codex CLI',
 installCommand: 'npm install -g @openai/codex'
 },
 {
 id: 'cursor',
 name: 'Cursor Agent',
 // CLI only - never Cursor IDE
 command: 'cursor-agent',
 args: [],
 // Cursor design system accent (Ember / --color-accent)
 color: '#f54e00',
 icon: '◆',
 description: 'Cursor Agent CLI only - never launches Cursor IDE. Install cursor-agent separately.',
 installCommand:
 process.platform === 'win32'
 ? 'irm https://cursor.com/install?win=1 | iex'
 : 'curl https://cursor.com/install -fsS | bash'
 },
 {
 id: 'claude',
 name: 'Claude',
 command: 'claude',
 args: [],
 // Claude peach / terracotta brand accent
 color: '#d97757',
 icon: '◎',
 description: 'Anthropic Claude Code CLI',
 installCommand:
 process.platform === 'win32'
 ? 'irm https://claude.ai/install.ps1 | iex'
 : 'curl -fsSL https://claude.ai/install.sh | bash'
 },
 {
 id: 'gemini',
 name: 'Gemini',
 command: 'gemini',
 args: [],
 // Gemini product blue (distinct from Google Blue 500 #4285F4)
 color: '#4796e3',
 icon: '◇',
 description: 'Google Gemini CLI',
 installCommand: 'npm install -g @google/gemini-cli'
 },
 {
 id: 'shell',
 name: 'Shell',
 command: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
 args: process.platform === 'win32' ? ['-NoLogo'] : [],
 // PowerShell logo blue
 color: '#5391fe',
 icon: '▣',
 description: 'Plain shell in the project folder'
 },
 {
 id: 'opencode',
 name: 'OpenCode',
 command: 'opencode',
 args: [],
 // OpenCode brand is monochrome (opencode.ai/brand); warm light gray for dark UI
 color: '#cfcecd',
 icon: '△',
 description: 'OpenCode open-source agent CLI',
 installCommand: 'npm install -g opencode-ai'
 },
 {
 id: 'aider',
 name: 'Aider',
 command: 'aider',
 args: [],
 // No public brand kit; default terminal user-input blue
 color: '#0088ff',
 icon: '▹',
 description: 'Aider pair-programming CLI',
 installCommand: process.platform === 'win32' ? 'pip install aider-chat' : 'pip3 install aider-chat'
 }
]

/** Merge saved list with defaults so new options (e.g. Cursor) always appear. */
function mergeAgents(stored: AgentPreset[]): AgentPreset[] {
 const byId = new Map(stored.map((a) => [a.id, a]))
 const out: AgentPreset[] = []
 for (const d of DEFAULT_AGENTS) {
 const s = byId.get(d.id)
 if (s) {
 // Prefer defaults for command/install/color (brand chrome); keep custom name if set
 out.push({
 ...d,
 ...s,
 id: d.id,
 command: d.command,
 args: d.args,
 color: d.color,
 installCommand: d.installCommand || s.installCommand,
 description: d.description || s.description
 })
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
