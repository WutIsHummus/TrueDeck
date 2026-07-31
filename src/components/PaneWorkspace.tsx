import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionInfo } from '../../electron/shared/types'
import type { DocumentChromeState } from '../lib/document-chrome'
import type { DropEdge, DropTarget, LayoutNode, PaneLayout } from '../lib/pane-layout'
import { listGroups, normalizeLayout } from '../lib/pane-layout'
import { TerminalPane } from './TerminalPane'
import { DocumentPane } from './DocumentPane'
import { GroupTabBar } from './GroupTabBar'
import { StudioDockOverlay } from './StudioDockOverlay'
import { AgentChromeBar } from './AgentChromeBar'

/** Brief slide animation after Ctrl+D / Ctrl+X (or dock drop / reverse close). */
export type SplitAnim = {
  /** Session that moved into (or out of) the leaf */
  sessionId: string
  /** Edge the pane entered from / exits toward */
  edge: 'right' | 'bottom' | 'left' | 'top'
  /** Token so the same edge can re-fire */
  token: number
  /**
   * Live first-cell share (0–1) while the divider slides.
   * Set on the same frame as the layout change so the first paint isn’t 50/50.
   */
  ratio: number
}

interface Props {
  layout: PaneLayout
  sessions: SessionInfo[]
  fontSize: number
  dropTarget: DropTarget | null
  tabDragging: boolean
  onFocusSession: (id: string) => void
  onRestoreSession: (id: string) => void
  onCloseSession: (id: string) => void
  /** Tabs mid close-animation (Ctrl+W / X) */
  closingTabIds?: Set<string>
  onReorderInGroup: (groupId: string, sessionId: string, toIndex: number) => void
  onCloseGroup: (groupId: string) => void
  onDragActiveChange: (d: boolean) => void
  onNewInGroup: (groupId: string) => void
  onGutterDown: (e: React.MouseEvent, splitId: string, direction: 'row' | 'column') => void
  /** Click file path in CLI output → Document tab */
  onOpenPath?: (path: string) => void
  /** Settings → MCP: openCliPathsInDocument (default true) */
  openCliPathsInDocument?: boolean
  /** Monaco Document editor Vim keybindings */
  editorVimMode?: boolean
  /** Latest split enter animation cue */
  splitAnim?: SplitAnim | null
  /** Reverse split exit while closing a sole pane half */
  closeSplitAnim?: SplitAnim | null
  /** When true, terminals must not steal keyboard (palette / settings open). */
  inputLocked?: boolean
}

function isMin(s: SessionInfo): boolean {
  return Boolean(s.uiMinimized || s.uiHidden)
}

/**
 * Studio panes. Leaves with only minimized tabs are not painted (they must be
 * collapsed out of the tree by App displayLayout). Expanded tabs only.
 */
