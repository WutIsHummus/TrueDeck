import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionInfo } from '../../electron/shared/types'
import type { DocumentChromeState } from '../lib/document-chrome'
import { isMarkdownPath, languageHint, SimpleMarkdown } from '../lib/simple-markdown'
import { CodeEditor } from './CodeEditor'
import { useDeck } from '../store'

interface Props {
  session: SessionInfo
  visible: boolean
  focused?: boolean
  /** Monaco Vim keybindings */
  vimMode?: boolean
  /** Push header state into animated AgentChromeBar */
  onChromeChange?: (state: DocumentChromeState | null) => void
}

function basename(p: string): string {
  const n = (p || '').replace(/\\/g, '/').split('/').filter(Boolean)
  return n[n.length - 1] || p || 'untitled'
}

/**
 * Document body only — file identity / save / Vim live on the animated AgentChromeBar.
 */
export function DocumentPane({
  session,
  visible,
  focused,
  vimMode = false,
  onChromeChange
}: Props): JSX.Element {
  const setStatus = useDeck((s) => s.setStatus)
  const patchSession = useDeck((s) => s.patchSession)
  const path = session.documentPath || ''
  const isMd = isMarkdownPath(path)

  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'edit'>(isMd ? 'preview' : 'edit')
  const [saving, setSaving] = useState(false)
  const [localVim, setLocalVim] = useState(vimMode)

  useEffect(() => {
    setLocalVim(vimMode)
  }, [vimMode])

  const dirty = content !== saved
  const lang = languageHint(path)
  const lineCount = useMemo(() => content.split(/\r?\n/).length, [content])

  const load = useCallback(async () => {
    if (!path) {
      setError('No file path')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await window.truedeck.readProjectFile(path)
      setContent(res.content)
      setSaved(res.content)
      const name = basename(res.path)
      if (session.title !== name) {
        patchSession(session.id, { title: name })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [path, patchSession, session.id, session.title])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setMode(isMd ? 'preview' : 'edit')
  }, [isMd, path])

  const save = useCallback(async () => {
    if (!path || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.truedeck.writeProjectFile(path, content)
      setSaved(content)
      setStatus(`Saved ${basename(path)}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }, [path, content, saving, setStatus])

  const onToggleVim = useCallback(() => {
    setLocalVim((v) => {
      const next = !v
      void window.truedeck.getSettings().then(async (s) => {
        const savedSettings = await window.truedeck.setSettings({
          ...s,
          editorVimMode: next
        })
        window.dispatchEvent(new CustomEvent('truedeck:settings', { detail: savedSettings }))
      })
      setStatus(next ? 'Vim mode on' : 'Vim mode off')
      return next
    })
  }, [setStatus])

  // Publish chrome state to animated AgentChromeBar
  useEffect(() => {
    if (!onChromeChange) return
    if (!visible) {
      onChromeChange(null)
      return
    }
    const state: DocumentChromeState = {
      path,
      name: basename(path),
      lang,
      lineCount,
      dirty,
      mode,
      isMd,
      vimMode: localVim,
      loading,
      saving,
      onSetMode: setMode,
      onToggleVim,
      onReload: () => void load(),
      onSave: () => void save()
    }
    onChromeChange(state)
    return () => onChromeChange(null)
  }, [
    onChromeChange,
    visible,
    path,
    lang,
    lineCount,
    dirty,
    mode,
    isMd,
    localVim,
    loading,
    saving,
    onToggleVim,
    load,
    save
  ])

  useEffect(() => {
    if (!visible || !focused) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void save()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, focused, save])

  return (
    <div
      className={[
        'document-pane',
        visible ? 'visible' : 'hidden',
        focused ? 'focused' : '',
        dirty ? 'dirty' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden={!visible}
    >
      {loading ? (
        <div className="document-body document-center muted">Loading…</div>
      ) : error ? (
        <div className="document-body document-center">
          <p className="document-error">{error}</p>
          <button type="button" className="document-btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : mode === 'preview' && isMd ? (
        <div className="document-body document-preview">
          <SimpleMarkdown source={content} />
        </div>
      ) : (
        <CodeEditor
          path={path}
          value={content}
          onChange={setContent}
          onSave={() => void save()}
          focused={Boolean(visible && focused)}
          fontSize={13}
          vimMode={localVim}
        />
      )}
    </div>
  )
}
