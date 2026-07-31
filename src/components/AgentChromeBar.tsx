import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionInfo, TaskStatus } from '../../electron/shared/types'
import type { DocumentChromeState } from '../lib/document-chrome'
import {
 isAgentNameVariant,
 isNoiseTerminalTitle,
 looksLikeSecret
} from '../lib/session-label'
import { setDraggingTabId } from '../lib/tab-drag'
import { AgentIcon } from './AgentIcon'
import { LanguageIcon } from './LanguageIcon'
import { CloseIcon } from './CloseIcon'
import { PixelBlast } from './PixelBlast'
import { useDeck } from '../store'

interface Props {
 session: SessionInfo
 /** Pane group id - required so chrome can start the same tab dock drag as GroupTabBar. */
 groupId: string
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
 /** Stage dock overlay while dragging this session. */
 onDragActiveChange?: (dragging: boolean) => void
 /**
 * When every tab in this pane is minimized: no tab strip — chrome hosts
 * the restore list instead of a live agent identity row.
 */
 minimizedOnly?: boolean
 /** Minimized sessions to list on the chrome (restore chips). */
 minimizedSessions?: SessionInfo[]
 onRestore?: (sessionId: string) => void
 /** Document tab controls (PixelBlast chrome hosts file meta + save). */
 documentChrome?: DocumentChromeState | null
 /** Hide chrome PixelBlast (e.g. during split slide). */
 suppressBlast?: boolean
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
 groupId,
 focused = false,
 showAgentName = true,
 onNew,
 showCloseGroup,
 onCloseGroup,
 onDragActiveChange,
 minimizedOnly = false,
 minimizedSessions = [],
 onRestore,
 documentChrome = null,
 suppressBlast = false
}: Props): JSX.Element {
 const [now, setNow] = useState(() => Date.now())
 const [dragging, setDragging] = useState(false)
 const dragImageRef = useRef<HTMLDivElement | null>(null)
 const patchSession = useDeck((s) => s.patchSession)
 const setStatus = useDeck((s) => s.setStatus)
 const [branch, setBranch] = useState<string | null>(session.gitBranch || null)
 const [linkedTask, setLinkedTask] = useState<{
 id: string
 title: string
 status: string
 } | null>(null)

 const endDrag = useCallback(() => {
 setDragging(false)
 onDragActiveChange?.(false)
 window.setTimeout(() => setDraggingTabId(null), 50)
 if (dragImageRef.current) {
 dragImageRef.current.remove()
 dragImageRef.current = null
 }
 }, [onDragActiveChange])

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
 const isDoc = Boolean(
 documentChrome || session.kind === 'document' || session.documentPath
 )
 const doc = documentChrome
 const dragLabel = isDoc
 ? doc?.name || basename(session.documentPath || session.title || 'File')
 : `${agentName}${proj ? ` · ${proj}` : ''}`
 const minList = minimizedSessions.filter(Boolean)
 // Always show chips when the pane is minimized-only (including document tabs).
 // On a focused document chrome, keep chips off the toolbar to save space.
 const showMinList = minList.length > 0 && (minimizedOnly || !isDoc)
 const minChips = showMinList ? (
 <>
 <span className="agent-chrome-min-label muted" title="Minimized tabs still running">
 {minList.length} minimized
 </span>
 <div className="agent-chrome-min-list" role="list">
 {minList.map((s) => {
 const isMinDoc = s.kind === 'document' || Boolean(s.documentPath)
 const minLabel = isMinDoc
 ? basename(s.documentPath || s.title || 'File')
 : s.agentName || s.title || 'tab'
 return (
 <button
 key={s.id}
 type="button"
 role="listitem"
 className={`agent-chrome-min-chip${isMinDoc ? ' is-document' : ''}`}
 title={`Restore ${minLabel}`}
 onClick={(e) => {
 e.stopPropagation()
 onRestore?.(s.id)
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 {isMinDoc ? (
 <LanguageIcon
 pathOrLang={s.documentPath || s.title || ''}
 size={12}
 title={minLabel}
 />
 ) : (
 <AgentIcon
 agentId={s.agentId}
 size={12}
 color={s.color || '#e8e8e8'}
 />
 )}
 <span className="agent-chrome-min-name">{minLabel}</span>
 </button>
 )
 })}
 </div>
 </>
 ) : null

 return (
 <div
 className={[
 'agent-chrome',
 focused && !minimizedOnly ? 'focused hot' : focused ? 'focused' : '',
 showIdeaRow && !minimizedOnly && !isDoc ? '' : ' compact',
 dragging ? 'dragging' : '',
 minimizedOnly ? 'minimized-only' : '',
 showMinList && !minimizedOnly ? 'has-min-list' : '',
 isDoc ? 'is-document' : ''
 ]
 .filter(Boolean)
 .join(' ')}
 style={{ ['--agent-accent' as string]: isDoc ? '#a78bfa' : accent }}
 data-group={groupId}
 data-session={session.id}
 draggable={!minimizedOnly}
 title={
 minimizedOnly
 ? `${minList.length} minimized · click a chip to restore`
 : isDoc
 ? doc?.path || dragLabel
 : showMinList
 ? `${dragLabel} · ${minList.length} minimized — click a chip to restore`
 : `${dragLabel} · drag onto another pane to dock`
 }
 onDragStart={(e) => {
 if (minimizedOnly) {
 e.preventDefault()
 return
 }
 // Don't start a pane drag from + / close controls
 const t = e.target as HTMLElement | null
 if (t?.closest?.('button, a, input, textarea')) {
 e.preventDefault()
 return
 }
 setDragging(true)
 setDraggingTabId(session.id)
 onDragActiveChange?.(true)
 e.dataTransfer.effectAllowed = 'copyMove'
 e.dataTransfer.setData('text/plain', session.id)
 try {
 e.dataTransfer.setData('application/x-truedeck-tab', session.id)
 e.dataTransfer.setData('application/x-truedeck-group', groupId)
 } catch {
 /* ignore */
 }
 const ghost = document.createElement('div')
 ghost.textContent = dragLabel
 ghost.style.cssText =
 'position:absolute;top:-1000px;padding:6px 12px;background:#1a1a1a;border:1px solid #3f3f3f;border-radius:8px;color:#e8e8e8;font:12px Cascadia Code,monospace;'
 document.body.appendChild(ghost)
 dragImageRef.current = ghost
 e.dataTransfer.setDragImage(ghost, 40, 16)
 }}
 onDragEnd={endDrag}
 >
 {focused && !minimizedOnly && !suppressBlast && (
 <PixelBlast
 className="agent-chrome-blast"
 color={isDoc ? '#a78bfa' : accent}
 opacity={0.55}
 active={focused}
 explosions={false}
 />
 )}

 <div className="agent-chrome-row agent-chrome-main">
 {minimizedOnly ? (
 minChips
 ) : isDoc ? (
 <>
 <span className="document-icon" title={doc?.lang || 'Document'}>
 <LanguageIcon
 pathOrLang={doc?.path || session.documentPath || ''}
 size={14}
 title={doc?.lang}
 />
 </span>
 <span className="document-name">{doc?.name || dragLabel}</span>
 {doc?.dirty && (
 <span className="document-dirty" title="Unsaved">
 •
 </span>
 )}
 <span className="document-meta muted">
 <span className="document-meta-sep">·</span>
 {doc?.lang || 'File'}
 {doc && doc.lineCount > 0 ? (
 <>
 <span className="document-meta-sep">·</span>
 {doc.lineCount} lines
 </>
 ) : null}
 <span className="document-meta-sep">·</span>
 {doc?.mode === 'preview' && doc?.isMd ? 'Read' : 'IDE'}
 </span>
 <span className="agent-chrome-spacer" />
 {doc?.isMd && (
 <div className="document-mode-toggle" role="group" aria-label="View mode">
 <button
 type="button"
 className={doc.mode === 'preview' ? 'active' : ''}
 onClick={(e) => {
 e.stopPropagation()
 doc.onSetMode('preview')
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 Read
 </button>
 <button
 type="button"
 className={doc.mode === 'edit' ? 'active' : ''}
 onClick={(e) => {
 e.stopPropagation()
 doc.onSetMode('edit')
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 Edit
 </button>
 </div>
 )}
 {(doc?.mode === 'edit' || !doc?.isMd) && (
 <button
 type="button"
 className={`document-btn${doc?.vimMode ? ' active-vim' : ''}`}
 title={doc?.vimMode ? 'Vim on' : 'Enable Vim'}
 onClick={(e) => {
 e.stopPropagation()
 doc?.onToggleVim()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 Vim
 </button>
 )}
 <button
 type="button"
 className="document-btn"
 title="Reload from disk"
 disabled={doc?.loading}
 onClick={(e) => {
 e.stopPropagation()
 doc?.onReload()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 Reload
 </button>
 <button
 type="button"
 className="document-btn primary"
 title="Save (Ctrl+S)"
 disabled={!doc?.dirty || doc?.saving}
 onClick={(e) => {
 e.stopPropagation()
 doc?.onSave()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 {doc?.saving ? 'Saving…' : 'Save'}
 </button>
 <span
 className="agent-chrome-actions"
 draggable={false}
 onMouseDown={(e) => e.stopPropagation()}
 >
 <button
 type="button"
 className={`agent-chrome-btn${session.uiMinimized || session.uiHidden ? ' active-eye' : ''}`}
 title="Minimize tab"
 aria-label="Minimize tab"
 onClick={(e) => {
 e.stopPropagation()
 patchSession(session.id, { uiMinimized: true, uiHidden: false })
 setStatus(`Minimized ${doc?.name || 'file'}`)
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
 <path
 d="M5 12h14"
 stroke="currentColor"
 strokeWidth="1.9"
 strokeLinecap="round"
 />
 </svg>
 </button>
 {onNew && (
 <button
 type="button"
 className="agent-chrome-btn"
 title="New agent in this pane (Ctrl+T)"
 onClick={(e) => {
 e.stopPropagation()
 onNew()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 +
 </button>
 )}
 </span>
 </>
 ) : (
 <>
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

 {showMinList && (
 <>
 <span className="agent-chrome-dot">·</span>
 {minChips}
 </>
 )}

 <span className="agent-chrome-spacer" />
 <span className="agent-chrome-elapsed muted" title="Session age">
 {elapsed}
 </span>
 <span
 className="agent-chrome-actions"
 draggable={false}
 onMouseDown={(e) => e.stopPropagation()}
 onDragStart={(e) => {
 e.preventDefault()
 e.stopPropagation()
 }}
 >
 <button
 type="button"
 className={`agent-chrome-btn${session.uiMinimized || session.uiHidden ? ' active-eye' : ''}`}
 draggable={false}
 title="Minimize tab (remove from strip, keeps running)"
 aria-label="Minimize tab"
 onClick={(e) => {
 e.stopPropagation()
 patchSession(session.id, { uiMinimized: true, uiHidden: false })
 setStatus(`Minimized ${agentName}`)
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
 <path
 d="M5 12h14"
 stroke="currentColor"
 strokeWidth="1.9"
 strokeLinecap="round"
 />
 </svg>
 </button>
 {onNew && (
 <button
 type="button"
 className="agent-chrome-btn"
 draggable={false}
 title="New agent in this pane (Ctrl+T)"
 onClick={(e) => {
 e.stopPropagation()
 onNew()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 +
 </button>
 )}
 {showCloseGroup && onCloseGroup && (
 <button
 type="button"
 className="agent-chrome-btn danger"
 draggable={false}
 title="Close tab (Ctrl+W) — ends the agent"
 aria-label="Close tab"
 onClick={(e) => {
 e.stopPropagation()
 onCloseGroup()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 <CloseIcon size={10} />
 </button>
 )}
 </span>
 </>
 )}
 </div>

 {showIdeaRow && ideaPrimary && !minimizedOnly && !isDoc && (
 <div className="agent-chrome-row agent-chrome-idea" title={ideaSecondary || ideaPrimary}>
 <span className="agent-chrome-idea-text">
 <span className="agent-chrome-task-title">{ideaPrimary}</span>
 {ideaSecondary && (
 <span className="agent-chrome-task-detail muted"> - {ideaSecondary}</span>
 )}
 </span>
 </div>
 )}

 <div
 className="agent-chrome-rule"
 style={{
 background: minimizedOnly ? 'var(--border)' : isDoc ? '#a78bfa' : accent
 }}
 />
 </div>
 )
}
