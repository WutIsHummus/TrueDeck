import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ProjectConfig, SessionInfo } from '../../electron/shared/types'
import { sameProjectRoot } from '../lib/paths'
import { CloseIcon } from './CloseIcon'

interface Props {
  projects: ProjectConfig[]
  openedIds: string[]
  activeProject: ProjectConfig | null
  sessions: SessionInfo[]
  onSelect: (p: ProjectConfig) => void
  onCloseTab: (p: ProjectConfig) => void
}

function liveFor(sessions: SessionInfo[], root: string): SessionInfo[] {
  return sessions.filter(
    (s) => s.status === 'running' && sameProjectRoot(s.projectRoot, root)
  )
}

function accent(p: ProjectConfig, live: SessionInfo[]): string {
  return p.color || live[0]?.color || '#f0a050'
}

/**
 * Chrome-style project tabs in the title bar. Click to switch; × dismisses
 * the tab without killing background PTYs.
 */
export function ProjectTabBar({
  projects,
  openedIds,
  activeProject,
  sessions,
  onSelect,
  onCloseTab
}: Props): JSX.Element | null {
  const tabs = openedIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is ProjectConfig => Boolean(p))

  if (!tabs.length) return null

  return (
    <div className="project-tabbar no-drag" role="tablist" aria-label="Open projects">
      {tabs.map((p) => {
        const live = liveFor(sessions, p.root)
        const active = activeProject?.id === p.id
        const canClose = tabs.length > 1
        const color = accent(p, live)
        return (
          <div
            key={p.id}
            className={`project-tab${active ? ' active' : ''}${live.length ? ' live' : ''}`}
            role="tab"
            aria-selected={active}
            title={
              live.length
                ? `${p.root}\n${live.length} terminal${live.length === 1 ? '' : 's'} running`
                : p.root
            }
            onClick={() => {
              if (!active) onSelect(p)
            }}
            onAuxClick={(e: ReactMouseEvent) => {
              if (e.button === 1 && canClose) {
                e.preventDefault()
                onCloseTab(p)
              }
            }}
            style={{ ['--project-tab-accent' as string]: color }}
          >
            <span className="project-tab-dot" aria-hidden />
            <span className="project-tab-name">{p.name}</span>
            {live.length > 0 && (
              <span className="project-tab-live">{live.length}</span>
            )}
            {canClose && (
              <button
                type="button"
                className="project-tab-close"
                title="Close project tab (terminals keep running)"
                aria-label={`Close ${p.name} tab`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(p)
                }}
              >
                <CloseIcon size={8} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
