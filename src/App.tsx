import { useEffect, useMemo, useState } from 'react'
import { useDeck } from './store'
import { SessionGrid } from './components/SessionGrid'
import { MemoryPanel } from './components/MemoryPanel'
import { OnOpenModal } from './components/OnOpenModal'
import type { AppSettings, LayoutMode, ProjectConfig } from '../electron/shared/types'

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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid')
  const [autoGrid, setAutoGrid] = useState(true)
  const [version, setVersion] = useState('0.2.0')
  const [seedBanner, setSeedBanner] = useState<string | null>(null)

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  )

  const projectSessions = useMemo(
    () =>
      sessions.filter((s) => (activeProject ? s.projectRoot === activeProject.root : true)),
    [sessions, activeProject]
  )

  const persistLayout = async (mode: LayoutMode, auto = autoGrid): Promise<void> => {
    setLayoutMode(mode)
    try {
      const current = await window.truedeck.getSettings()
      await window.truedeck.setSettings({
        ...current,
        layoutMode: mode,
        autoGrid: auto
      })
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void (async () => {
      await refreshProjects()
      await refreshAgents()
      try {
        const settings = await window.truedeck.getSettings()
        setLayoutMode(settings.layoutMode || 'grid')
        setAutoGrid(settings.autoGrid !== false)
        const v = await window.truedeck.version()
        setVersion(v)
      } catch {
        // ignore
      }

      try {
        const result = await window.truedeck.firstRun()
        if (result.firstRun) {
          await refreshProjects()
          if (result.seeded.length > 0) {
            setSeedBanner(
              `Seeded ${result.seeded.map((p) => p.name).join(', ')} — click a project to open agents.`
            )
          } else {
            setSeedBanner('Welcome to TrueDeck — open a project folder to start.')
          }
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

  // Auto-switch to grid when multiple panes appear
  useEffect(() => {
    if (autoGrid && projectSessions.length >= 2 && layoutMode === 'tabs') {
      void persistLayout('grid')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSessions.length, autoGrid])

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
    setSeedBanner(null)
    try {
      const res = await window.truedeck.openProject(p.id)
      for (const id of res.sessionIds) {
        const all = await window.truedeck.listSessions()
        const found = all.find((s) => s.id === id)
        if (found) addSession(found)
      }
      await refreshMemory()
      if (autoGrid && res.sessionIds.length >= 2) {
        await persistLayout('grid')
      }
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
      if (autoGrid && projectSessions.length >= 1) {
        await persistLayout('grid')
      }
      setStatus(`Launched ${info.agentName}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const closeSession = async (id: string): Promise<void> => {
    try {
      await window.truedeck.killSession(id)
    } catch {
      // still remove from UI if process already dead
    }
    removeSession(id)
    setStatus('Tab closed')
  }

  // Ctrl+W / Ctrl+F4 closes active tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const wantClose =
        ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) ||
        (e.ctrlKey && e.key === 'F4')
      if (!wantClose || !activeSessionId) return
      e.preventDefault()
      void (async () => {
        try {
          await window.truedeck.killSession(activeSessionId)
        } catch {
          // ignore
        }
        removeSession(activeSessionId)
        setStatus('Tab closed')
      })()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSessionId, removeSession, setStatus])

  const saveSettingsPatch = async (patch: Partial<AppSettings>): Promise<void> => {
    const current = await window.truedeck.getSettings()
    const next = { ...current, ...patch }
    await window.truedeck.setSettings(next)
    setLayoutMode(next.layoutMode)
    setAutoGrid(next.autoGrid)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TD</div>
          <div>
            <h1>TrueDeck</h1>
            <p>Multi-agent workbench · v{version}</p>
          </div>
        </div>

        <div className="section" style={{ flex: 1 }}>
          <div className="section-header">
            <h2>Projects</h2>
            <button className="primary" onClick={() => void addProject()}>
              + Open
            </button>
          </div>
          {seedBanner && <p className="hint">{seedBanner}</p>}
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
            Grid shows all agents at once. Right-click a project for on-open commands (rojo serve).
            Speech: Handy or Win+H into the focused pane.
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
          <div className="layout-toggle" title="Layout mode">
            <button
              className={layoutMode === 'tabs' ? 'active' : ''}
              onClick={() => void persistLayout('tabs')}
            >
              Tabs
            </button>
            <button
              className={layoutMode === 'grid' ? 'active' : ''}
              onClick={() => void persistLayout('grid')}
            >
              Grid
            </button>
          </div>
          <div className="spacer" />
          {activeProject && (
            <>
              <button onClick={() => setOnOpenProject(activeProject)}>On open…</button>
              <button className="primary" onClick={() => void launchAgent('grok')}>
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
          <div className="tabs" role="tablist">
            {projectSessions.map((s) => (
              <div
                key={s.id}
                role="tab"
                aria-selected={activeSessionId === s.id}
                className={`session-tab ${activeSessionId === s.id ? 'active' : ''}`}
                onClick={() => setActiveSession(s.id)}
                onMouseDown={(e) => {
                  // Middle-click closes tab (browser-style)
                  if (e.button === 1) {
                    e.preventDefault()
                    e.stopPropagation()
                    void closeSession(s.id)
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    void closeSession(s.id)
                  }
                }}
              >
                <span className="dot" style={{ background: s.color }} />
                <span className="session-tab-label">{s.agentName}</span>
                {s.status === 'exited' && <span className="badge">exit</span>}
                <button
                  type="button"
                  className="tab-close"
                  title="Close tab (Ctrl+W)"
                  aria-label={`Close ${s.agentName}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void closeSession(s.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="session-tab tab-close-all"
              title="Close all tabs"
              onClick={() => {
                void (async () => {
                  for (const s of [...projectSessions]) {
                    await closeSession(s.id)
                  }
                })()
              }}
            >
              Close all
            </button>
          </div>
        )}

        {projectSessions.length === 0 ? (
          <div className="terminal-host">
            <div className="empty-state">
              <div>
                <h3>Agent deck is empty</h3>
                <p>
                  Open a project on the left, then launch Grok, Codex, Claude, Cursor, Gemini, or a
                  shell. Use <strong>Grid</strong> to see multiple agents side by side.
                </p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="primary" onClick={() => void addProject()}>
                    Open project folder
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <SessionGrid
            sessions={projectSessions}
            activeSessionId={activeSessionId}
            layoutMode={layoutMode}
            onFocus={setActiveSession}
            onClose={(id) => void closeSession(id)}
          />
        )}
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
            <h3>TrueDeck v{version}</h3>
            <p className="hint">
              Free multi-agent coding deck with TrueMemory (per-repo <code>.memory/</code> + global
              cross-project memory).
            </p>
            <div className="onopen-list" style={{ marginTop: 8 }}>
              <label className="row muted">
                <input
                  type="checkbox"
                  checked={autoGrid}
                  onChange={(e) => {
                    setAutoGrid(e.target.checked)
                    void saveSettingsPatch({ autoGrid: e.target.checked })
                  }}
                />
                Auto-switch to Grid when 2+ agents are open
              </label>
            </div>
            <p className="hint">
              Cursor uses the <code>cursor-agent</code> CLI when installed, else{' '}
              <code>cursor agent</code>, else opens Cursor IDE.
            </p>
            <p className="hint">
              Speech-to-text:{' '}
              <a href="https://github.com/cjpais/Handy" style={{ color: 'var(--accent)' }}>
                Handy
              </a>{' '}
              (<code>winget install cjpais.Handy</code>) or Win+H.
            </p>
            <p className="hint">
              GitHub:{' '}
              <a
                href="https://github.com/WutIsHummus/TrueDeck"
                style={{ color: 'var(--accent)' }}
              >
                WutIsHummus/TrueDeck
              </a>
            </p>
            <div className="actions">
              <button
                onClick={() => {
                  void window.truedeck.resetAgents().then(() => refreshAgents())
                }}
              >
                Reset agent presets
              </button>
              <button
                onClick={() => {
                  void window.truedeck.firstRun(true).then(async (r) => {
                    await refreshProjects()
                    setStatus(
                      r.seeded.length
                        ? `Re-seeded: ${r.seeded.map((p) => p.name).join(', ')}`
                        : 'No new projects to seed'
                    )
                  })
                }}
              >
                Re-seed local projects
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
