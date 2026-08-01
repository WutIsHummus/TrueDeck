import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { createPortal } from 'react-dom'
import type { SessionInfo } from '../../electron/shared/types'
import { setDraggingTabId } from '../lib/tab-drag'
import { sessionTabLabel, sessionTabTitle } from '../lib/session-label'
import { CloseIcon } from './CloseIcon'
import { PixelBlast } from './PixelBlast'
import { AgentIcon } from './AgentIcon'
import { LanguageIcon } from './LanguageIcon'
import { useDeck } from '../store'

interface Props {
  groupId: string
  sessions: SessionInfo[]
  activeSessionId: string | null
  focused: boolean
  onSelect: (sessionId: string) => void
  /** App-level restore (patch + layout). Prefer over onSelect alone. */
  onRestore?: (sessionId: string) => void
  onClose: (sessionId: string) => void
  /** Tabs mid close-animation (Ctrl+W / X) */
  closingTabIds?: Set<string>
  onReorder: (sessionId: string, toIndex: number) => void
  onDragActiveChange?: (dragging: boolean) => void
  onNew?: () => void
  showCloseGroup?: boolean
  onCloseGroup?: () => void
}

function isMin(s: SessionInfo): boolean {
  return Boolean(s.uiMinimized || s.uiHidden)
}

