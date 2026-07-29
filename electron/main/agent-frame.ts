/**
 * TrueDeck agent-frame TUI - wrap CLIs in a consistent in-terminal chrome.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { getSettingsPath } from './paths'
import type { AgentPreset } from '../shared/types'

function readFrameSettings(): { agentFrameTui: boolean; frameShellPanes: boolean } {
 try {
 const p = getSettingsPath()
 // In-band frame is opt-in: full-screen agents (Grok) always leaked into the header.
 if (!existsSync(p)) return { agentFrameTui: false, frameShellPanes: false }
 const s = JSON.parse(readFileSync(p, 'utf8')) as {
 agentFrameTui?: boolean
 frameShellPanes?: boolean
 }
 return {
 agentFrameTui: s.agentFrameTui === true,
 frameShellPanes: s.frameShellPanes === true
 }
 } catch {
 return { agentFrameTui: false, frameShellPanes: false }
 }
}

function wantFrame(_agentId: string): boolean {
 // Agent chrome / in-PTY frame removed - always raw CLI spawn.
 void _agentId
 void readFrameSettings
 return false
}

export function resolveAgentFrameScript(): string | null {
 const rel = join('agent-frame', 'truedeck-frame.mjs')
 const candidates: string[] = []
 try {
 if (app.isPackaged) candidates.push(join(process.resourcesPath, rel))
 } catch {
 /* ignore */
 }
 try {
 candidates.push(join(app.getAppPath(), 'resources', rel))
 } catch {
 /* ignore */
 }
 candidates.push(join(process.cwd(), 'resources', rel))
 candidates.push(join(__dirname, '../../resources', rel))
 candidates.push(join(__dirname, '../../../resources', rel))
 for (const p of candidates) {
 if (p && existsSync(p)) return p
 }
 return null
}

export function findNodeExecutable(): string {
 try {
 if (process.platform === 'win32') {
 const out = execFileSync('where.exe', ['node'], {
 encoding: 'utf8',
 windowsHide: true,
 stdio: ['ignore', 'pipe', 'ignore']
 })
 .split(/\r?\n/)
 .map((l) => l.trim())
 .filter(Boolean)
 const hit = out.find((p) => p.toLowerCase().endsWith('node.exe')) || out[0]
 if (hit && existsSync(hit)) return hit
 } else {
 const out = execFileSync('which', ['node'], {
 encoding: 'utf8',
 stdio: ['ignore', 'pipe', 'ignore']
 }).trim()
 if (out) return out
 }
 } catch {
 /* ignore */
 }
 if (process.platform === 'win32' && existsSync('C:\\nvm4w\\nodejs\\node.exe')) {
 return 'C:\\nvm4w\\nodejs\\node.exe'
 }
 return process.platform === 'win32' ? 'node.exe' : 'node'
}

/**
 * In-PTY agent frame is disabled permanently.
 * Nested ConPTY (node → frame.mjs → agent) left many CLIs blank on Windows.
 * Spawn the agent CLI directly.
 */
export function maybeWrapAgentFrame(_opts: {
 agent: AgentPreset
 command: string
 args: string[]
 projectRoot: string
}): { command: string; args: string[]; envExtra: Record<string, string> } | null {
 void _opts
 void wantFrame
 void resolveAgentFrameScript
 void findNodeExecutable
 return null
}