export function PaneWorkspace({
  layout,
  sessions,
  fontSize,
  dropTarget,
  tabDragging,
  onFocusSession,
  onRestoreSession,
  onCloseSession,
  closingTabIds,
  onReorderInGroup,
  onCloseGroup,
  onDragActiveChange,
  onNewInGroup,
  onGutterDown,
  onOpenPath,
  openCliPathsInDocument = true,
  editorVimMode = false,
  splitAnim = null,
  closeSplitAnim = null,
  inputLocked = false
}: Props): JSX.Element {
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const safe = useMemo(() => normalizeLayout(layout), [layout])
  const groups = listGroups(safe)
  const multi = groups.length > 1
  /** Active document header state (driven by DocumentPane). */
  const [docChromeById, setDocChromeById] = useState<
    Record<string, DocumentChromeState | null>
  >({})
  const setDocChrome = useCallback((id: string, state: DocumentChromeState | null) => {
    setDocChromeById((prev) => {
      if (prev[id] === state) return prev
      if (!state && !(id in prev)) return prev
      const next = { ...prev }
      if (state) next[id] = state
      else delete next[id]
      return next
    })
  }, [])

  const animSession = splitAnim?.sessionId || null
  const animEdge = splitAnim?.edge || null
  const animToken = splitAnim?.token || 0
  const slideRatio = splitAnim?.ratio
  const closeSessionId = closeSplitAnim?.sessionId || null
  const closeEdge = closeSplitAnim?.edge || null
  const closeToken = closeSplitAnim?.token || 0
  const closeRatio = closeSplitAnim?.ratio
  const splitting = Boolean(splitAnim)
  const closingSplit = Boolean(closeSplitAnim)

  /**
   * Only the *new* / *exiting* split leaf should animate — not parent splits
   * that merely contain the session deeper in the tree.
   */
  const directLeafSide = (
    node: Extract<LayoutNode, { type: 'split' }>,
    sid: string
  ): 'first' | 'second' | null => {
    const a = node.first
    const b = node.second
    if (
      a.type === 'leaf' &&
      a.group.sessionIds.length === 1 &&
      a.group.sessionIds[0] === sid
    ) {
      return 'first'
    }
    if (
      b.type === 'leaf' &&
      b.group.sessionIds.length === 1 &&
      b.group.sessionIds[0] === sid
    ) {
      return 'second'
    }
    return null
  }

  const renderNode = (node: LayoutNode): JSX.Element | null => {
    if (node.type === 'split') {
      const isRow = node.direction === 'row'
      // Enter anim (open split)
      const enterSide =
        animSession && animEdge && animToken
          ? directLeafSide(node, animSession)
          : null
      // Exit anim (close sole half — reverse of enter)
      const exitSide =
        closeSessionId && closeEdge && closeToken
          ? directLeafSide(node, closeSessionId)
          : null
      const isEnterSplit = Boolean(enterSide && typeof slideRatio === 'number')
      const isExitSplit = Boolean(exitSide && typeof closeRatio === 'number')
      const isAnimSplit = isEnterSplit || isExitSplit
      const liveRatio = isExitSplit
        ? (closeRatio as number)
        : isEnterSplit
          ? (slideRatio as number)
          : null
      const motionEdge = isExitSplit ? closeEdge! : animEdge || 'right'
      const slideClass = isAnimSplit
        ? ` split-anim split-anim-${motionEdge} ${isExitSplit ? `split-exit-${exitSide}` : `split-enter-${enterSide}`}`
        : ''

      const firstEl = renderNode(node.first)
      const secondEl = renderNode(node.second)
      // Empty half gone - give full space to the other side
      if (!firstEl && !secondEl) return null
      if (!firstEl) {
        return (
          <div key={node.id} className="pane-split-fill">
            {secondEl}
          </div>
        )
      }
      if (!secondEl) {
        return (
          <div key={node.id} className="pane-split-fill">
            {firstEl}
          </div>
        )
      }
      // Live ratio only on the local enter/exit split — parents keep theirs
      const r =
        liveRatio != null
          ? Math.max(0.02, Math.min(0.98, liveRatio))
          : node.ratio
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

      const enterFirst = enterSide === 'first'
      const enterSecond = enterSide === 'second'
      const exitFirst = exitSide === 'first'
      const exitSecond = exitSide === 'second'
      const edgeCls = motionEdge

      return (
        <div
          key={node.id}
          className={`pane-split dir-${node.direction}${slideClass}`}
          data-split-id={node.id}
          style={style}
        >
          <div
            className={[
              'pane-split-cell',
              'cell-a',
              enterFirst ? `cell-enter cell-enter-${edgeCls} animating` : '',
              exitFirst ? `cell-exit cell-exit-${edgeCls} animating` : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {firstEl}
          </div>
          <div
            className={`split-gutter ${isRow ? 'vertical' : 'horizontal'}${isAnimSplit ? ' animating' : ''}`}
            role="separator"
            aria-orientation={isRow ? 'vertical' : 'horizontal'}
            title="Drag to resize this pane"
            onMouseDown={(e) => onGutterDown(e, node.id, node.direction)}
          />
          <div
            className={[
              'pane-split-cell',
              'cell-b',
              enterSecond ? `cell-enter cell-enter-${edgeCls} animating` : '',
              exitSecond ? `cell-exit cell-exit-${edgeCls} animating` : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {secondEl}
          </div>
        </div>
      )
    }

    const g = node.group
    const groupSessions = g.sessionIds
      .map((id) => byId.get(id))
      .filter((s): s is SessionInfo => Boolean(s))
    const expandedSessions = groupSessions.filter((s) => !isMin(s))
    const minimizedSessions = groupSessions.filter((s) => isMin(s))
    const minimizedOnly =
      expandedSessions.length === 0 && minimizedSessions.length > 0

    // Skip empty leaves with no sessions at all
    if (groupSessions.length === 0) {
      return null
    }

    const focused = safe.focusedGroupId === g.id
    const isDropHost = tabDragging && dropTarget?.groupId === g.id
    const hotEdge: DropEdge | null = isDropHost ? dropTarget!.edge : null
    // Tab strip only when 2+ expanded tabs. One open tab (or all minimized)
    // drops the strip; chrome hosts identity + minimized restore chips.
    const showTabBar = expandedSessions.length > 1
    const activeId =
      (g.activeSessionId &&
        expandedSessions.some((s) => s.id === g.activeSessionId) &&
        g.activeSessionId) ||
      expandedSessions[0]?.id ||
      null
    const chromeSession =
      expandedSessions.find((s) => s.id === activeId) ||
      expandedSessions[0] ||
      minimizedSessions[0]
    const chromeIsDoc =
      Boolean(chromeSession) &&
      (chromeSession!.kind === 'document' || Boolean(chromeSession!.documentPath))
    const docChrome =
      chromeIsDoc && chromeSession ? docChromeById[chromeSession.id] || null : null
    // Tab-among-siblings close (chip slide only). Sole split-half uses closeSplitAnim.
    const paneClosing = Boolean(
      !closingSplit &&
        closingTabIds &&
        (activeId
          ? closingTabIds.has(activeId)
          : groupSessions.some((s) => closingTabIds.has(s.id)))
    )
    const closingAllVisible =
      !closingSplit &&
      Boolean(closingTabIds) &&
      expandedSessions.length > 0 &&
      expandedSessions.every((s) => closingTabIds!.has(s.id))
    const groupIsSplitExiting = Boolean(
      closeSessionId && g.sessionIds.includes(closeSessionId)
    )

    return (
      <div
        key={g.id}
        className={`split-pane pane-group ${focused ? 'focused' : ''} ${isDropHost ? 'drop-host' : ''}${minimizedOnly ? ' pane-minimized-only' : ''}${paneClosing || closingAllVisible ? ' pane-closing' : ''}`}
        data-group-id={g.id}
        onMouseDown={() => {
          if (activeId) onFocusSession(activeId)
        }}
      >
        {showTabBar && (
          <GroupTabBar
            groupId={g.id}
            sessions={groupSessions}
            activeSessionId={activeId}
            focused={focused}
            onSelect={onFocusSession}
            onRestore={onRestoreSession}
            onClose={onCloseSession}
            closingTabIds={closingTabIds}
            onReorder={(sid, to) => onReorderInGroup(g.id, sid, to)}
            onDragActiveChange={onDragActiveChange}
            onNew={() => onNewInGroup(g.id)}
            showCloseGroup={multi}
            onCloseGroup={() => onCloseGroup(g.id)}
          />
        )}
        <div className="term-stack">
          {chromeSession && (minimizedOnly || !showTabBar || chromeIsDoc) ? (
            <AgentChromeBar
              key={`chrome-${chromeSession.id}`}
              session={chromeSession}
              groupId={g.id}
              focused={focused}
              showAgentName={!minimizedOnly && !chromeIsDoc}
              minimizedOnly={minimizedOnly}
              minimizedSessions={minimizedSessions}
              onRestore={onRestoreSession}
              onNew={() => onNewInGroup(g.id)}
              showCloseGroup={multi || Boolean(chromeSession)}
              onCloseGroup={
                multi
                  ? () => onCloseGroup(g.id)
                  : chromeSession
                    ? () => onCloseSession(chromeSession.id)
                    : undefined
              }
              onDragActiveChange={onDragActiveChange}
              documentChrome={docChrome}
              suppressBlast={splitting}
            />
          ) : chromeSession && showTabBar ? (
            <AgentChromeBar
              key={`chrome-${chromeSession.id}`}
              session={chromeSession}
              groupId={g.id}
              focused={focused}
              showAgentName={false}
              onDragActiveChange={onDragActiveChange}
              suppressBlast={splitting}
            />
          ) : null}
          <div className="term-panes">
            {minimizedOnly ? (
              <div className="pane-minimized-body muted">
                All tabs minimized · still running · restore from the bar above
              </div>
            ) : (
              groupSessions.map((s) => {
                const isDoc = s.kind === 'document' || Boolean(s.documentPath)
                const isVisible = !isMin(s) && activeId === s.id
                const isFocused = focused && isVisible
                if (isDoc) {
                  return (
                    <DocumentPane
                      key={s.id}
                      session={s}
                      visible={isVisible}
                      focused={isFocused}
                      vimMode={editorVimMode}
                      onChromeChange={(st) => setDocChrome(s.id, st)}
                    />
                  )
                }
                const isClosing = Boolean(closingTabIds?.has(s.id))
                return (
                  <div
                    key={s.id}
                    className={`term-slot${isVisible ? ' visible' : ' hidden'}${isClosing ? ' closing' : ''}`}
                    data-session-id={s.id}
                  >
                    <TerminalPane
                      sessionId={s.id}
                      visible={isVisible}
                      focused={isFocused && !inputLocked && !isClosing}
                      fontSize={fontSize}
                      onOpenPath={onOpenPath}
                      openPathsEnabled={openCliPathsInDocument}
                      suppressIntroBlast={splitting}
                      inputLocked={inputLocked || isClosing}
                      /* Split slides: repaint without WINCH. Close: freeze (no rAF thrash → Grok flicker). */
                      layoutAnimating={(splitting || groupIsSplitExiting) && !isClosing}
                      closing={
                        isClosing ||
                        groupIsSplitExiting ||
                        (isVisible && (paneClosing || closingAllVisible))
                      }
                    />
                  </div>
                )
              })
            )}
            {isDropHost && <StudioDockOverlay edge={hotEdge} />}
          </div>
        </div>
      </div>
    )
  }

  const tree = renderNode(safe.root)

  return (
    <div className={`pane-workspace ${multi ? 'multi' : 'single'}`}>
      <div className="pane-grid nested" style={{ height: '100%', minHeight: 0 }}>
        {tree || <div className="pane-empty muted">No open tabs</div>}
      </div>
    </div>
  )
}
