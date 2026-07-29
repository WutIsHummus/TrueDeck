import { useEffect, useState } from 'react'
import type { AppSettings, ProjectConfig } from '../../electron/shared/types'
import { CloseIcon } from './CloseIcon'

interface Props {
 open: boolean
 onClose: () => void
 version: string
 activeProject: ProjectConfig | null
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

type TabId = 'general' | 'mcp' | 'terminal' | 'project' | 'agents' | 'about'

type McpRow = {
 id: string
 name: string
 enabled: boolean
 source: 'user' | 'memory' | 'builtin'
 command: string
 args: string[]
 description?: string
}

export function SettingsMenu({
 open,
 onClose,
 version,
 activeProject,
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
 const [ptyBackend, setPtyBackend] = useState<string>('…')
 const [mcpList, setMcpList] = useState<McpRow[]>([])
 const [mcpName, setMcpName] = useState('')
 const [mcpCommand, setMcpCommand] = useState('')
 const [mcpArgs, setMcpArgs] = useState('')

 const refreshMcp = async (): Promise<void> => {
 try {
 const list = await window.truedeck.listMcpServers()
 setMcpList(list)
 } catch {
 setMcpList([])
 }
 }

 useEffect(() => {
 if (!open) return
 void (async () => {
 const s = await window.truedeck.getSettings()
 setSettings(s)
 setExportText(null)
 setTab('general')
 void refreshMcp()
 try {
 const b = await window.truedeck.ptyBackend()
 setPtyBackend(
 b.backend === 'rust'
 ? `Rust backend${b.version ? ` v${b.version}` : ''}`
 : b.backend === 'node'
 ? 'node-pty (TS fallback)'
 : 'probing…'
 )
 } catch {
 setPtyBackend('unknown')
 }
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
 { id: 'mcp', label: 'MCP' },
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
 <p className="hint">Ctrl+S · Esc to close</p>
 </div>
 <button
 type="button"
 className="tab-close-btn"
 onClick={onClose}
 aria-label="Close settings"
 >
 <CloseIcon size={12} />
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
 <span>Restore project &amp; terminal tabs</span>
 <input
 type="checkbox"
 checked={settings.reopenLastProject !== false}
 onChange={(e) => void patch({ reopenLastProject: e.target.checked })}
 />
 </label>
 <p className="hint">
 On launch, reopen your last project and respawn open agent tabs (max 16 - install
 helpers are skipped).
 </p>
 <label className="settings-row">
 <span>Isolate tasks in git worktrees</span>
 <input
 type="checkbox"
 checked={settings.worktreeIsolationDefault === true}
 onChange={(e) =>
 void patch({ worktreeIsolationDefault: e.target.checked })
 }
 />
 </label>
 <p className="hint muted">
 When on, board dispatch uses <code>.truedeck/worktrees/…</code> (git repos only).
 </p>
 </section>
 <section className="settings-section">
 <h3>Agents</h3>
 <p className="hint">
 Memory, knowledge graph, and MCP wiring run automatically. Choose which CLIs
 stay in sync - TrueDeck rewrites their configs when you open a project.
 </p>
 <label className="settings-row">
 <span>Primary CLI</span>
 <select
 value={settings.preferredAgentId || ''}
 onChange={(e) =>
 void patch({ preferredAgentId: e.target.value || undefined })
 }
 >
 <option value="">(none)</option>
 <option value="cursor">Cursor</option>
 <option value="claude">Claude</option>
 <option value="codex">Codex</option>
 <option value="grok">Grok</option>
 <option value="gemini">Gemini</option>
 <option value="shell">Shell</option>
 </select>
 </label>
 <div className="settings-row stacked">
 <span>Keep these CLIs synced</span>
 <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
 {(
 [
 ['claude', 'Claude'],
 ['cursor', 'Cursor'],
 ['codex', 'Codex'],
 ['grok', 'Grok'],
 ['gemini', 'Gemini'],
 ['opencode', 'OpenCode'],
 ['aider', 'Aider']
 ] as const
 ).map(([id, label]) => {
 const list = settings.syncedAgentIds
 const checked =
 !list || list.length === 0 ? true : list.includes(id)
 return (
 <label key={id} className="muted" style={{ display: 'inline-flex', gap: 4 }}>
 <input
 type="checkbox"
 checked={checked}
 onChange={(e) => {
 const base =
 settings.syncedAgentIds?.length
 ? [...settings.syncedAgentIds]
 : [
 'claude',
 'cursor',
 'codex',
 'grok',
 'gemini',
 'opencode',
 'aider'
 ]
 const next = e.target.checked
 ? [...new Set([...base, id])]
 : base.filter((x) => x !== id)
 void patch({
 syncedAgentIds: next.length ? next : ['claude']
 })
 }}
 />
 {label}
 </label>
 )
 })}
 </div>
 </div>
 {activeProject?.root && (
 <button
 type="button"
 className="ghost"
 style={{ marginTop: 8 }}
 disabled={busy}
 onClick={() => {
 void (async () => {
 setBusy(true)
 try {
 const r = await window.truedeck.injectMemoryForAgent({
 allSynced: true,
 projectRoot: activeProject.root
 })
 onStatus(r.message)
 } catch (e) {
 onStatus(e instanceof Error ? e.message : String(e))
 } finally {
 setBusy(false)
 }
 })()
 }}
 >
 Sync now
 </button>
 )}
 </section>
 </>
 )}

 {tab === 'mcp' && (
 <section className="settings-section">
 <h3>Unified MCP</h3>
 <p className="hint">
 Configure MCP servers once. TrueDeck injects the same set into{' '}
 <strong>Cursor</strong>, <strong>Claude Code</strong>, <strong>Grok</strong>,{' '}
 <strong>Codex</strong>, <strong>Gemini</strong>, and project{' '}
 <code>.mcp.json</code> files.
 <br />
 Agents use built-in <code>truedeck-hub</code> tools: <code>truedeck_launch</code>{' '}
 opens a briefed agent pane, <code>truedeck_start_pipeline</code> for multi-agent,
 plus <code>truedeck_list_mcp</code> / <code>truedeck_add_mcp</code> to edit this
 hub.
 </p>

 <div className="mcp-list">
 {mcpList.length === 0 && (
 <p className="hint">No servers yet - enable memory backends or add one below.</p>
 )}
 {mcpList.map((s) => (
 <div key={s.id} className="mcp-row">
 <label className="mcp-enable" title={s.enabled ? 'Enabled' : 'Disabled'}>
 <input
 type="checkbox"
 checked={s.enabled}
 disabled={s.source === 'memory' || s.source === 'builtin'}
 onChange={(e) => {
 void (async () => {
 if (s.source === 'memory' || s.source === 'builtin') return
 await window.truedeck.setMcpServerEnabled(s.id, e.target.checked)
 await refreshMcp()
 })()
 }}
 />
 </label>
 <div className="mcp-meta">
 <div className="mcp-title">
 <strong>{s.name}</strong>
 <span className="mcp-source">{s.source}</span>
 </div>
 <code className="mcp-cmd">
 {s.command} {(s.args || []).join(' ')}
 </code>
 </div>
 {s.source === 'user' && (
 <button
 type="button"
 className="tab-close-btn"
 title="Remove"
 onClick={() => {
 void (async () => {
 await window.truedeck.removeMcpServer(s.id)
 await refreshMcp()
 onStatus(`Removed MCP ${s.name}`)
 })()
 }}
 >
 <CloseIcon size={10} />
 </button>
 )}
 </div>
 ))}
 </div>

 <h4 className="settings-subhead">Add MCP server</h4>
 <label className="settings-row stacked">
 <span>Name</span>
 <input
 type="text"
 value={mcpName}
 placeholder="e.g. robloxstudio"
 onChange={(e) => setMcpName(e.target.value)}
 />
 </label>
 <label className="settings-row stacked">
 <span>Command</span>
 <input
 type="text"
 value={mcpCommand}
 placeholder="npx"
 onChange={(e) => setMcpCommand(e.target.value)}
 className="mono-input"
 />
 </label>
 <label className="settings-row stacked">
 <span>Args (space-separated)</span>
 <input
 type="text"
 value={mcpArgs}
 placeholder="-y @chrrxs/robloxstudio-mcp"
 onChange={(e) => setMcpArgs(e.target.value)}
 className="mono-input"
 />
 </label>
 <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
 <button
 type="button"
 className="primary"
 disabled={busy || !mcpCommand.trim()}
 onClick={() => {
 void (async () => {
 setBusy(true)
 try {
 const args = mcpArgs
 .trim()
 .split(/\s+/)
 .filter(Boolean)
 await window.truedeck.upsertMcpServer({
 name: mcpName.trim() || 'custom',
 command: mcpCommand.trim(),
 args,
 enabled: true
 })
 setMcpName('')
 setMcpCommand('')
 setMcpArgs('')
 await refreshMcp()
 onStatus('MCP server added')
 } finally {
 setBusy(false)
 }
 })()
 }}
 >
 Add server
 </button>
 <button
 type="button"
 disabled={busy}
 onClick={() => {
 void (async () => {
 setBusy(true)
 try {
 const r = await window.truedeck.injectMcpAllClients(
 activeProject?.root
 )
 onStatus(r.message)
 } finally {
 setBusy(false)
 }
 })()
 }}
 >
 Apply to all clients
 </button>
 <button
 type="button"
 disabled={busy}
 onClick={() => {
 void (async () => {
 setBusy(true)
 try {
 const snip = await window.truedeck.exportUnifiedMcp()
 setExportText(
 `// Cursor / Claude (${snip.serverCount} servers)\n${snip.cursor}\n\n# Grok\n${snip.grokToml}`
 )
 } finally {
 setBusy(false)
 }
 })()
 }}
 >
 Export JSON / TOML
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
 <p className="hint" style={{ marginTop: 10 }}>
 Memory backends (MemPalace, etc.) also appear above. Toggle those under memory
 providers; custom servers are managed here. <strong>Apply to all clients</strong>{' '}
 rewrites Cursor / Claude / Grok / Codex / Gemini configs.
 </p>
 </section>
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
 Shortcuts (hold <strong>Ctrl</strong>, then a letter):
 <br />
 <strong>T</strong> new agent · <strong>O</strong> project · <strong>W</strong> close ·{' '}
 <strong>S</strong> settings · <strong>D</strong> v-split · <strong>X</strong> h-split ·{' '}
 <strong>←↑↓→</strong> panes · <strong>N</strong> shell · <strong>1-9</strong> jump ·{' '}
 <strong>+/−</strong> font zoom
 </p>
 <div className="settings-row">
 <span>PTY engine</span>
 <span className="meta" title="Rust sidecar when built; else node-pty">
 {ptyBackend}
 </span>
 </div>
 <p className="hint">
 Native Rust host: install{' '}
 <a href="https://rustup.rs" target="_blank" rel="noreferrer">
 rustup
 </a>
 , free disk space, then <code>npm run build:pty</code>. See docs/FAST-PTY.md.
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
 <p className="hint">Open a project first (Ctrl+O).</p>
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
 : ' - '}
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
 Terminal-first multi-agent deck - Grok, Codex, Cursor, Claude - with automatic
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
