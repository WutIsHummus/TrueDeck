import { useState } from 'react'
import type { ProjectConfig, ProjectOnOpenCommand } from '../../electron/shared/types'

interface Props {
  project: ProjectConfig
  onClose: () => void
  onSaved: (p: ProjectConfig) => void
}

export function OnOpenModal({ project, onClose, onSaved }: Props): JSX.Element {
  const [commands, setCommands] = useState<ProjectOnOpenCommand[]>(
    project.onOpenCommands?.length
      ? project.onOpenCommands
      : [{ id: crypto.randomUUID(), label: 'Command', command: '', enabled: true }]
  )
  const [defaultAgents, setDefaultAgents] = useState<string[]>(project.defaultAgents || ['shell'])

  const update = (id: string, patch: Partial<ProjectOnOpenCommand>): void => {
    setCommands((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const add = (): void => {
    setCommands((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: 'New command', command: '', enabled: true }
    ])
  }

  const remove = (id: string): void => {
    setCommands((prev) => prev.filter((c) => c.id !== id))
  }

  const save = async (): Promise<void> => {
    const final = await window.truedeck.updateProject(project.id, {
      onOpenCommands: commands,
      defaultAgents
    })
    if (final) onSaved(final)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>On open — {project.name}</h3>
        <p className="hint">
          These run automatically when you open this project in TrueDeck (e.g.{' '}
          <code>rojo serve</code>).
        </p>
        <div className="onopen-list">
          {commands.map((c) => (
            <div className="onopen-item" key={c.id}>
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => update(c.id, { enabled: e.target.checked })}
                title="Enabled"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  value={c.label}
                  onChange={(e) => update(c.id, { label: e.target.value })}
                  placeholder="Label"
                />
                <input
                  value={c.command}
                  onChange={(e) => update(c.id, { command: e.target.value })}
                  placeholder="rojo serve"
                />
              </div>
              <button className="ghost danger" onClick={() => remove(c.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={add}>+ Command</button>
          <span className="muted">Default agent tabs:</span>
          <label className="muted">
            <input
              type="checkbox"
              checked={defaultAgents.includes('shell')}
              onChange={(e) =>
                setDefaultAgents((d) =>
                  e.target.checked ? [...new Set([...d, 'shell'])] : d.filter((x) => x !== 'shell')
                )
              }
            />{' '}
            Shell
          </label>
          <label className="muted">
            <input
              type="checkbox"
              checked={defaultAgents.includes('grok')}
              onChange={(e) =>
                setDefaultAgents((d) =>
                  e.target.checked ? [...new Set([...d, 'grok'])] : d.filter((x) => x !== 'grok')
                )
              }
            />{' '}
            Grok
          </label>
        </div>
        <div className="actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
