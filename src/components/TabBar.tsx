import { useCallback, useRef, useState } from 'react'
import type { SessionInfo } from '../../electron/shared/types'

interface Props {
  sessions: SessionInfo[]
  activeSessionId: string | null
  splitId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onReorder: (id: string, toIndex: number) => void
  onSplitWith: (id: string) => void
  onClearSplit: () => void
  onNew: () => void
  onCloseAll: () => void
}

/**
 * Interactive tab strip: drag-reorder, drop-to-split, middle-click close,
 * double-click focus, keyboard-friendly.
 */
export function TabBar({
  sessions,
  activeSessionId,
  splitId,
  onSelect,
  onClose,
  onReorder,
  onSplitWith,
  onClearSplit,
  onNew,
  onCloseAll
}: Props): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [overEdge, setOverEdge] = useState<'before' | 'after' | null>(null)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)

  const onDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      setDragId(id)
      setDragging(true)
      onSelect(id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/truedeck-tab', id)
      e.dataTransfer.setData('text/plain', id)
      // Custom ghost
      const ghost = document.createElement('div')
      ghost.className = 'tab-drag-ghost'
      const s = sessions.find((x) => x.id === id)
      ghost.textContent = s?.agentName || 'Tab'
      ghost.style.cssText =
        'position:absolute;top:-1000px;left:-1000px;padding:6px 12px;background:#1a1a1a;border:1px solid #3f3f3f;border-radius:8px;color:#e8e8e8;font:12px Cascadia Code,monospace;box-shadow:0 8px 24px #0009;'
      document.body.appendChild(ghost)
      dragImageRef.current = ghost
      e.dataTransfer.setDragImage(ghost, 40, 16)
    },
    [onSelect, sessions]
  )

  const onDragEnd = useCallback(() => {
    setDragId(null)
    setOverId(null)
    setOverEdge(null)
    setDragging(false)
    if (dragImageRef.current) {
      dragImageRef.current.remove()
      dragImageRef.current = null
    }
  }, [])

  const onDragOverTab = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!dragId || dragId === id) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mid = rect.left + rect.width / 2
      setOverId(id)
      setOverEdge(e.clientX < mid ? 'before' : 'after')
    },
    [dragId]
  )

  const onDropTab = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault()
      const id = e.dataTransfer.getData('text/truedeck-tab') || dragId
      if (!id || id === targetId) {
        onDragEnd()
        return
      }
      const from = sessions.findIndex((s) => s.id === id)
      let to = sessions.findIndex((s) => s.id === targetId)
      if (from < 0 || to < 0) {
        onDragEnd()
        return
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const after = e.clientX >= rect.left + rect.width / 2
      if (after) to += 1
      // Adjust if removing from before target
      let dest = to
      if (from < to) dest -= 1
      onReorder(id, dest)
      onDragEnd()
    },
    [dragId, sessions, onReorder, onDragEnd]
  )

  return (
    <div
      className={`tabbar ${dragging ? 'is-dragging' : ''}`}
      role="tablist"
      aria-label="Agent tabs — drag to reorder"
      onDragOver={(e) => {
        // Allow drop on empty end of bar
        if (dragId) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(e) => {
        // Drop past last tab → move to end
        const id = e.dataTransfer.getData('text/truedeck-tab') || dragId
        if (!id) return
        e.preventDefault()
        onReorder(id, sessions.length)
        onDragEnd()
      }}
    >
      {sessions.map((s, i) => {
        const isActive = activeSessionId === s.id
        const isSplit = splitId === s.id
        const isDrag = dragId === s.id
        const showBefore = overId === s.id && overEdge === 'before' && dragId !== s.id
        const showAfter = overId === s.id && overEdge === 'after' && dragId !== s.id

        return (
          <div key={s.id} className="tab-slot">
            {showBefore && <div className="tab-drop-indicator" />}
            <div
              role="tab"
              aria-selected={isActive}
              draggable
              className={[
                'tab',
                isActive ? 'active' : '',
                isSplit ? 'split-peer' : '',
                isDrag ? 'dragging' : '',
                s.status === 'exited' ? 'exited' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => {
                // Double-click: toggle split with this tab (if another is active)
                if (activeSessionId && activeSessionId !== s.id) {
                  onSplitWith(s.id)
                } else {
                  onClearSplit()
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(s.id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: s.id, x: e.clientX, y: e.clientY })
              }}
              onDragStart={(e) => onDragStart(e, s.id)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOverTab(e, s.id)}
              onDragLeave={() => {
                if (overId === s.id) {
                  setOverId(null)
                  setOverEdge(null)
                }
              }}
              onDrop={(e) => onDropTab(e, s.id)}
              title={`${s.agentName} · drag to reorder · dbl-click split · middle-click close · Alt+${i + 1}`}
            >
              <span className="tab-grip" aria-hidden title="Drag">
                ⋮⋮
              </span>
              <span className="dot" style={{ background: s.color }} />
              <span className="label">{s.agentName}</span>
              {s.status === 'exited' && <span className="badge">exit</span>}
              {isSplit && <span className="badge split-badge">split</span>}
              <button
                type="button"
                className="x"
                aria-label={`Close ${s.agentName}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(s.id)
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                ×
              </button>
            </div>
            {showAfter && <div className="tab-drop-indicator" />}
          </div>
        )
      })}

      <button type="button" className="tab-add" title="New agent (Ctrl+Shift+A)" onClick={onNew}>
        +
      </button>
      {sessions.length > 0 && (
        <button type="button" className="tab-add" title="Close all tabs" onClick={onCloseAll}>
          clear
        </button>
      )}
      {splitId && (
        <button type="button" className="tab-add" title="Exit split view" onClick={onClearSplit}>
          unsplit
        </button>
      )}

      {menu && (
        <>
          <div className="tab-menu-backdrop" onClick={() => setMenu(null)} />
          <div
            className="tab-context-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            {(() => {
              const s = sessions.find((x) => x.id === menu.id)
              if (!s) return null
              return (
                <>
                  <div className="tab-menu-title">{s.agentName}</div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelect(s.id)
                      setMenu(null)
                    }}
                  >
                    Focus
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!activeSessionId || activeSessionId === s.id}
                    onClick={() => {
                      onSplitWith(s.id)
                      setMenu(null)
                    }}
                  >
                    Split with active
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const idx = sessions.findIndex((x) => x.id === s.id)
                      onReorder(s.id, 0)
                      setMenu(null)
                    }}
                  >
                    Move to start
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onReorder(s.id, sessions.length)
                      setMenu(null)
                    }}
                  >
                    Move to end
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      onClose(s.id)
                      setMenu(null)
                    }}
                  >
                    Close tab
                  </button>
                </>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}
