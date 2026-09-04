import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref
} from 'react'
import type { ProjectConfig, SessionInfo } from '../../electron/shared/types'
import { projectRootKey, sameProjectRoot } from '../lib/paths'

interface Props {
  open: boolean
  projects: ProjectConfig[]
  sessions: SessionInfo[]
  activeProject: ProjectConfig | null
  shortPath: (p: string) => string
  query: string
  highlight: number
  onQuery: (q: string) => void
  onHighlight: (i: number) => void
  onPick: (p: ProjectConfig) => void
  onClose: () => void
  searchRef: Ref<HTMLInputElement>
}

function liveCount(sessions: SessionInfo[], root: string): number {
  return sessions.filter(
    (s) => s.status === 'running' && sameProjectRoot(s.projectRoot, root)
  ).length
}

export function ProjectSwitcher({
  open,
  projects,
  sessions,
  activeProject,
  shortPath,
  query,
  highlight,
  onQuery,
  onHighlight,
  onPick,
  onClose,
  searchRef
}: Props): JSX.Element | null {
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const ranked = [...projects].sort((a, b) => {
      const la = liveCount(sessions, a.root)
      const lb = liveCount(sessions, b.root)
      if (la !== lb) return lb - la
      return (b.lastOpened || 0) - (a.lastOpened || 0)
    })
    if (!q) return ranked
    return ranked.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.root.toLowerCase().includes(q) ||
        projectRootKey(p.root).includes(q)
    )
  }, [projects, sessions, query])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open, filtered.length])

  if (!open) return null

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette project-switcher" role="dialog" aria-label="Switch project">
        <div className="palette-header">
          <input
            ref={searchRef}
            className="palette-search"
            placeholder="Switch project — background terminals keep running"
            value={query}
            onChange={(e) => {
              onQuery(e.target.value)
              onHighlight(0)
            }}
            autoFocus
            onKeyDown={(e: ReactKeyboardEvent) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                onHighlight(Math.min(highlight + 1, Math.max(0, filtered.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                onHighlight(Math.max(highlight - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const p = filtered[highlight]
                if (p) onPick(p)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
          <span className="palette-hint">
            <kbd>Ctrl+P</kbd> · Enter switch · Esc
          </span>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {filtered.length === 0 && (
            <div className="palette-empty muted">No projects match</div>
          )}
          {filtered.map((p, i) => {
            const n = liveCount(sessions, p.root)
            const active = activeProject?.id === p.id
            const color = p.color
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                data-idx={i}
                aria-selected={i === highlight}
                className={`palette-item${i === highlight ? ' highlight' : ''}${active ? ' active' : ''}`}
                onMouseEnter={() => onHighlight(i)}
                onClick={() => onPick(p)}
              >
                <span
                  className="project-switcher-dot"
                  style={{ background: color || (n > 0 ? '#22c55e' : '#3f3f3f') }}
                />
                <span className="name">
                  {active ? '✓ ' : ''}
                  {p.name}
                </span>
                <span className="sub">
                  {n > 0 ? `${n} live · ${shortPath(p.root)}` : shortPath(p.root)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
