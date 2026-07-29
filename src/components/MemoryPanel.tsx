import { useCallback, useEffect, useState } from 'react'
import { useDeck } from '../store'
import type { MemoryProviderStatus } from '../../electron/shared/types'

export function MemoryPanel(): JSX.Element {
 const {
 memoryScope,
 setMemoryScope,
 notes,
 refreshMemory,
 activeNotePath,
 setActiveNote,
 noteDraft,
 setNoteDraft,
 activeProjectId,
 projects,
 setStatus
 } = useDeck()
 const [newPath, setNewPath] = useState('context/note.md')
 const [providers, setProviders] = useState<MemoryProviderStatus[]>([])
 const [showAdd, setShowAdd] = useState(false)
 const [showExport, setShowExport] = useState<string | null>(null)
 const [customName, setCustomName] = useState('Custom memory MCP')
 const [customCmd, setCustomCmd] = useState('')
 const [customArgs, setCustomArgs] = useState('')
 const project = projects.find((p) => p.id === activeProjectId)

 const refreshProviders = useCallback(async () => {
 try {
 const list = await window.truedeck.memoryProviderStatus()
 setProviders(list)
 } catch {
 setProviders([])
 }
 }, [])

 useEffect(() => {
 void refreshMemory()
 }, [memoryScope, activeProjectId, refreshMemory])

 useEffect(() => {
 void refreshProviders()
 }, [refreshProviders])

 const openNote = async (path: string, content: string): Promise<void> => {
 setActiveNote(path, content)
 }

 const save = async (): Promise<void> => {
 if (!activeNotePath && !newPath) return
 const relativePath =
 notes.find((n) => n.path === activeNotePath)?.relativePath || newPath
 if (memoryScope === 'repo' && !project) {
 setStatus('Open a project to write repo memory')
 return
 }
 const note = await window.truedeck.writeMemory({
 scope: memoryScope,
 projectRoot: project?.root,
 relativePath,
 content: noteDraft || `# ${relativePath}\n\n`
 })
 setActiveNote(note.path, note.content)
 await refreshMemory()
 setStatus(`Saved ${note.relativePath}`)
 }

 const createNew = async (): Promise<void> => {
 setActiveNote(null, `# New note\n\n`)
 setNewPath(
 memoryScope === 'global'
 ? `context/pref-${new Date().toISOString().slice(0, 10)}.md`
 : `context/note-${new Date().toISOString().slice(0, 10)}.md`
 )
 }

 const remove = async (): Promise<void> => {
 if (!activeNotePath) return
 await window.truedeck.deleteMemory(activeNotePath)
 setActiveNote(null, '')
 await refreshMemory()
 setStatus('Note deleted')
 }

 const toggleProvider = async (id: string, enabled: boolean): Promise<void> => {
 await window.truedeck.setMemoryProviderEnabled(id, enabled)
 await refreshProviders()
 setStatus(`${id} ${enabled ? 'enabled' : 'disabled'}`)
 }

 const ensureAll = async (): Promise<void> => {
 const list = await window.truedeck.ensureMemoryProviders(project?.root)
 setProviders(list)
 setStatus('Memory providers refreshed (native - no Docker)')
 }

 const addCustom = async (): Promise<void> => {
 if (!customCmd.trim()) {
 setStatus('Command is required')
 return
 }
 const args = customArgs
 .split(/\s+/)
 .map((s) => s.trim())
 .filter(Boolean)
 await window.truedeck.addCustomMemoryMcp({
 name: customName.trim() || 'Custom MCP',
 command: customCmd.trim(),
 args
 })
 setShowAdd(false)
 setCustomCmd('')
 setCustomArgs('')
 await refreshProviders()
 setStatus('Custom memory MCP added')
 }

 const exportSnippets = async (): Promise<void> => {
 const snip = await window.truedeck.exportMemoryMcpSnippet()
 setShowExport(snip.cursor + '\n\n--- Grok config.toml ---\n\n' + snip.grokToml)
 }

 return (
 <aside className="memory-panel">
 <div className="brand" style={{ borderBottom: '1px solid var(--border)' }}>
 <div>
 <h1 style={{ fontSize: 14 }}>TrueMemory</h1>
 <p>Files + pluggable mem backends</p>
 </div>
 </div>

 <div className="section" style={{ paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
 <div className="section-header">
 <h2>Memory backends</h2>
 <button className="ghost" onClick={() => void ensureAll()} title="Ensure enabled providers">
 ↻
 </button>
 </div>
 <p className="hint">
 MemPalace stays native (no Docker). Toggle backends or add OpenMemory / any MCP.
 </p>
 <div className="note-list" style={{ maxHeight: 160 }}>
 {providers.map((p) => (
 <div
 key={p.id}
 className="note-item"
 style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
 >
 <div className="row" style={{ width: '100%' }}>
 <input
 type="checkbox"
 checked={p.enabled}
 disabled={p.kind === 'truememory'}
 onChange={(e) => void toggleProvider(p.id, e.target.checked)}
 title={p.kind === 'truememory' ? 'Always on' : 'Enable backend'}
 />
 <div className="meta" style={{ flex: 1, minWidth: 0 }}>
 <div className="name" style={{ fontSize: 12, fontWeight: 600 }}>
 {p.name}
 </div>
 <div className="path" style={{ fontSize: 10 }}>
 {p.mode}
 {p.ready ? ' · ready' : p.enabled ? ' · not ready' : ' · off'}
 </div>
 </div>
 <span
 className="badge"
 style={{
 borderColor: p.ready ? '#34d39955' : p.enabled ? '#fbbf2455' : '#64748b55'
 }}
 >
 {p.kind === 'mempalace' ? 'mem' : p.kind === 'truememory' ? 'files' : 'mcp'}
 </span>
 </div>
 <div className="hint" style={{ margin: 0, fontSize: 10 }}>
 {p.message}
 </div>
 {p.kind === 'mempalace' && p.enabled && project && (
 <button
 className="ghost"
 style={{ fontSize: 11, alignSelf: 'flex-start' }}
 onClick={() => {
 void (async () => {
 setStatus(`Mining ${project.name} into MemPalace…`)
 await window.truedeck.mempalaceEnsure({
 projectRoot: project.root,
 wing: project.name
 })
 await refreshProviders()
 setStatus(`MemPalace mine started for ${project.name}`)
 })()
 }}
 >
 Mine project wing
 </button>
 )}
 {p.kind === 'custom-mcp' && (
 <button
 className="ghost danger"
 style={{ fontSize: 11, alignSelf: 'flex-start' }}
 onClick={() => {
 void (async () => {
 await window.truedeck.removeMemoryProvider(p.id)
 await refreshProviders()
 })()
 }}
 >
 Remove
 </button>
 )}
 </div>
 ))}
 </div>
 <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
 <button className="ghost" onClick={() => setShowAdd((v) => !v)}>
 + Custom MCP
 </button>
 <button className="ghost" onClick={() => void exportSnippets()}>
 Export MCP
 </button>
 </div>
 {showAdd && (
 <div className="onopen-list" style={{ marginTop: 8 }}>
 <input
 value={customName}
 onChange={(e) => setCustomName(e.target.value)}
 placeholder="Name (e.g. OpenMemory)"
 />
 <input
 value={customCmd}
 onChange={(e) => setCustomCmd(e.target.value)}
 placeholder="Command (e.g. npx or C:\path\server.exe)"
 />
 <input
 value={customArgs}
 onChange={(e) => setCustomArgs(e.target.value)}
 placeholder="Args space-separated"
 />
 <div className="row">
 <button className="primary" onClick={() => void addCustom()}>
 Add
 </button>
 <button className="ghost" onClick={() => setShowAdd(false)}>
 Cancel
 </button>
 </div>
 </div>
 )}
 {showExport && (
 <div style={{ marginTop: 8 }}>
 <textarea
 readOnly
 value={showExport}
 style={{ minHeight: 100, fontSize: 10 }}
 onFocus={(e) => e.target.select()}
 />
 <button className="ghost" onClick={() => setShowExport(null)}>
 Close export
 </button>
 </div>
 )}
 </div>

 <div className="memory-tabs">
 <button
 className={memoryScope === 'repo' ? 'active primary' : ''}
 onClick={() => setMemoryScope('repo')}
 >
 This repo
 </button>
 <button
 className={memoryScope === 'global' ? 'active primary' : ''}
 onClick={() => setMemoryScope('global')}
 >
 Global
 </button>
 </div>

 <div className="section" style={{ flex: 1 }}>
 <div className="section-header">
 <h2>Notes (TrueMemory)</h2>
 <button className="ghost" onClick={() => void createNew()}>
 + New
 </button>
 </div>
 <p className="hint">
 {memoryScope === 'repo'
 ? project
 ? `Stored in ${project.root}\\.memory`
 : 'Select a project to view repo memory.'
 : 'Shared across every project on this machine.'}
 </p>
 <div className="note-list">
 {notes.map((n) => (
 <button
 key={n.path}
 className={`note-item ${activeNotePath === n.path ? 'active' : ''}`}
 onClick={() => void openNote(n.path, n.content)}
 >
 <div className="meta" style={{ minWidth: 0 }}>
 <div className="name" style={{ fontSize: 12, fontWeight: 600 }}>
 {n.title}
 </div>
 <div className="path">{n.relativePath}</div>
 </div>
 </button>
 ))}
 {notes.length === 0 && <div className="muted">No notes yet.</div>}
 </div>
 </div>

 <div className="note-editor">
 {!activeNotePath && (
 <input
 value={newPath}
 onChange={(e) => setNewPath(e.target.value)}
 placeholder="relative/path.md"
 />
 )}
 <textarea
 value={noteDraft}
 onChange={(e) => setNoteDraft(e.target.value)}
 placeholder="# Title&#10;&#10;Write durable facts agents should remember..."
 />
 <div className="row">
 <button className="primary" onClick={() => void save()}>
 Save
 </button>
 <button className="danger ghost" onClick={() => void remove()} disabled={!activeNotePath}>
 Delete
 </button>
 {activeNotePath && (
 <button
 className="ghost"
 onClick={() => void window.truedeck.showItem(activeNotePath)}
 >
 Reveal
 </button>
 )}
 </div>
 </div>
 </aside>
 )
}
