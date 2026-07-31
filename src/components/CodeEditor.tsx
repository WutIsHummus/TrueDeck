import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { ensureMonaco, monacoLanguageFromPath } from '../lib/monaco-setup'

// Configure workers + theme before any Editor mount (blocks CDN fallback)
ensureMonaco()

interface Props {
  path: string
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  focused?: boolean
  readOnly?: boolean
  fontSize?: number
  /** Vim keybindings via monaco-vim */
  vimMode?: boolean
}

type VimHandle = { dispose: () => void }

/**
 * Monaco-powered code editor for Document tabs.
 * Syntax highlighting, line numbers, find, bracket match, and built-in
 * diagnostics for TS/JS/JSON/CSS/HTML. Optional Vim mode.
 */
export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  focused = false,
  readOnly = false,
  fontSize = 13,
  vimMode = false
}: Props): JSX.Element {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const vimRef = useRef<VimHandle | null>(null)
  const vimStatusRef = useRef<HTMLDivElement | null>(null)
  const language = monacoLanguageFromPath(path)

  useEffect(() => {
    ensureMonaco()
  }, [])

  // Focus editor when pane is focused
  useEffect(() => {
    if (!focused) return
    const ed = editorRef.current
    if (!ed) return
    const t = window.setTimeout(() => {
      try {
        ed.focus()
      } catch {
        /* ignore */
      }
    }, 40)
    return () => window.clearTimeout(t)
  }, [focused, path])

  // Keep model language in sync when path changes
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    const model = ed.getModel()
    if (!model) return
    const monaco = ensureMonaco()
    monaco.editor.setModelLanguage(model, language)
  }, [language, path])

  // Attach / detach Vim mode
  useEffect(() => {
    const ed = editorRef.current
    const status = vimStatusRef.current
    if (!ed) return

    const disposeVim = (): void => {
      try {
        vimRef.current?.dispose()
      } catch {
        /* ignore */
      }
      vimRef.current = null
      if (status) status.textContent = ''
    }

    if (!vimMode) {
      disposeVim()
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const mod = await import('monaco-vim')
        if (cancelled || !editorRef.current) return
        disposeVim()
        const init = mod.initVimMode || (mod as { default?: { initVimMode?: typeof mod.initVimMode } }).default?.initVimMode
        if (typeof init !== 'function') return
        vimRef.current = init(editorRef.current, status || undefined)
      } catch (e) {
        console.warn('[monaco-vim]', e)
      }
    })()

    return () => {
      cancelled = true
      disposeVim()
    }
  }, [vimMode, path])

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed
    ensureMonaco()
    monaco.editor.setTheme('truedeck-dark')

    // Ctrl/Cmd+S → save (also handled at App level; this keeps focus in editor)
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    if (focused) {
      try {
        ed.focus()
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className={`document-body document-monaco${vimMode ? ' vim-on' : ''}`}>
      <Editor
        path={path || 'untitled'}
        language={language}
        value={value}
        theme="truedeck-dark"
        loading={<div className="document-center muted">Loading editor…</div>}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          readOnly,
          fontSize,
          fontFamily:
            '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
          fontLigatures: true,
          lineNumbers: 'on',
          minimap: { enabled: true, maxColumn: 80, scale: 0.75, showSlider: 'mouseover' },
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'selection',
          renderLineHighlight: 'line',
          cursorBlinking: vimMode ? 'solid' : 'smooth',
          cursorSmoothCaretAnimation: vimMode ? 'off' : 'on',
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true
          },
          matchBrackets: 'always',
          autoClosingBrackets: 'languageDefined',
          autoClosingQuotes: 'languageDefined',
          formatOnPaste: true,
          formatOnType: false,
          folding: true,
          foldingHighlight: true,
          showFoldingControls: 'mouseover',
          stickyScroll: { enabled: true },
          padding: { top: 8, bottom: 16 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false
          },
          suggest: {
            showKeywords: true,
            showSnippets: true
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false
          },
          parameterHints: { enabled: true },
          hover: { enabled: true, delay: 300 },
          links: true,
          colorDecorators: true,
          contextmenu: true,
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: 'multiline'
          },
          overviewRulerLanes: 3,
          fixedOverflowWidgets: true
        }}
      />
      <div
        ref={vimStatusRef}
        className="document-vim-status"
        aria-live="polite"
        hidden={!vimMode}
      />
    </div>
  )
}
