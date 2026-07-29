/**
 * Agent roles / templates - BridgeSpace-style personas for board + pipelines.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getGlobalDataDir } from './paths'
import type { AgentRole } from '../shared/types'

function rolesPath(): string {
 return join(getGlobalDataDir(), 'roles.json')
}

export function defaultRoles(): AgentRole[] {
 return [
 {
 id: 'implementer',
 label: 'Implementer',
 agentId: 'claude',
 color: '#22c55e',
 prefixPrompt:
 'You are the implementer. Write working code for the task. Prefer small, reviewable diffs. Use TrueMemory (.memory/) for durable notes and MemPalace when available. If a Graphify report exists under graphify-out/, use it for architecture context.'
 },
 {
 id: 'reviewer',
 label: 'Reviewer',
 agentId: 'codex',
 color: '#3b82f6',
 prefixPrompt:
 'You are the reviewer. Critique correctness, tests, edge cases, and security. Do not rewrite large swaths unless asked. List blocking issues first, then nits.'
 },
 {
 id: 'tester',
 label: 'Tester',
 agentId: 'shell',
 color: '#f59e0b',
 prefixPrompt:
 'You are the tester. Run the project test suite / relevant commands and report pass/fail with logs. Fix only if explicitly asked.'
 },
 {
 id: 'docs',
 label: 'Docs',
 agentId: 'grok',
 color: '#a855f7',
 prefixPrompt:
 'You are the docs agent. Update or write clear markdown docs for what changed. Prefer docs/ and README; keep tone practical.'
 },
 {
 id: 'explorer',
 label: 'Explorer',
 agentId: 'claude',
 color: '#06b6d4',
 prefixPrompt:
 'You are the explorer/scout. Map the codebase, find entry points and risks. Prefer Graphify (graphify-out/) and read-only investigation before edits.'
 }
 ]
}

export function listRoles(): AgentRole[] {
 try {
 if (!existsSync(rolesPath())) {
 const d = defaultRoles()
 saveRoles(d)
 return d
 }
 const raw = JSON.parse(readFileSync(rolesPath(), 'utf8')) as AgentRole[]
 if (!Array.isArray(raw) || !raw.length) return defaultRoles()
 return raw.map((r) => ({
 id: String(r.id),
 label: String(r.label || r.id),
 agentId: String(r.agentId || 'shell'),
 color: String(r.color || '#6b7280'),
 prefixPrompt: String(r.prefixPrompt || '')
 }))
 } catch {
 return defaultRoles()
 }
}

export function getRole(id: string): AgentRole | undefined {
 return listRoles().find((r) => r.id === id)
}

export function saveRoles(roles: AgentRole[]): AgentRole[] {
 const path = rolesPath()
 mkdirSync(dirname(path), { recursive: true })
 const cleaned = roles.map((r) => ({
 id: r.id,
 label: r.label,
 agentId: r.agentId,
 color: r.color,
 prefixPrompt: r.prefixPrompt
 }))
 writeFileSync(path, JSON.stringify(cleaned, null, 2), 'utf8')
 return cleaned
}