function MinimizeIcon({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Tab strip: only expanded tabs.
 * Minimize (eye / bar) removes the tab from the strip; PTY keeps running.
 * Restore via the minimized menu (count badge).
 */
export function GroupTabBar({
  groupId,
  sessions,
  activeSessionId,
  focused,
  onSelect,
  onRestore,
  onClose,
  closingTabIds,
  onReorder,
  onDragActiveChange,
  onNew,
  showCloseGroup,
  onCloseGroup
}: Props): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  /** Session ids already shown — only brand-new tabs get enter animation */
  const seenTabIdsRef = useRef<Set<string>>(new Set())
  const [enterTabIds, setEnterTabIds] = useState<Set<string>>(() => new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; minWidth: number } | null>(
    null
  )
  const dragImageRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const patchSession = useDeck((s) => s.patchSession)
  const setStatus = useDeck((s) => s.setStatus)
  const restoreLockRef = useRef(0)

  const expanded = useMemo(() => sessions.filter((s) => !isMin(s)), [sessions])
  const minimized = useMemo(() => sessions.filter((s) => isMin(s)), [sessions])

  // Mark brand-new tabs for a one-shot enter animation (never re-run on split)
  useLayoutEffect(() => {
    const seen = seenTabIdsRef.current
    const fresh: string[] = []
    for (const s of expanded) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        fresh.push(s.id)
      }
    }
    if (!fresh.length) return
    setEnterTabIds((prev) => {
      const next = new Set(prev)
      for (const id of fresh) next.add(id)
      return next
    })
    const t = window.setTimeout(() => {
      setEnterTabIds((prev) => {
        const next = new Set(prev)
        for (const id of fresh) next.delete(id)
        return next
      })
    }, 220)
    return () => window.clearTimeout(t)
  }, [expanded])

  const endDrag = useCallback(() => {
    setDragId(null)
    onDragActiveChange?.(false)
    window.setTimeout(() => setDraggingTabId(null), 50)
    if (dragImageRef.current) {
      dragImageRef.current.remove()
      dragImageRef.current = null
    }
  }, [onDragActiveChange])

  const minimizeTab = useCallback(
    (s: SessionInfo, e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      patchSession(s.id, { uiMinimized: true, uiHidden: false })
      setStatus(`Minimized ${sessionTabLabel(s)} · still running`)
      if (activeSessionId === s.id) {
        const other = sessions.find((x) => x.id !== s.id && !isMin(x))
        if (other) onSelect(other.id)
      }
      setMenuOpen(false)
    },
    [activeSessionId, onSelect, patchSession, sessions, setStatus]
  )

  const restoreTab = useCallback(
    (s: SessionInfo, e?: ReactMouseEvent) => {
      e?.preventDefault()
      e?.stopPropagation()
      restoreLockRef.current = Date.now()
      setMenuOpen(false)
      // Always go through full restore (layout + expand) when available
      if (onRestore) {
        onRestore(s.id)
        return
      }
      patchSession(s.id, { uiMinimized: false, uiHidden: false })
      onSelect(s.id)
      setStatus(`Restored ${sessionTabLabel(s)}`)
    },
    [onRestore, onSelect, patchSession, setStatus]
  )

  // Fixed-position menu (portal) — group-tabbar overflow:hidden was clipping the old dropdown
  useLayoutEffect(() => {
    if (!menuOpen || !menuBtnRef.current) {
      setMenuPos(null)
      return
    }
    const place = (): void => {
      const btn = menuBtnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const minWidth = Math.max(220, r.width + 120)
      // Prefer open below; if near bottom of window, open above
      const below = r.bottom + 6
      const estH = 40 + minimized.length * 36
      const top =
        below + estH > window.innerHeight - 8
          ? Math.max(8, r.top - estH - 6)
          : below
      // Right-align to button, keep on screen
      let left = r.right - minWidth
      left = Math.max(8, Math.min(left, window.innerWidth - minWidth - 8))
      setMenuPos({ top, left, minWidth })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [menuOpen, minimized.length])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (ev: MouseEvent): void => {
      const t = ev.target as Node
      if (menuBtnRef.current?.contains(t)) return
      if (menuPanelRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setMenuOpen(false)
    }
    // Next tick so the opening click does not immediately close
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onDoc, true)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Active became minimized → jump to another expanded tab
  useEffect(() => {
    if (!activeSessionId) return
    if (Date.now() - restoreLockRef.current < 500) return
    const active = sessions.find((s) => s.id === activeSessionId)
    if (active && isMin(active)) {
      const other = expanded[0]
      if (other) onSelect(other.id)
    }
  }, [activeSessionId, sessions, expanded, onSelect])

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
          const el = scrollRef.current
          if (!el) return
          if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
            el.scrollLeft += e.deltaY
            e.preventDefault()
          }
        }}
      >
        <div className="group-tabbar-tabs">
          {expanded.map((s) => {
            const isActive = activeSessionId === s.id
            const isHot = isActive && focused
            const label = sessionTabLabel(s)
            const tip = `${sessionTabTitle(s)} · drag to dock · minimize removes from strip`
            const fullIndex = sessions.findIndex((x) => x.id === s.id)
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
                  s.status === 'exited' ? 'exited' : '',
                  enterTabIds.has(s.id) ? 'tab-enter' : '',
                  closingTabIds?.has(s.id) ? 'exiting' : ''
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
                    /* ignore */
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
                  if (fromGroup && fromGroup !== groupId) return
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
                  onReorder(id, Math.max(0, fullIndex))
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
                    explosions={false}
                  />
                )}
                <span className="tab-agent-icon" style={{ color: s.color }}>
                  {s.kind === 'document' || s.documentPath ? (
                    <LanguageIcon pathOrLang={s.documentPath || s.title || ''} size={12} />
                  ) : (
                    <AgentIcon agentId={s.agentId} size={12} color={s.color || '#94a3b8'} />
                  )}
                </span>
                <span className="label">{label}</span>
                <button
                  type="button"
                  className="tab-eye-btn"
                  title={`Minimize ${label} (Ctrl+M) — keeps running`}
                  aria-label={`Minimize ${label}`}
                  onClick={(e) => minimizeTab(s, e)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  <MinimizeIcon size={12} />
                </button>
                <button
                  type="button"
                  className="tab-close-btn"
                  title={`Close ${label} (Ctrl+W) — ends the agent`}
                  aria-label={`Close ${label}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onClose(s.id)
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            )
          })}
          {expanded.length === 0 && (
            <span className="group-tabbar-empty muted">
              {minimized.length ? 'All minimized' : 'No tabs'}
            </span>
          )}
        </div>
      </div>

      <div className="group-tabbar-actions">
        {minimized.length > 0 && (
          <div className="hidden-tabs-wrap" ref={menuRef}>
            <button
              ref={menuBtnRef}
              type="button"
              className={`tab-hidden-btn${menuOpen ? ' open' : ''}`}
              title={`${minimized.length} minimized · click to pick a tab to restore`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={`${minimized.length} minimized tabs — open restore menu`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
              onMouseDown={(e) => {
                // Keep focus from panicking the menu closed
                e.stopPropagation()
              }}
            >
              <MinimizeIcon size={12} />
              <span className="tab-hidden-count">{minimized.length}</span>
            </button>
            {menuOpen &&
              menuPos &&
              createPortal(
                <div
                  ref={menuPanelRef}
                  className="hidden-tabs-menu hidden-tabs-menu-portal"
                  role="menu"
                  style={{
                    top: menuPos.top,
                    left: menuPos.left,
                    minWidth: menuPos.minWidth
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="hidden-tabs-menu-title">
                    Restore minimized tab
                    <span className="hidden-tabs-menu-count">{minimized.length}</span>
                  </div>
                  {minimized.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitem"
                      className="hidden-tabs-item"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => restoreTab(s, e)}
                    >
                      <span className="tab-agent-icon" style={{ color: s.color }}>
                        {s.kind === 'document' || s.documentPath ? (
                          <LanguageIcon pathOrLang={s.documentPath || s.title || ''} size={14} />
                        ) : (
                          <AgentIcon agentId={s.agentId} size={14} color={s.color || '#94a3b8'} />
                        )}
                      </span>
                      <span className="hidden-tabs-item-text">
                        <span className="label">{sessionTabLabel(s, 40)}</span>
                        <span className="hidden-tabs-item-sub">
                          {s.kind === 'document' || s.documentPath
                            ? 'document'
                            : (s.agentName || s.agentId || 'agent').trim()}
                          {s.status === 'exited' ? ' · exited' : ' · running'}
                        </span>
                      </span>
                      <span className="hidden-tabs-show">Restore</span>
                    </button>
                  ))}
                </div>,
                document.body
              )}
          </div>
        )}
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
            title="Close all tabs in this pane (ends agents)"
            aria-label="Close pane tabs"
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
