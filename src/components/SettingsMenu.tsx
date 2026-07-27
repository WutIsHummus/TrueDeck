import { useEffect, useState } from 'react'
import type { AppSettings, ProjectConfig } from '../../electron/shared/types'

interface Props {
  open: boolean
  onClose: () => void
  version: string
  activeProject: ProjectConfig | null
  memLabel: string
  updateInfo: {
    updateAvailable: boolean
    latestVersion: string | null
    releaseUrl: string | null
    downloadUrl: string | null
    currentVersion: string
  } | null
  checkingUpdate: boolean
  onCheckUpdate: () => void
  onOpenUpdate: () => void
  onSettingsChange: (s: AppSettings) => void
  onOpenOnOpen: () => void
  onResetAgents: () => void
  onStatus: (msg: string) => void
  onReplayOnboarding?: () => void
}

type TabId = 'general' | 'terminal' | 'project' | 'agents' | 'about'

export function SettingsMenu({
  open,
  onClose,
  version,
  activeProject,
  memLabel,
  updateInfo,
  checkingUpdate,
  onCheckUpdate,
  onOpenUpdate,
  onSettingsChange,
  onOpenOnOpen,
  onResetAgents,
  onStatus,
  onReplayOnboarding
}: Props): JSX.Element | null {
  const [tab, setTab] = useState<TabId>('general')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [exportText, setExportText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void (async () => {
      const s = await window.truedeck.getSettings()
      setSettings(s)
      setExportText(null)
      setTab('general')
    })()
  }, [open])

  if (!open || !settings) return null

  const patch = async (partial: Partial<AppSettings>): Promise<void> => {
    const next = { ...settings, ...partial }
    setSettings(next)
    const saved = await window.truedeck.setSettings(next)
    setSettings(saved)
    onSettingsChange(saved)
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'project', label: 'Project' },
    { id: 'agents', label: 'Agents' },
    { id: 'about', label: 'About' }
  ]

  return (
    <div
      className="modal-backdrop settings-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2>Settings</h2>
            <p className="hint">Ctrl+, · Esc to close</p>
          </div>
          <button type="button" className="tab-close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tab === 'general' && (
              <>
                <section className="settings-section">
                  <h3>Appearance</h3>
                  <label className="settings-row">
                    <span>Theme</span>
                    <select
                      value={settings.theme}
                      onChange={(e) =>
                        void patch({ theme: e.target.value as 'dark' | 'light' })
                      }
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light (soft)</option>
                    </select>
                  </label>
                  <label className="settings-row">
                    <span>Show quick agents</span>
                    <input
                      type="checkbox"
                      checked={settings.showQuickAgents !== false}
                      onChange={(e) => void patch({ showQuickAgents: e.target.checked })}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Reopen last project</span>
                    <input
                      type="checkbox"
                      checked={settings.reopenLastProject !== false}
                      onChange={(e) => void patch({ reopenLastProject: e.target.checked })}
                    />
                  </label>
                </section>
                <section className="settings-section">
                  <h3>Memory</h3>
                  <p className="hint">
                    Fully automatic — TrueDeck refreshes context and mines in the background. You
                    don’t manage notes or Docker.
                  </p>
                  <div className="settings-row">
                    <span>Status</span>
                    <span className="badge">{memLabel}</span>
                  </div>
                  <label className="settings-row">
                    <span>Refresh context on agent start</span>
                    <input
                      type="checkbox"
                      checked={settings.injectMemoryOnAgentStart !== false}
                      onChange={(e) =>
                        void patch({ injectMemoryOnAgentStart: e.target.checked })
                      }
                    />
                  </label>
                </section>
              </>
            )}

            {tab === 'terminal' && (
              <section className="settings-section">
                <h3>Terminal</h3>
                <label className="settings-row">
                  <span>Font size</span>
                  <div className="row">
                    <input
                      type="range"
                      min={11}
                      max={20}
                      value={settings.fontSize || 13}
                      onChange={(e) => void patch({ fontSize: Number(e.target.value) })}
                    />
                    <span className="meta">{settings.fontSize || 13}px</span>
                  </div>
                </label>
                <label className="settings-row">
                  <span>Default layout</span>
                  <select
                    value={settings.layoutMode || 'tabs'}
                    onChange={(e) =>
                      void patch({ layoutMode: e.target.value as 'tabs' | 'grid' })
                    }
                  >
                    <option value="tabs">Tabs (studio)</option>
                    <option value="grid">Grid (multi-pane)</option>
                  </select>
                </label>
                <p className="hint">
                  Shortcuts: Ctrl+K agent · Ctrl+W close · Ctrl+Tab next · Ctrl+\ split · Ctrl+P
                  project
                </p>
              </section>
            )}

            {tab === 'project' && (
              <section className="settings-section">
                <h3>Current project</h3>
                {activeProject ? (
                  <>
                    <div className="settings-row">
                      <span>Name</span>
                      <span className="meta">{activeProject.name}</span>
                    </div>
                    <div className="settings-row stacked">
                      <span>Path</span>
                      <code className="path-block">{activeProject.root}</code>
                    </div>
                    <div className="settings-row">
                      <span>On-open commands</span>
                      <button type="button" className="primary" onClick={onOpenOnOpen}>
                        Edit…
                      </button>
                    </div>
                    <p className="hint">
                      e.g. <code>rojo serve</code> when you open a Roblox project.
                    </p>
                  </>
                ) : (
                  <p className="hint">Open a project first (Ctrl+P).</p>
                )}
              </section>
            )}

            {tab === 'agents' && (
              <section className="settings-section">
                <h3>Agents</h3>
                <p className="hint">
                  Grok, Codex, Cursor, Claude, Gemini, Shell, and more. Cursor uses{' '}
                  <code>cursor-agent</code> when available.
                </p>
                <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      onResetAgents()
                      setBusy(false)
                      onStatus('Agent presets reset')
                    }}
                  >
                    Reset agent list
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true)
                        try {
                          const snip = await window.truedeck.exportMemoryMcpSnippet()
                          setExportText(snip.cursor + '\n\n--- Grok ---\n\n' + snip.grokToml)
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }}
                  >
                    Export MCP config
                  </button>
                </div>
                {exportText && (
                  <textarea
                    readOnly
                    className="settings-export"
                    value={exportText}
                    onFocus={(e) => e.target.select()}
                  />
                )}
              </section>
            )}

            {tab === 'about' && (
              <section className="settings-section">
                <h3>TrueDeck</h3>
                <div className="settings-row">
                  <span>Version</span>
                  <span className="meta">{version || 'dev'}</span>
                </div>
                <div className="settings-row">
                  <span>Updates</span>
                  <div className="row">
                    {updateInfo?.updateAvailable ? (
                      <button type="button" className="update-btn" onClick={onOpenUpdate}>
                        Update{updateInfo.latestVersion ? ` v${updateInfo.latestVersion}` : ''}
                      </button>
                    ) : (
                      <span className="meta">
                        {updateInfo?.latestVersion
                          ? `Up to date (v${updateInfo.currentVersion})`
                          : '—'}
                      </span>
                    )}
                    <button type="button" disabled={checkingUpdate} onClick={onCheckUpdate}>
                      {checkingUpdate ? 'Checking…' : 'Check now'}
                    </button>
                  </div>
                </div>
                {updateInfo?.updateAvailable && updateInfo.latestVersion && (
                  <p className="hint">
                    New release <strong>v{updateInfo.latestVersion}</strong> is available (you have
                    v{updateInfo.currentVersion}).
                  </p>
                )}
                <p className="hint">
                  Terminal-first multi-agent deck — Grok, Codex, Cursor, Claude — with automatic
                  memory.
                </p>
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      void window.truedeck.resetOnboarding().then(() => {
                        onReplayOnboarding?.()
                      })
                    }}
                  >
                    Replay onboarding
                  </button>
                </div>
                <a
                  className="settings-link"
                  href="https://github.com/WutIsHummus/TrueDeck"
                  onClick={(e) => {
                    e.preventDefault()
                    void window.truedeck.openExternal('https://github.com/WutIsHummus/TrueDeck')
                  }}
                >
                  github.com/WutIsHummus/TrueDeck
                </a>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
