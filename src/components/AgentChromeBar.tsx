import { useEffect, useState } from 'react'
import type { SessionInfo, TaskStatus } from '../../electron/shared/types'
import {
 isAgentNameVariant,
 isNoiseTerminalTitle,
 looksLikeSecret
} from '../lib/session-label'
import { AgentIcon } from './AgentIcon'
import { CloseIcon } from './CloseIcon'
import { PixelBlast } from './PixelBlast'

interface Props {
 session: SessionInfo
 /** True when this pane owns keyboard focus (stronger chrome + PixelBlast). */
 focused?: boolean
 /**
 * Show agent icon + name. False when the tab strip already names the agent
 * (multi-tab panes) so we don't say "Grok" twice.
 */
 showAgentName?: boolean
 /** New agent in this pane (shown when tab bar is hidden). */
 onNew?: () => void
 showCloseGroup?: boolean
 onCloseGroup?: () => void
}

function shortPath(p: string, max = 40): string {
 let s = p.replace(/\\/g, '/')
 if (s.length <= max) return s
 return '…' + s.slice(-(max - 1))
}

function basename(p: string): string {
 const n = p.replace(/\\/g, '/').split('/').filter(Boolean)
 return n[n.length - 1] || p
}

function formatElapsed(ms: number): string {
 const s = Math.max(0, Math.floor(ms / 1000))
 if (s < 60) return `${s}s`
 const m = Math.floor(s / 60)
 const r = s % 60
 if (m < 60) return `${m}m${r.toString().padStart(2, '0')}s`
 const h = Math.floor(m / 60)
 return `${h}h${(m % 60).toString().padStart(2, '0')}m`
}

function statusLabel(st?: TaskStatus | string | null): string {
 if (!st) return ''
 return String(st)
}

