import { useState } from 'react'
import type { ProjectConfig } from '../../electron/shared/types'
import { AgentIcon } from './AgentIcon'

interface Props {
 open: boolean
 projects: ProjectConfig[]
 hasActiveProject: boolean
 activeProjectRoot?: string | null
 preferredAgentId?: string | null
 onAddProject: () => Promise<void>
 onOpenProject: (p: ProjectConfig) => Promise<void>
 onLaunchAgent: (id: string) => Promise<void>
 onSetPreferredAgent: (id: string) => Promise<void>
 /** Kept for App wiring; default palace path is applied by inject. */
 onSetPalacePath?: (path: string) => Promise<void>
 onInjectMemory: (
 agentId: string,
 projectRoot?: string,
 palacePath?: string,
 agentIds?: string[]
 ) => Promise<string>
 onSetSyncedAgents?: (ids: string[]) => Promise<void>
 onComplete: (skipped?: boolean) => void
 shortPath: (p: string) => string
}

const AGENTS = [
 { id: 'claude', label: 'Claude' },
 { id: 'grok', label: 'Grok' },
 { id: 'cursor', label: 'Cursor' },
 { id: 'codex', label: 'Codex' },
 { id: 'gemini', label: 'Gemini' },
 { id: 'shell', label: 'Shell' }
] as const

/**
 * Minimal first-run: pick a default agent, optionally open a project, go.
 * No multi-step wizard, memory path, or setup log.
 */
export function Onboarding({
 open,
 projects,
 hasActiveProject,
 activeProjectRoot,
 preferredAgentId,
 onAddProject,
 onOpenProject,
 onLaunchAgent,
 onSetPreferredAgent,
 onInjectMemory,
 onSetSyncedAgents,
 onComplete,
 shortPath
}: Props): JSX.Element | null {
 const [agentId, setAgentId] = useState(preferredAgentId || 'claude')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState<string | null>(null)

 if (!open) return null

 const start = async (): Promise<void> => {
 setBusy(true)
 setError(null)
 try {
 await onSetPreferredAgent(agentId)
 const syncIds =
 agentId === 'shell'
 ? []
 : AGENTS.filter((a) => a.id !== 'shell').map((a) => a.id)
 if (onSetSyncedAgents) await onSetSyncedAgents(syncIds)

 // Wire memory quietly - defaults are fine; settings cover the rest
 try {
 await onInjectMemory(
 agentId === 'shell' ? 'all' : agentId,
 activeProjectRoot || undefined,
 undefined,
 syncIds.length ? syncIds : undefined
 )
 } catch {
 // Non-fatal - user can still use the app
 }

 if (hasActiveProject && agentId !== 'shell') {
 await onLaunchAgent(agentId)
 }

 onComplete(false)
 } catch (e) {
 setError(e instanceof Error ? e.message : String(e))
 setBusy(false)
 }
 }

 return (
 <div className="onboard-backdrop">
 <div className="onboard" role="dialog" aria-label="Welcome to TrueDeck">
 <header className="onboard-header">
 <span className="onboard-logo">TRUEDECK</span>
 <button
 type="button"
 className="onboard-skip"
 disabled={busy}
 onClick={() => onComplete(true)}
 >
 Skip
 </button>
 </header>

 <div className="onboard-body">
 <p className="onboard-tagline">Multi-agent terminal deck</p>

 <div className="onboard-section">
 <div className="onboard-label">Memory and clients (automatic)</div>
 <ul className="onboard-facts">
 <li>
 <strong>Memory.</strong> Project notes live in <code>.memory/</code>.
 Context is written for you when you open a project and when an agent
 starts. No badges to manage.
 </li>
 <li>
 <strong>MCP hub.</strong> One server list syncs to Cursor, Claude Code,
 Grok, Codex, and Gemini so tools match across CLIs.
 </li>
 <li>
 <strong>Inject on start.</strong> Agents get project paths and memory
 pointers via env and config files. You just pick a CLI and work.
 </li>
 </ul>
 </div>

 <div className="onboard-section">
 <div className="onboard-label">Default agent</div>
 <div className="onboard-chips">
 {AGENTS.map((a) => (
 <button
 key={a.id}
 type="button"
 className={`onboard-chip ${agentId === a.id ? 'selected' : ''}`}
 disabled={busy}
 onClick={() => setAgentId(a.id)}
 >
 <AgentIcon agentId={a.id} size={12} />
 {a.label}
 </button>
 ))}
 </div>
 </div>

 <div className="onboard-section">
 <div className="onboard-label">Project</div>
 {hasActiveProject && activeProjectRoot ? (
 <p className="onboard-project-ok" title={activeProjectRoot}>
 {shortPath(activeProjectRoot)}
 </p>
 ) : (
 <>
 {projects.length > 0 && (
 <div className="onboard-recent">
 {projects.slice(0, 4).map((p) => (
 <button
 key={p.id}
 type="button"
 className="onboard-recent-item"
 disabled={busy}
 onClick={() => {
 void (async () => {
 setBusy(true)
 try {
 await onOpenProject(p)
 } finally {
 setBusy(false)
 }
 })()
 }}
 >
 <span className="name">{p.name}</span>
 <span className="path">{shortPath(p.root)}</span>
 </button>
 ))}
 </div>
 )}
 <button
 type="button"
 className="onboard-secondary"
 disabled={busy}
 onClick={() => {
 void (async () => {
 setBusy(true)
 try {
 await onAddProject()
 } finally {
 setBusy(false)
 }
 })()
 }}
 >
 Open folder…
 </button>
 </>
 )}
 </div>

 {error && <p className="onboard-error">{error}</p>}

 <button
 type="button"
 className="onboard-primary"
 disabled={busy}
 onClick={() => void start()}
 >
 {busy ? 'Starting…' : hasActiveProject ? 'Start' : 'Start without project'}
 </button>

 <p className="onboard-hints">
 <kbd>Ctrl+T</kbd> new agent · <kbd>Ctrl+O</kbd> project · <kbd>Ctrl+W</kbd> close
 </p>
 </div>

 <div className="onboard-rule" aria-hidden />
 </div>
 </div>
 )
}
