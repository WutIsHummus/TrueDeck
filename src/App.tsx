import { useEffect, useMemo, useState } from 'react'
import { useDeck } from './store'
import { TerminalPane } from './components/TerminalPane'
import { MemoryPanel } from './components/MemoryPanel'
import { OnOpenModal } from './components/OnOpenModal'
import type { ProjectConfig } from '../electron/shared/types'

export default function App(): JSX.Element {
  const {
    projects,
    agents,
    activeProjectId,
    sessions,
    activeSessionId,
    status,
    refreshProjects,
    refreshAgents,
    setActiveProject,
    addSession,
    removeSession,
    setActiveSession,
    markSessionExited,
    setStatus,
    refreshMemory
  } = useDeck()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [onOpenProject, setOnOpenProject] = useState<ProjectConfig | null>(null)

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  )

  const projectSessions = useMemo(
    () =>
      sessions.filter((s) =>
        activeProject ? s.projectRoot === activeProject.root : true
      ),
    [sessions, activeProject]
  )

  useEffect(() => {
    void (async () => {
      await refreshProjects()
      await refreshAgents()
      // bootstrap known SPTS path if present
      try {
        const spts = 'C:\\Users\\alper\\SPTS'
        const list = await window.truedeck.listProjects()
        if (!list.some((p) => p.root === spts)) {
          // don't auto-add silently beyond first run convenience — skip
        }
      } catch {
        // ignore
      }
    })()

    const offSpawn = window.truedeck.onPtySpawned((info) => addSession(info))
    const offExit = window.truedeck.onPtyExit(({ id, exitCode }) => {
      markSessionExited(id, exitCode)
    })
    return () => {
      offSpawn()
      offExit()
    }
  }, [addSession, markSessionExited, refreshAgents, refreshProjects])

  const addProject = async (): Promise<void> => {
    const p = await window.truedeck.addProject()
    if (!p) return
    await refreshProjects()
    setActiveProject(p.id)
    setOnOpenProject(p)
    setStatus(`Added ${p.name}`)
  }

  const openProject = async (p: ProjectConfig): Promise<void> => {
    setActiveProject(p.id)
    setStatus(`Opening ${p.name}…`)
    try {
      const res = await window.truedeck.openProject(p.id)
      for (const id of res.sessionIds) {
        // sessions arrive via event too; ensure list
        const all = await window.truedeck.listSessions()
        const found = all.find((s) => s.id === id)
        if (found) addSession(found)
      }
      await refreshMemory()
      setStatus(`Opened ${p.name}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const launchAgent = async (agentId: string): Promise<void> => {
    if (!activeProject) {
      setStatus('Select a project first')
      return
    }
    try {
      const info = await window.truedeck.spawnSession({
        projectRoot: activeProject.root,
        agentId
      })
      addSession(info)
      setStatus(`Launched ${info.agentName}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const closeSession = async (id: string): Promise<void> => {
    await window.truedeck.killSession(id)
    removeSession(id)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TD</div>
          <div>
            <h1>TrueDeck</h1>
            <p>Multi-agent workbench</p>
          </div>
        </div>

        <div className="section" style={{ flex: 1 }}>
          <div className="section-header">
            <h2>Projects</h2>
            <button className="primary" onClick={() => void addProject()}>
              + Open
            </button>
          </div>
          <div className="project-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-item ${activeProjectId === p.id ? 'active' : ''}`}
                onClick={() => void openProject(p)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setOnOpenProject(p)
                }}
              >
                <span className="dot" style={{ background: p.color || '#22d3ee' }} />
                <div className="meta">
                  <div className="name">{p.name}</div>
                  <div className="path">{p.root}</div>
                </div>
              </button>
            ))}
            {projects.length === 0 && (
              <div className="muted">Open a folder to get started.</div>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-header">
            <h2>Agents</h2>
            <button className="ghost" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙
            </button>
          </div>
          <div className="agent-list">
            {agents.map((a) => (
              <button
                key={a.id}
                className="agent-chip"
                title={a.description || a.command}
                onClick={() => void launchAgent(a.id)}
                disabled={!activeProject}
              >
                <span className="dot" style={{ background: a.color }} />
                <span style={{ fontWeight: 600 }}>{a.icon}</span>
                <span>{a.name}</span>
              </button>
            ))}
          </div>
          <p className="hint">
            Click an agent to open a new tab. Right-click a project to edit on-open commands
            (rojo serve, etc.). Speech: use Handy or Win+H into the focused terminal.
          </p>
        </div>

        <div className="section" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="muted">{status}</div>
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <strong>{activeProject?.name || 'No project'}</strong>
          {activeProject && (
            <span className="badge" title={activeProject.root}>
              {activeProject.root}
            </span>
          )}
          <div className="spacer" />
          {activeProject && (
            <>
              <button onClick={() => setOnOpenProject(activeProject)}>On open…</button>
              <button
                className="primary"
                onClick={() => void launchAgent('grok')}
                title="Launch Grok Build"
              >
                + Grok
              </button>
              <button onClick={() => void launchAgent('codex')}>+ Codex</button>
              <button onClick={() => void launchAgent('claude')}>+ Claude</button>
              <button onClick={() => void launchAgent('cursor')}>+ Cursor</button>
              <button onClick={() => void launchAgent('gemini')}>+ Gemini</button>
              <button onClick={() => void launchAgent('shell')}>+ Shell</button>
            </>
          )}
        </div>

        {projectSessions.length > 0 && (
          <div className="tabs">
            {projectSessions.map((s) => (
              <button
                key={s.id}
                className={`session-tab ${activeSessionId === s.id ? 'active' : ''}`}
                onClick={() => setActiveSession(s.id)}
              >
                <span className="dot" style={{ background: s.color }} />
                {s.agentName}
                {s.status === 'exited' && <span className="badge">exit</span>}
                <span
                  className="close"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeSession(s.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void closeSession(s.id)
                  }}
                >
                  ✕
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="terminal-host">
          {projectSessions.length === 0 ? (
            <div className="empty-state">
              <div>
                <h3>Agent deck is empty</h3>
                <p>
                  Open a project on the left, then launch Grok, Codex, Claude, Cursor, Gemini,
                  or a plain shell. Each tab is a real terminal — click to focus, type or use
                  speech-to-text (Handy / Win+H).
                </p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="primary" onClick={() => void addProject()}>
                    Open project folder
                  </button>
                </div>
              </div>
            </div>
          ) : (
            projectSessions.map((s) => (
              <TerminalPane
                key={s.id}
                sessionId={s.id}
                visible={activeSessionId === s.id}
              />
            ))
          )}
        </div>
      </main>

      <MemoryPanel />

      {onOpenProject && (
        <OnOpenModal
          project={onOpenProject}
          onClose={() => setOnOpenProject(null)}
          onSaved={(p) => {
            void refreshProjects()
            setStatus(`Updated on-open for ${p.name}`)
          }}
        />
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>TrueDeck</h3>
            <p className="hint">
              Free, open-source multi-agent coding deck with TrueMemory (per-repo{' '}
              <code>.memory/</code> + global cross-project memory).
            </p>
            <p className="hint">
              Install CLI agents on PATH: <code>grok</code>, <code>codex</code>,{' '}
              <code>claude</code>, <code>gemini</code>, <code>cursor</code>, etc. Customize
              commands in app data <code>agents.json</code>.
            </p>
            <p className="hint">
              Speech-to-text: install{' '}
              <a href="https://github.com/cjpais/Handy" style={{ color: 'var(--accent)' }}>
                Handy
              </a>{' '}
              (<code>winget install cjpais.Handy</code>) or use Win+H.
            </p>
            <div className="actions">
              <button
                onClick={() => {
                  void window.truedeck.resetAgents().then(() => refreshAgents())
                }}
              >
                Reset agent presets
              </button>
              <button className="primary" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
