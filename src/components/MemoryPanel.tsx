import { useEffect, useState } from 'react'
import { useDeck } from '../store'

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
  const project = projects.find((p) => p.id === activeProjectId)

  useEffect(() => {
    void refreshMemory()
  }, [memoryScope, activeProjectId, refreshMemory])

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

  return (
    <aside className="memory-panel">
      <div className="brand" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 style={{ fontSize: 14 }}>TrueMemory</h1>
          <p>Per-repo + global agent memory</p>
        </div>
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
          <h2>Notes</h2>
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
