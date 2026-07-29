import { useCallback, useRef, useState, type CSSProperties } from 'react'
import type { SessionInfo } from '../../electron/shared/types'
import { setDraggingTabId } from '../lib/tab-drag'
import { sessionTabLabel, sessionTabTitle } from '../lib/session-label'
import { CloseIcon } from './CloseIcon'
import { PixelBlast } from './PixelBlast'
import { AgentIcon } from './AgentIcon'

interface Props {
 groupId: string
 sessions: SessionInfo[]
 activeSessionId: string | null
 focused: boolean
 onSelect: (sessionId: string) => void
 onClose: (sessionId: string) => void
 onReorder: (sessionId: string, toIndex: number) => void
 onDragActiveChange?: (dragging: boolean) => void
 onNew?: () => void
 /** Show close-pane control on the same row (multi-pane only). */
 showCloseGroup?: boolean
 onCloseGroup?: () => void
}

/**
 * Compact strip: scrollable tabs + fixed actions (no A/B/C group labels).
 */
export function GroupTabBar({
 groupId,
 sessions,
 activeSessionId,
 focused,
 onSelect,
 onClose,
 onReorder,
 onDragActiveChange,
 onNew,
 showCloseGroup,
 onCloseGroup
}: Props): JSX.Element {
 const [dragId, setDragId] = useState<string | null>(null)
 const dragImageRef = useRef<HTMLDivElement | null>(null)
 const scrollRef = useRef<HTMLDivElement | null>(null)

 const endDrag = useCallback(() => {
 setDragId(null)
 onDragActiveChange?.(false)
 window.setTimeout(() => setDraggingTabId(null), 50)
 if (dragImageRef.current) {
 dragImageRef.current.remove()
 dragImageRef.current = null
 }
 }, [onDragActiveChange])

 return (
 <div
 className={`group-tabbar ${focused ? 'focused' : ''}`}
 data-group={groupId}
 role="tablist"
 aria-label="Session tabs"
 >
 <div
 className="group-tabbar-scroll"
 ref={scrollRef}
 onWheel={(e) => {
 // Vertical wheel → horizontal tab scroll (trackpads / mouse)
 const el = scrollRef.current
 if (!el) return
 if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
 el.scrollLeft += e.deltaY
 e.preventDefault()
 }
 }}
 >
 <div className="group-tabbar-tabs">
 {sessions.map((s) => {
 const isActive = activeSessionId === s.id
 /** Active tab in the focused pane - strongest chrome + PixelBlast */
 const isHot = isActive && focused
 const label = sessionTabLabel(s)
 const tip = `${sessionTabTitle(s)} · drag onto another pane to dock`
 return (
 <div
 key={s.id}
 role="tab"
 aria-selected={isActive}
 draggable
 className={[
 'tab',
 'group-tab',
 isActive ? 'active' : '',
 isHot ? 'hot' : '',
 dragId === s.id ? 'dragging' : '',
 s.status === 'exited' ? 'exited' : ''
 ]
 .filter(Boolean)
 .join(' ')}
 style={
 isActive
 ? ({ ['--tab-accent' as string]: s.color || '#22d3ee' } as CSSProperties)
 : undefined
 }
 onClick={() => onSelect(s.id)}
 onDragStart={(e) => {
 setDragId(s.id)
 setDraggingTabId(s.id)
 onDragActiveChange?.(true)
 e.dataTransfer.effectAllowed = 'copyMove'
 e.dataTransfer.setData('text/plain', s.id)
 try {
 e.dataTransfer.setData('application/x-truedeck-tab', s.id)
 e.dataTransfer.setData('application/x-truedeck-group', groupId)
 } catch {
 // ignore
 }
 const ghost = document.createElement('div')
 ghost.textContent = label
 ghost.style.cssText =
 'position:absolute;top:-1000px;padding:6px 12px;background:#1a1a1a;border:1px solid #3f3f3f;border-radius:8px;color:#e8e8e8;font:12px Cascadia Code,monospace;'
 document.body.appendChild(ghost)
 dragImageRef.current = ghost
 e.dataTransfer.setDragImage(ghost, 40, 16)
 }}
 onDragEnd={endDrag}
 onDragOver={(e) => {
 e.preventDefault()
 e.dataTransfer.dropEffect = 'move'
 }}
 onDrop={(e) => {
 const fromGroup =
 e.dataTransfer.getData('application/x-truedeck-group') || ''
 if (fromGroup && fromGroup !== groupId) {
 return
 }
 e.preventDefault()
 e.stopPropagation()
 const id =
 e.dataTransfer.getData('application/x-truedeck-tab') ||
 e.dataTransfer.getData('text/plain') ||
 dragId
 if (!id || id === s.id) {
 endDrag()
 return
 }
 const to = sessions.findIndex((x) => x.id === s.id)
 onReorder(id, Math.max(0, to))
 endDrag()
 }}
 title={tip}
 >
 {isHot && (
 <PixelBlast
 className="tab-pixel-blast"
 color={s.color || '#22d3ee'}
 opacity={0.7}
 active={isHot}
 />
 )}
 <span className="tab-agent-icon" style={{ color: s.color }}>
 <AgentIcon agentId={s.agentId} size={12} color={s.color || '#94a3b8'} />
 </span>
 <span className="label">{label}</span>
 <button
 type="button"
 className="tab-close-btn"
 title={`Close ${label}`}
 aria-label={`Close ${label}`}
 onClick={(e) => {
 e.preventDefault()
 e.stopPropagation()
 onClose(s.id)
 }}
 onMouseDown={(e) => {
 // Don't start a tab drag when clicking close
 e.preventDefault()
 e.stopPropagation()
 }}
 >
 <CloseIcon size={10} />
 </button>
 </div>
 )
 })}
 </div>
 </div>

 <div className="group-tabbar-actions">
 {onNew && (
 <button
 type="button"
 className="tab-add"
 title="New agent in this group"
 onClick={onNew}
 >
 +
 </button>
 )}
 {showCloseGroup && onCloseGroup && (
 <button
 type="button"
 className="tab-close-btn pane-close-group"
 title="Close this pane only (tabs move to a neighbor - does not kill agents)"
 aria-label="Close pane"
 onClick={(e) => {
 e.preventDefault()
 e.stopPropagation()
 onCloseGroup()
 }}
 onMouseDown={(e) => e.stopPropagation()}
 >
 <CloseIcon size={10} />
 </button>
 )}
 </div>
 </div>
 )
}