function sameLabel(a: string, b: string): boolean {
 return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Compact terminal header above xterm - the preferred identity bar
 * (agent · project · branch). One row by default; second row only for a real task.
 */
export function AgentChromeBar({
 session,
 focused = false,
 showAgentName = true,
 onNew,
 showCloseGroup,
 onCloseGroup
}: Props): JSX.Element {
 const [now, setNow] = useState(() => Date.now())
 const [branch, setBranch] = useState<string | null>(session.gitBranch || null)
 const [linkedTask, setLinkedTask] = useState<{
 id: string
 title: string
 status: string
 } | null>(null)

 useEffect(() => {
 const t = window.setInterval(() => setNow(Date.now()), 1000)
 return () => window.clearInterval(t)
 }, [session.id])

 useEffect(() => {
 let cancelled = false
 const root = session.projectRoot
 if (!root) {
 setBranch(null)
 return
 }
 if (session.gitBranch) {
 setBranch(session.gitBranch)
 return
 }
 // Keep showing the last branch while re-fetching so "master" does not blink off
 void window.truedeck
 .getGitBranch(root)
 .then((b) => {
 if (!cancelled && b) setBranch(b)
 })
 .catch(() => {
 /* keep previous branch on transient git errors */
 })
 return () => {
 cancelled = true
 }
 }, [session.id, session.projectRoot, session.gitBranch])

 useEffect(() => {
 let cancelled = false
 const root = session.projectRoot
 if (!root) {
 setLinkedTask(null)
 return
 }

 if (session.taskId && session.focusTitle) {
 setLinkedTask({
 id: session.taskId,
 title: session.focusTitle,
 status: session.taskStatus || 'running'
 })
 }

 const refresh = (): void => {
 void window.truedeck
 .listTasks(root)
 .then((tasks) => {
 if (cancelled) return
 const byId = session.taskId
 ? tasks.find((t) => t.id === session.taskId)
 : undefined
 const bySession = tasks.find((t) => t.sessionId === session.id)
 const t = byId || bySession
 if (t) {
 setLinkedTask({
 id: t.id,
 title: t.title,
 status: t.status
 })
 } else if (!session.taskId && !session.focusTitle) {
 setLinkedTask(null)
 }
 })
 .catch(() => {
 /* ignore */
 })
 }

 refresh()
 const iv = window.setInterval(refresh, 4000)
 return () => {
 cancelled = true
 window.clearInterval(iv)
 }
 }, [
 session.id,
 session.projectRoot,
 session.taskId,
 session.focusTitle,
 session.taskStatus
 ])

 const live = session.status === 'running'
 const agentName = (session.agentName || session.agentId || 'Agent').trim()
 const proj = basename(session.projectRoot || '')
 const root = session.projectRoot || ''
 const accent = session.color || '#22d3ee'
 const elapsed = formatElapsed(now - (session.createdAt || now))
 const agentId = session.agentId || 'shell'
 const role = (session.roleLabel || '').trim()
 const wt = (session.worktreeLabel || '').trim()

 // Second chrome row is ONLY for real deck tasks / focus ideas.
 // Never use OSC CLI titles (session.title) - Codex thrash on boot causes
 // 2-line -> 1-line layout jump and icon+name flicker.
 const linked = (linkedTask?.title || '').trim()
 const focusIdea = (session.focusIdea || '').trim()
 const boardFocus =
 session.taskId || linkedTask?.id
 ? (session.focusTitle || linked || '').trim()
 : ''
 const taskStatus = (linkedTask?.status || session.taskStatus || '') as string

 const isJunkLabel = (t: string): boolean =>
 !t ||
 isNoiseTerminalTitle(t) ||
 looksLikeSecret(t) ||
 isAgentNameVariant(t, agentName, agentId) ||
 sameLabel(t, proj) ||
 sameLabel(t, `${agentName} · ${proj}`)

 const taskTitle = (linked || boardFocus || '').trim()
 const taskIsNoise = isJunkLabel(taskTitle)
 const ideaOk = focusIdea && !isJunkLabel(focusIdea) ? focusIdea : ''

 const showIdeaRow = Boolean(taskTitle && !taskIsNoise) || Boolean(ideaOk)
 const ideaPrimary = taskTitle && !taskIsNoise ? taskTitle : ideaOk
 const ideaSecondary =
 taskTitle && !taskIsNoise && ideaOk && !sameLabel(ideaOk, taskTitle) ? ideaOk : ''

 const pathTip = root ? shortPath(root, 64) : ''

 return (
 <div
 className={`agent-chrome ${focused ? 'focused hot' : ''}${showIdeaRow ? '' : ' compact'}`}
 style={{ ['--agent-accent' as string]: accent }}
 >
 {focused && (
 <PixelBlast
 className="agent-chrome-blast"
 color={accent}
 opacity={0.55}
 active={focused}
 />
 )}

 <div className="agent-chrome-row agent-chrome-main">
 {showAgentName && (
 <span className="agent-chrome-agent" style={{ color: accent }}>
 <AgentIcon agentId={agentId} size={14} color={accent} title={session.agentName} />
 <span className="agent-chrome-agent-name">{agentName}</span>
 </span>
 )}

 {!live && (
 <span className="agent-chrome-status exit" title="Exited">
 exit
 </span>
 )}

 {taskStatus && !taskIsNoise && (
 <span className={`agent-chrome-task-badge st-${taskStatus}`} title="Deck task status">
 {statusLabel(taskStatus)}
 </span>
 )}
 {role && (
 <span className="agent-chrome-role" title="Role">
 {role}
 </span>
 )}

 {proj && (
 <>
 {showAgentName && <span className="agent-chrome-sep" aria-hidden />}
 <span className="agent-chrome-proj" title={pathTip || undefined}>
 {proj}
 </span>
 </>
 )}

 {branch && (
 <>
 <span className="agent-chrome-dot">·</span>
 <span className="agent-chrome-branch" title="Git branch">
 <svg
 className="agent-chrome-git-icon"
 width="10"
 height="10"
 viewBox="0 0 16 16"
 aria-hidden
 >
 <path
 fill="currentColor"
 d="M10.5 2a1.5 1.5 0 0 1 1.45 1.12l.03.13.02.15v1.1a3.5 3.5 0 0 1-2.5 3.35V9.5a2 2 0 0 1-1.6 1.96l-.2.03H7.7v1.26A1.5 1.5 0 1 1 6 12.5l.01-.12.02-.13V11.5H5.7a3.5 3.5 0 0 1-3.48-3.15L2.2 8.2V5.4A1.5 1.5 0 1 1 3.7 5.25l.02.13.01.12v2.7a2 2 0 0 0 1.7 1.97l.18.02H7.5V8.85A3.5 3.5 0 0 1 5 5.5V4.4A1.5 1.5 0 1 1 6.5 4.25l.02.13.01.12v1A2 2 0 0 0 8.3 7.4l.2.03h.42A2 2 0 0 0 10.7 5.5V4.4A1.5 1.5 0 0 1 10.5 2z"
 />
 </svg>
 {branch}
 </span>
 </>
 )}

 {wt && (
 <>
 <span className="agent-chrome-dot">·</span>
 <span className="agent-chrome-wt" title="Worktree">
 {wt}
 </span>
 </>
 )}

 <span className="agent-chrome-spacer" />
 <span className="agent-chrome-elapsed muted" title="Session age">
 {elapsed}
 </span>
 {(onNew || (showCloseGroup && onCloseGroup)) && (
 <span className="agent-chrome-actions">
 {onNew && (
 <button
 type="button"
 className="agent-chrome-btn"
 title="New agent in this pane (Ctrl+T)"
 onClick={(e) => {
 e.stopPropagation()
 onNew()
 }}
 >
 +
 </button>
 )}
 {showCloseGroup && onCloseGroup && (
 <button
 type="button"
 className="agent-chrome-btn danger"
 title="Close this pane only (tabs move to a neighbor)"
 aria-label="Close pane"
 onClick={(e) => {
 e.stopPropagation()
 onCloseGroup()
 }}
 >
 <CloseIcon size={10} />
 </button>
 )}
 </span>
 )}
 </div>

 {showIdeaRow && ideaPrimary && (
 <div className="agent-chrome-row agent-chrome-idea" title={ideaSecondary || ideaPrimary}>
 <span className="agent-chrome-idea-text">
 <span className="agent-chrome-task-title">{ideaPrimary}</span>
 {ideaSecondary && (
 <span className="agent-chrome-task-detail muted"> - {ideaSecondary}</span>
 )}
 </span>
 </div>
 )}

 <div className="agent-chrome-rule" style={{ background: accent }} />
 </div>
 )
}
