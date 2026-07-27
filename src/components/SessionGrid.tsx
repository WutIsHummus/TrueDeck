import type { SessionInfo } from '../../electron/shared/types'
import { TerminalPane } from './TerminalPane'

interface Props {
  sessions: SessionInfo[]
  activeSessionId: string | null
  layoutMode: 'tabs' | 'grid'
  onFocus: (id: string) => void
  onClose: (id: string) => void
}

function gridTemplate(count: number): string {
  if (count <= 1) return '1fr'
  if (count === 2) return '1fr 1fr'
  if (count === 3) return '1fr 1fr'
  if (count === 4) return '1fr 1fr'
  if (count <= 6) return '1fr 1fr 1fr'
  return '1fr 1fr 1fr'
}

function gridRows(count: number): string {
  if (count <= 2) return '1fr'
  if (count <= 4) return '1fr 1fr'
  if (count <= 6) return '1fr 1fr'
  return '1fr 1fr 1fr'
}

export function SessionGrid({
  sessions,
  activeSessionId,
  layoutMode,
  onFocus,
  onClose
}: Props): JSX.Element {
  if (sessions.length === 0) {
    return (
      <div className="empty-state">
        <div>
          <h3>Agent deck is empty</h3>
          <p>
            Open a project, then launch Grok, Codex, Claude, Cursor, Gemini, or a shell. Switch
            between <strong>Tabs</strong> and <strong>Grid</strong> in the toolbar to see multiple
            agents at once.
          </p>
        </div>
      </div>
    )
  }

  if (layoutMode === 'tabs') {
    return (
      <div className="terminal-host tabs-mode">
        {sessions.map((s) => (
          <TerminalPane
            key={s.id}
            sessionId={s.id}
            visible={activeSessionId === s.id}
          />
        ))}
      </div>
    )
  }

  const cols = gridTemplate(sessions.length)
  const rows = gridRows(sessions.length)

  return (
    <div
      className="session-grid"
      style={{
        gridTemplateColumns: cols,
        gridTemplateRows: rows
      }}
    >
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`grid-cell ${activeSessionId === s.id ? 'focused' : ''}`}
          onMouseDown={() => onFocus(s.id)}
        >
          <div className="grid-cell-header" style={{ borderTopColor: s.color }}>
            <span className="dot" style={{ background: s.color }} />
            <span className="grid-cell-title">{s.agentName}</span>
            {s.status === 'exited' && <span className="badge">exit</span>}
            <button
              type="button"
              className="tab-close grid-close"
              title="Close tab (Ctrl+Shift+W)"
              aria-label={`Close ${s.agentName}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose(s.id)
              }}
            >
              ×
            </button>
          </div>
          <div className="grid-cell-body">
            <TerminalPane sessionId={s.id} visible />
          </div>
        </div>
      ))}
    </div>
  )
}
