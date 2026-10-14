import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitReviewSnapshot } from '../../electron/shared/types'
import { useDeck } from '../store'

interface Props {
  projectRoot: string
  host: HTMLElement
  onClose: () => void
}

function fileDiff(diff: string, path: string | null): string {
  if (!path) return diff
  const chunks = diff.split(/(?=^diff --git )/m).filter((chunk) => chunk.trim())
  const hit = chunks.filter((chunk) => chunk.includes(`b/${path}`) || chunk.includes(path))
  if (hit.length) return hit.join('')
  if (diff.includes(path)) return diff
  return `No diff text for ${path}`
}

function DiffText({ text }: { text: string }): JSX.Element {
  const lines = text.split(/\r?\n/)
  return (
    <pre className="change-review-diff">
      {lines.map((line, i) => {
        const kind = line.startsWith('+') && !line.startsWith('+++')
          ? 'add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'del'
            : line.startsWith('@@')
              ? 'hunk'
              : line.startsWith('diff ')
                ? 'file'
                : ''
        return (
          <div key={i} className={kind ? `diff-${kind}` : undefined}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

/**
 * T3-style source control for the focused project: files, diff, commit, push, PR,
 * and package.json scripts as quick actions.
 */
export function ChangeReview({ projectRoot, host, onClose }: Props): JSX.Element {
  const setStatus = useDeck((s) => s.setStatus)
  const [snap, setSnap] = useState<GitReviewSnapshot | null>(null)
  const [scripts, setScripts] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
 const [top, setTop] = useState(28)

  const reload = useCallback(async () => {
    try {
      const next = await window.truedeck.gitReview(projectRoot)
      setSnap(next)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }, [projectRoot])

  useEffect(() => {
    const chrome = host.querySelector('.agent-chrome') as HTMLElement | null
    setTop(chrome?.offsetHeight || 28)
  }, [host])

  useEffect(() => {
    void reload()
    void window.truedeck
      .gitScripts(projectRoot)
      .then(setScripts)
      .catch(() => setScripts([]))
    const timer = window.setInterval(() => {
      void reload()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [projectRoot, reload])

  const shownDiff = useMemo(
    () => fileDiff(snap?.diff || '', selected),
    [snap?.diff, selected]
  )

  const run = async (label: string, task: () => Promise<{ ok: boolean; output: string }>) => {
    setBusy(label)
    setNote('')
    try {
      const result = await task()
      setNote(result.output)
      setStatus(result.ok ? result.output.split('\n')[0] : result.output.split('\n')[0])
      if (result.ok && label === 'Commit') setMessage('')
      await reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setNote(msg)
      setStatus(msg)
    } finally {
      setBusy('')
    }
  }

  const ship = async () => {
    setBusy('Ship')
    setNote('')
    try {
      if (snap && !snap.clean) {
        const committed = await window.truedeck.gitCommit(projectRoot, message)
        setNote(committed.output)
        if (!committed.ok) {
          setStatus(committed.output.split('\n')[0])
          return
        }
      }
      const pushed = await window.truedeck.gitPush(projectRoot)
      setNote(pushed.output)
      if (!pushed.ok) {
        setStatus(pushed.output.split('\n')[0])
        return
      }
      const title = message.trim() || snap?.branch || 'Update'
      const pr = await window.truedeck.gitCreatePr(projectRoot, title, message.trim())
      setNote(pr.output)
      setStatus(pr.output.split('\n')[0] || (pr.ok ? 'Pull request created' : 'Pull request failed'))
      if (pr.ok) setMessage('')
      await reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setNote(msg)
      setStatus(msg)
    } finally {
      setBusy('')
    }
  }

  const runScript = async (name: string) => {
    setBusy(name)
    try {
      await window.truedeck.spawnCommand({
        projectRoot,
        label: name,
        command: `npm run ${JSON.stringify(name)}`,
        color: '#8b7cff'
      })
      setStatus(`Running npm run ${name}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const count = snap?.files.length || 0
  const dirty = Boolean(snap && !snap.clean)
  const canCommit = dirty && message.trim().length > 0 && !busy

  return createPortal(
    <div
      className="change-review"
      style={{ top }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="change-review-bar">
        <strong>Changes</strong>
        <span className="muted">{snap?.branch || 'git'}</span>
        <span className="muted">{snap?.error ? snap.error : count ? `${count} files` : 'clean'}</span>
        <span className="agent-chrome-spacer" />
        <button type="button" className="change-review-btn" onClick={() => void reload()} disabled={!!busy}>
          Refresh
        </button>
        <button type="button" className="change-review-btn" onClick={onClose}>
          Close
        </button>
      </div>

      {scripts.length > 0 && (
        <div className="change-review-scripts">
          {scripts.map((name) => (
            <button
              key={name}
              type="button"
              className="change-review-chip"
              disabled={!!busy}
              onClick={() => void runScript(name)}
            >
              {busy === name ? '…' : name}
            </button>
          ))}
        </div>
      )}

      <div className="change-review-body">
        <ul className="change-review-files">
          <li>
            <button
              type="button"
              className={!selected ? 'active' : ''}
              onClick={() => setSelected(null)}
            >
              All
            </button>
          </li>
          {(snap?.files || []).map((file) => (
            <li key={`${file.status}:${file.path}`}>
              <button
                type="button"
                className={selected === file.path ? 'active' : ''}
                onClick={() => setSelected(file.path)}
                title={file.path}
              >
                <span className="change-review-status">{file.status}</span>
                {file.path}
              </button>
            </li>
          ))}
        </ul>
        {shownDiff ? <DiffText text={shownDiff} /> : <div className="change-review-empty muted">No diff</div>}
      </div>

      <div className="change-review-commit">
        <input
          value={message}
          placeholder="Commit message"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          className="change-review-btn"
          disabled={!canCommit}
          title="Stage every change in this project and commit"
          onClick={() => void run('Commit', () => window.truedeck.gitCommit(projectRoot, message))}
        >
          {busy === 'Commit' ? 'Committing…' : 'Commit'}
        </button>
        <button
          type="button"
          className="change-review-btn"
          disabled={!!busy}
          onClick={() => void run('Push', () => window.truedeck.gitPush(projectRoot))}
        >
          {busy === 'Push' ? 'Pushing…' : 'Push'}
        </button>
        <button
          type="button"
          className="change-review-btn"
          disabled={!!busy || !message.trim()}
          onClick={() =>
            void run('PR', () => window.truedeck.gitCreatePr(projectRoot, message.trim(), message.trim()))
          }
        >
          {busy === 'PR' ? 'Opening…' : 'PR'}
        </button>
        <button
          type="button"
          className="change-review-btn primary"
          disabled={!!busy || (dirty && !message.trim())}
          title="Commit if needed, push, then open a pull request"
          onClick={() => void ship()}
        >
          {busy === 'Ship' ? 'Shipping…' : 'Commit, push, PR'}
        </button>
      </div>
      {note && <div className="change-review-note">{note}</div>}
    </div>,
    host
  )
}
