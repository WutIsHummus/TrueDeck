import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDeck } from './store'
import { TerminalPane } from './components/TerminalPane'
import { OnOpenModal } from './components/OnOpenModal'
import { SettingsMenu } from './components/SettingsMenu'
import { TabBar } from './components/TabBar'
import { Onboarding } from './components/Onboarding'
import type { AgentPreset, AppSettings, ProjectConfig } from '../electron/shared/types'

/**
 * Studio layout - between Codex TUI and raw CLI.
 * Memory is fully automatic (no user management UI).
 */
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
    moveSessionInProject,
    setStatus
  } = useDeck()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [onOpenProject, setOnOpenProject] = useState<ProjectConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [splitId, setSplitId] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [memLabel, setMemLabel] = useState('mem·auto')
  const [fontSize, setFontSize] = useState(13)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [updateInfo, setUpdateInfo] = useState<{
    updateAvailable: boolean
    latestVersion: string | null
    releaseUrl: string | null
    downloadUrl: string | null
    currentVersion: string
  } | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  )

  const projectSessions = useMemo(
    () =>
      sessions.filter((s) => (activeProject ? s.projectRoot === activeProject.root : true)),
    [sessions, activeProject]
  )

  const filteredAgents = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.command.toLowerCase().includes(q)
    )
  }, [agents, paletteQuery])

  const closeSession = useCallback(
    async (id: string) => {
      try {
        await window.truedeck.killSession(id)
      } catch {
        // ignore
      }
      removeSession(id)
      if (splitId === id) setSplitId(null)
      setStatus('Tab closed')
    },
    [removeSession, setStatus, splitId]
  )

  const applySettings = useCallback((s: AppSettings) => {
    setFontSize(s.fontSize || 13)
    setTheme(s.theme || 'dark')
    document.documentElement.classList.toggle('theme-light', s.theme === 'light')
  }, [])

  useEffect(() => {
    void (async () => {
      await refreshProjects()
      await refreshAgents()
      try {
        const v = await window.truedeck.version()
        setVersion(v)
      } catch {
        // ignore
      }
      try {
        const s = await window.truedeck.getSettings()
        applySettings(s)
        if (s.reopenLastProject !== false) {
          const list = await window.truedeck.listProjects()
          if (list[0]) {
            // soft-select last project without auto-spawning agents
            setActiveProject(list[0].id)
          }
        }
      } catch {
        // ignore
      }
      try {
        const result = await window.truedeck.firstRun()
        if (result.firstRun && result.seeded.length) {
          setStatus(`Ready · seeded ${result.seeded.map((p) => p.name).join(', ')}`)
          await refreshProjects()
        }
      } catch {
        // ignore
      }
      // First-run onboarding (walkthrough)
      try {
        const ob = await window.truedeck.getOnboarding()
        if (!ob.completed) setOnboardingOpen(true)
      } catch {
        // ignore
      }
      // Background release check
      try {
        const u = await window.truedeck.checkUpdates(false)
        setUpdateInfo({
          updateAvailable: u.updateAvailable,
          latestVersion: u.latestVersion,
          releaseUrl: u.releaseUrl,
          downloadUrl: u.downloadUrl,
          currentVersion: u.currentVersion
        })
        if (u.updateAvailable && u.latestVersion) {
          setStatus(`Update available: v${u.latestVersion}`)
        }
      } catch {
        // ignore offline
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
  }, [addSession, markSessionExited, refreshAgents, refreshProjects, setStatus])

  /**
   * Simple shortcuts: Ctrl + letter (no Shift).
   *   Ctrl+A agents · Ctrl+O project · Ctrl+W close · Ctrl+S settings
   *   Ctrl+T next tab · Ctrl+D split · Ctrl+N shell · Ctrl+1–9 jump
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
        setPaletteOpen(false)
        return
      }

      const ctrl = e.ctrlKey || e.metaKey
      // Require Ctrl, ignore when Shift/Alt held (except Ctrl+Shift+Tab handled below)
      if (!ctrl) return

      const key = e.key.toLowerCase()
      const letter = key.length === 1 ? key : ''

      // Don't steal typing when user is in a normal text field (settings/onboarding)
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      const typing =
        tag === 'input' || tag === 'textarea' || (t as HTMLElement)?.isContentEditable
      if (typing && key !== 'Escape') return

      // Agents: Ctrl+A
      if (letter === 'a' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        setSettingsOpen(false)
        setPaletteOpen(true)
        setPaletteQuery('')
        setPaletteIndex(0)
        return
      }

      // Open project: Ctrl+O
      if (letter === 'o' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        void addProject()
        return
      }

      // Close tab: Ctrl+W
      if (letter === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        if (activeSessionId) void closeSession(activeSessionId)
        return
      }

      // Settings: Ctrl+S
      if (letter === 's' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        setPaletteOpen(false)
        setSettingsOpen(true)
        return
      }

      // Next tab: Ctrl+T  |  Previous: Ctrl+Shift+Tab or Ctrl+Tab reverse via Shift
      if ((letter === 't' && !e.shiftKey && !e.altKey) || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (!projectSessions.length) return
        const idx = projectSessions.findIndex((s) => s.id === activeSessionId)
        const goPrev = e.key === 'Tab' && e.shiftKey
        const nextIdx = goPrev
          ? (idx - 1 + projectSessions.length) % projectSessions.length
          : (idx + 1) % projectSessions.length
        setActiveSession(projectSessions[nextIdx]?.id || null)
        return
      }

      // Split: Ctrl+D
      if (letter === 'd' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        if (projectSessions.length < 2) {
          setStatus('Need 2 tabs to split')
          return
        }
        const other = projectSessions.find((s) => s.id !== activeSessionId)
        setSplitId((cur) => (cur ? null : other?.id || null))
        return
      }

      // New shell: Ctrl+N
      if (letter === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        void launchAgent('shell')
        return
      }

      // Jump tab: Ctrl+1..9
      if (!e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        e.stopPropagation()
        const s = projectSessions[Number(e.key) - 1]
        if (s) setActiveSession(s.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, projectSessions, closeSession, setActiveSession, setStatus])

  const addProject = async (): Promise<void> => {
    const p = await window.truedeck.addProject()
    if (!p) return
    await refreshProjects()
    setActiveProject(p.id)
    setOnOpenProject(p)
    setStatus(`Project ${p.name}`)
  }

  const openProject = async (p: ProjectConfig): Promise<void> => {
    setActiveProject(p.id)
    setStatus(`Opening ${p.name}...`)
    try {
      const res = await window.truedeck.openProject(p.id)
      for (const id of res.sessionIds) {
        const all = await window.truedeck.listSessions()
        const found = all.find((s) => s.id === id)
        if (found) addSession(found)
      }
      if (res.memory?.label) setMemLabel(`mem·${res.memory.label}`)
      else {
        try {
          const m = await window.truedeck.memoryStatus(p.root)
          setMemLabel(`mem·${m.label}`)
        } catch {
          setMemLabel('mem·auto')
        }
      }
      setStatus(`${p.name} ready`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const launchAgent = async (agentId: string): Promise<void> => {
    if (!activeProject) {
      setStatus('Pick a project first (Ctrl+O)')
      setPaletteOpen(false)
      return
    }
    try {
      const info = await window.truedeck.spawnSession({
        projectRoot: activeProject.root,
        agentId
      })
      addSession(info)
      setPaletteOpen(false)
      setStatus(`→ ${info.agentName}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const shortPath = (p: string): string => {
    const home = (window as unknown as { __home?: string }).__home
    if (home && p.startsWith(home)) return '~' + p.slice(home.length)
    return p.length > 52 ? '...' + p.slice(-50) : p
  }

  const paletteSelect = (agent: AgentPreset): void => {
    void launchAgent(agent.id)
  }

  return (
    <div className="studio">
      {/* Title - minimal */}
      <header className="titlebar">
        <span className="logo">TRUEDECK{version ? ` ${version}` : ''}</span>
        <button
          type="button"
          className="project-chip no-drag"
          title="Open project (Ctrl+O)"
          onClick={() => void addProject()}
        >
          <span className="dot" />
          {activeProject ? shortPath(activeProject.root) : 'open project...'}
        </button>
        {projects.length > 1 && (
          <select
            className="no-drag"
            style={{
              background: '#0a0a0a',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '2px 6px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              maxWidth: 160
            }}
            value={activeProjectId || ''}
            onChange={(e) => {
              const p = projects.find((x) => x.id === e.target.value)
              if (p) void openProject(p)
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="spacer" />
        <span
          className="meta no-drag mem-badge"
          title="Automatic memory status (not a control). TrueDeck keeps project context for agents - you don't manage notes or Docker here."
        >
          {memLabel}
        </span>
        <button
          type="button"
          className="no-drag primary"
          title="Choose an agent (Ctrl+A)"
          disabled={!activeProject}
          onClick={() => setPaletteOpen(true)}
        >
          + agent
        </button>
        {updateInfo?.updateAvailable && (
          <button
            type="button"
            className="no-drag update-btn"
            title={
              updateInfo.latestVersion
                ? `v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`
                : 'New release available'
            }
            onClick={() => {
              const url =
                updateInfo.downloadUrl ||
                updateInfo.releaseUrl ||
                'https://github.com/WutIsHummus/TrueDeck/releases/latest'
              void window.truedeck.openExternal(url)
            }}
          >
            Update{updateInfo.latestVersion ? ` v${updateInfo.latestVersion}` : ''}
          </button>
        )}
        <button
          type="button"
          className="no-drag settings-gear"
          title="Settings (Ctrl+S)"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
        <button
          type="button"
          className="no-drag settings-gear"
          title="Replay onboarding"
          aria-label="Help"
          onClick={() => setOnboardingOpen(true)}
        >
          ?
        </button>
      </header>

      <TabBar
        sessions={projectSessions}
        activeSessionId={activeSessionId}
        splitId={splitId}
        onSelect={setActiveSession}
        onClose={(id) => void closeSession(id)}
        onReorder={(id, toIndex) => {
          if (!activeProject) return
          moveSessionInProject(id, toIndex, activeProject.root)
          setStatus('Tabs reordered')
        }}
        onSplitWith={(id) => {
          setSplitId(id)
          setStatus('Split view')
        }}
        onClearSplit={() => {
          setSplitId(null)
          setStatus('Split off')
        }}
        onNew={() => setPaletteOpen(true)}
        onCloseAll={() => {
          void (async () => {
            for (const s of [...projectSessions]) await closeSession(s.id)
          })()
        }}
      />

      {/* Terminal stage - drop a tab here to split */}
      <main
        className={`stage ${splitId ? 'split' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/truedeck-tab') || e.dataTransfer.types.includes('text/plain')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'link'
            e.currentTarget.classList.add('drop-target')
          }
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove('drop-target')
        }}
        onDrop={(e) => {
          e.currentTarget.classList.remove('drop-target')
          const id =
            e.dataTransfer.getData('text/truedeck-tab') || e.dataTransfer.getData('text/plain')
          if (!id || id === activeSessionId) return
          e.preventDefault()
          setActiveSession(activeSessionId || id)
          setSplitId(id === activeSessionId ? null : id)
          setStatus('Split view (dropped tab)')
        }}
      >
        {projectSessions.length === 0 ? (
          <div className="stage-empty">
            <div>
              <h2>truedeck</h2>
              <p>
                Terminal-first agent deck - between Codex and a plain CLI.
                <br />
                <kbd>Ctrl+O</kbd> project · <kbd>Ctrl+A</kbd> agents · <kbd>Ctrl+W</kbd> close tab
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="primary" onClick={() => void addProject()}>
                  Open project
                </button>
                <button type="button" onClick={() => setPaletteOpen(true)} disabled={!activeProject}>
                  Launch agent
                </button>
              </div>
              {projects.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    recent
                  </div>
                  {projects.slice(0, 5).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
                      onClick={() => void openProject(p)}
                    >
                      {p.name}{' '}
                      <span className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {shortPath(p.root)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : splitId ? (
          <>
            {projectSessions
              .filter((s) => s.id === activeSessionId || s.id === splitId)
              .map((s) => (
                <div key={s.id} className="term-stack">
                  <TerminalPane sessionId={s.id} visible fontSize={fontSize} />
                </div>
              ))}
          </>
        ) : (
          <div className="term-stack">
            {projectSessions.map((s) => (
              <TerminalPane
                key={s.id}
                sessionId={s.id}
                visible={activeSessionId === s.id}
                fontSize={fontSize}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="statusbar">
        <div className="hint" title="Hold Ctrl, then press a letter">
          <span title="Ctrl+A — agent list">
            <kbd>Ctrl+A</kbd> agents
          </span>
          <span title="Ctrl+O — open project">
            <kbd>Ctrl+O</kbd> project
          </span>
          <span title="Ctrl+W — close tab">
            <kbd>Ctrl+W</kbd> close
          </span>
          <span title="Ctrl+S — settings">
            <kbd>Ctrl+S</kbd> settings
          </span>
          <span title="Ctrl+T — next tab">
            <kbd>Ctrl+T</kbd> next
          </span>
        </div>
        <div className="status-text">{status || memLabel}</div>
      </footer>

      {/* Agent palette */}
      {paletteOpen && (
        <div
          className="palette-backdrop"
          onClick={() => setPaletteOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPaletteOpen(false)
          }}
        >
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              className="palette-search"
              autoFocus
              placeholder="Type to filter agents...  (or click one below)"
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value)
                setPaletteIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setPaletteOpen(false)
                  return
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setPaletteIndex((i) => Math.min(i + 1, filteredAgents.length - 1))
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setPaletteIndex((i) => Math.max(i - 1, 0))
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const a = filteredAgents[paletteIndex]
                  if (a) paletteSelect(a)
                }
              }}
            />
            <div className="palette-list">
              {filteredAgents.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className={`palette-item ${i === paletteIndex ? 'active' : ''}`}
                  onMouseEnter={() => setPaletteIndex(i)}
                  onClick={() => paletteSelect(a)}
                >
                  <span className="dot" style={{ background: a.color, width: 8, height: 8, borderRadius: 99 }} />
                  <span className="name">{a.name}</span>
                  <span className="sub">{a.command}</span>
                </button>
              ))}
              {filteredAgents.length === 0 && (
                <div className="palette-item muted">No agents match</div>
              )}
            </div>
            <div className="palette-footer">
              Enter = launch · Esc = close · open a project first if none is selected
            </div>
          </div>
        </div>
      )}

      {onOpenProject && (
        <OnOpenModal
          project={onOpenProject}
          onClose={() => setOnOpenProject(null)}
          onSaved={(p) => {
            void refreshProjects()
            setStatus(`On-open saved · ${p.name}`)
          }}
        />
      )}

      <SettingsMenu
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        version={version}
        activeProject={activeProject}
        memLabel={memLabel}
        updateInfo={updateInfo}
        checkingUpdate={checkingUpdate}
        onCheckUpdate={() => {
          void (async () => {
            setCheckingUpdate(true)
            try {
              const u = await window.truedeck.checkUpdates(true)
              setUpdateInfo({
                updateAvailable: u.updateAvailable,
                latestVersion: u.latestVersion,
                releaseUrl: u.releaseUrl,
                downloadUrl: u.downloadUrl,
                currentVersion: u.currentVersion
              })
              if (u.updateAvailable && u.latestVersion) {
                setStatus(`Update available: v${u.latestVersion}`)
              } else if (u.error) {
                setStatus(`Update check failed: ${u.error}`)
              } else {
                setStatus(`You're on the latest (v${u.currentVersion})`)
              }
            } finally {
              setCheckingUpdate(false)
            }
          })()
        }}
        onOpenUpdate={() => {
          const url =
            updateInfo?.downloadUrl ||
            updateInfo?.releaseUrl ||
            'https://github.com/WutIsHummus/TrueDeck/releases/latest'
          void window.truedeck.openExternal(url)
        }}
        onSettingsChange={applySettings}
        onOpenOnOpen={() => {
          if (activeProject) {
            setSettingsOpen(false)
            setOnOpenProject(activeProject)
          }
        }}
        onResetAgents={() => {
          void window.truedeck.resetAgents().then(() => refreshAgents())
        }}
        onStatus={setStatus}
        onReplayOnboarding={() => {
          setSettingsOpen(false)
          setOnboardingOpen(true)
        }}
      />

      <Onboarding
        open={onboardingOpen}
        projects={projects}
        hasActiveProject={Boolean(activeProject)}
        hasSessions={projectSessions.length > 0}
        shortPath={shortPath}
        onAddProject={async () => {
          await addProject()
        }}
        onOpenProject={async (p) => {
          await openProject(p)
        }}
        onLaunchAgent={async (id) => {
          await launchAgent(id)
        }}
        onComplete={(skipped) => {
          void window.truedeck.completeOnboarding(skipped)
          setOnboardingOpen(false)
          // Stay quiet — no "Onboarding skipped" clutter in the status bar
          if (!skipped) setStatus('Ready')
        }}
      />
    </div>
  )
}
