import { useMemo } from 'react'
import type { SessionInfo } from '../../electron/shared/types'
import type { DropEdge, DropTarget, LayoutNode, PaneLayout } from '../lib/pane-layout'
import { listGroups, normalizeLayout } from '../lib/pane-layout'
import { TerminalPane } from './TerminalPane'
import { GroupTabBar } from './GroupTabBar'
import { StudioDockOverlay } from './StudioDockOverlay'
import { AgentChromeBar } from './AgentChromeBar'

interface Props {
 layout: PaneLayout
 sessions: SessionInfo[]
 fontSize: number
 /** Which pane + edge is hot while dragging (Roblox-style local dock). */
 dropTarget: DropTarget | null
 tabDragging: boolean
 onFocusSession: (id: string) => void
 onCloseSession: (id: string) => void
 onReorderInGroup: (groupId: string, sessionId: string, toIndex: number) => void
 onCloseGroup: (groupId: string) => void
 onDragActiveChange: (d: boolean) => void
 onNewInGroup: (groupId: string) => void
 /** Resize a specific nested split. */
 onGutterDown: (e: React.MouseEvent, splitId: string, direction: 'row' | 'column') => void
}

export function PaneWorkspace({
 layout,
 sessions,
 fontSize,
 dropTarget,
 tabDragging,
 onFocusSession,
 onCloseSession,
 onReorderInGroup,
 onCloseGroup,
 onDragActiveChange,
 onNewInGroup,
 onGutterDown
}: Props): JSX.Element {
 const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
 const safe = useMemo(() => normalizeLayout(layout), [layout])
 const groups = listGroups(safe)
 const multi = groups.length > 1

 const renderNode = (node: LayoutNode): JSX.Element => {
 if (node.type === 'split') {
 const isRow = node.direction === 'row'
 const r = node.ratio
 const style: React.CSSProperties = isRow
 ? {
 display: 'grid',
 gridTemplateColumns: `${r}fr 2px ${1 - r}fr`,
 height: '100%',
 minHeight: 0,
 minWidth: 0
 }
 : {
 display: 'grid',
 gridTemplateRows: `${r}fr 2px ${1 - r}fr`,
 height: '100%',
 minHeight: 0,
 minWidth: 0
 }

 return (
 <div
 key={node.id}
 className={`pane-split dir-${node.direction}`}
 data-split-id={node.id}
 style={style}
 >
 {renderNode(node.first)}
 <div
 className={`split-gutter ${isRow ? 'vertical' : 'horizontal'}`}
 role="separator"
 aria-orientation={isRow ? 'vertical' : 'horizontal'}
 title="Drag to resize this pane"
 onMouseDown={(e) => onGutterDown(e, node.id, node.direction)}
 />
 {renderNode(node.second)}
 </div>
 )
 }

 const g = node.group
 const groupSessions = g.sessionIds
 .map((id) => byId.get(id))
 .filter((s): s is SessionInfo => Boolean(s))
 const focused = safe.focusedGroupId === g.id
 const isDropHost = tabDragging && dropTarget?.groupId === g.id
 const hotEdge: DropEdge | null = isDropHost ? dropTarget!.edge : null
 // Tabs only when 2+ sessions - single tab uses chrome as the identity bar
 const multiTabs = groupSessions.length > 1

 return (
 <div
 key={g.id}
 className={`split-pane pane-group ${focused ? 'focused' : ''} ${isDropHost ? 'drop-host' : ''}`}
 data-group-id={g.id}
 onMouseDown={() => {
 if (g.activeSessionId) onFocusSession(g.activeSessionId)
 }}
 >
 {multiTabs && (
 <GroupTabBar
 groupId={g.id}
 sessions={groupSessions}
 activeSessionId={g.activeSessionId}
 focused={focused}
 onSelect={onFocusSession}
 onClose={onCloseSession}
 onReorder={(sid, to) => onReorderInGroup(g.id, sid, to)}
 onDragActiveChange={onDragActiveChange}
 onNew={() => onNewInGroup(g.id)}
 showCloseGroup={multi}
 onCloseGroup={() => onCloseGroup(g.id)}
 />
 )}
 <div className="term-stack">
 {(() => {
 const active =
 groupSessions.find((s) => s.id === g.activeSessionId) || groupSessions[0]
 // Stable key on session id only — OSC title thrash must not remount chrome
 // (was keying on title/focusTitle → "TrueDeck · master" flicker).
 return active ? (
 <AgentChromeBar
 key={`chrome-${active.id}`}
 session={active}
 focused={focused}
 showAgentName={!multiTabs}
 onNew={multiTabs ? undefined : () => onNewInGroup(g.id)}
 showCloseGroup={!multiTabs && multi}
 onCloseGroup={!multiTabs && multi ? () => onCloseGroup(g.id) : undefined}
 />
 ) : null
 })()}
 <div className="term-panes">
 {groupSessions.map((s) => (
 <TerminalPane
 key={s.id}
 sessionId={s.id}
 visible={g.activeSessionId === s.id}
 focused={focused && g.activeSessionId === s.id}
 fontSize={fontSize}
 />
 ))}
 {groupSessions.length === 0 && (
 <div className="pane-empty muted">Empty group - drop a tab here</div>
 )}
 {isDropHost && <StudioDockOverlay edge={hotEdge} />}
 </div>
 </div>
 </div>
 )
 }

 return (
 <div className={`pane-workspace ${multi ? 'multi' : 'single'}`}>
 <div className="pane-grid nested" style={{ height: '100%', minHeight: 0 }}>
 {renderNode(safe.root)}
 </div>
 </div>
 )
}
