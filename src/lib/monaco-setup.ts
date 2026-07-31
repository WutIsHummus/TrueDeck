/**
 * Monaco Editor bootstrap for Electron + Vite.
 * Local package + workers only (no CDN — CSP blocks remote scripts).
 *
 * monaco-editor package exports map `./*` → `./esm/vs/*.js`,
 * so workers are imported as `monaco-editor/editor/editor.worker.js`.
 */

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Register all basic language tokenizers + language services (Monaco 0.56 layout)
import 'monaco-editor/basic-languages/monaco.contribution.js'
import 'monaco-editor/language/typescript/monaco.contribution.js'
import 'monaco-editor/language/json/monaco.contribution.js'
import 'monaco-editor/language/css/monaco.contribution.js'
import 'monaco-editor/language/html/monaco.contribution.js'

import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

let configured = false

export function ensureMonaco(): typeof monaco {
  if (configured) return monaco
  configured = true

  ;(globalThis as unknown as {
    MonacoEnvironment?: { getWorker: (_: unknown, label: string) => Worker }
  }).MonacoEnvironment = {
    getWorker(_moduleId: unknown, label: string): Worker {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new HtmlWorker()
      }
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    }
  }

  // Force local monaco — never hit jsDelivr (blocked by Electron CSP)
  loader.config({ monaco })

  monaco.editor.defineTheme('truedeck-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'type', foreground: '67e8f9' },
      { token: 'class', foreground: '7dd3fc' },
      { token: 'function', foreground: '93c5fd' },
      { token: 'variable', foreground: 'e2e8f0' },
      { token: 'constant', foreground: 'fcd34d' },
      { token: 'regexp', foreground: 'f9a8d4' },
      { token: 'tag', foreground: 'f472b6' },
      { token: 'attribute.name', foreground: 'fde68a' },
      { token: 'attribute.value', foreground: '86efac' },
      { token: 'delimiter', foreground: '94a3b8' },
      { token: 'operator', foreground: 'e2e8f0' }
    ],
    colors: {
      'editor.background': '#080a0e',
      'editor.foreground': '#e2e8f0',
      'editorLineNumber.foreground': '#475569',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editor.selectionBackground': '#f0a05044',
      'editor.inactiveSelectionBackground': '#33415566',
      'editor.lineHighlightBackground': '#12161f88',
      'editorCursor.foreground': '#a78bfa',
      'editorWhitespace.foreground': '#1e293b',
      'editorIndentGuide.background': '#1e293b',
      'editorIndentGuide.activeBackground': '#334155',
      'editorGutter.background': '#080a0e',
      'editorWidget.background': '#10141c',
      'editorWidget.border': '#1e293b',
      'editorSuggestWidget.background': '#10141c',
      'editorSuggestWidget.border': '#1e293b',
      'editorSuggestWidget.selectedBackground': '#a78bfa33',
      'editorError.foreground': '#f87171',
      'editorWarning.foreground': '#fbbf24',
      'editorInfo.foreground': '#60a5fa',
      'scrollbarSlider.background': '#33415566',
      'scrollbarSlider.hoverBackground': '#47556988',
      'minimap.background': '#080a0e'
    }
  })

  try {
    const ts = (monaco.languages as { typescript?: typeof monaco.languages.typescript }).typescript
    if (ts?.typescriptDefaults) {
      ts.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false
      })
      ts.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false
      })
      ts.typescriptDefaults.setCompilerOptions({
        target: ts.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        module: ts.ModuleKind.ESNext,
        noEmit: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
        allowJs: true,
        checkJs: true,
        strict: false,
        skipLibCheck: true
      })
      ts.javascriptDefaults.setCompilerOptions({
        target: ts.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
        noEmit: true
      })
    }
  } catch {
    /* language service optional */
  }

  try {
    const json = (monaco.languages as { json?: { jsonDefaults?: { setDiagnosticsOptions: (o: unknown) => void } } }).json
    json?.jsonDefaults?.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
      schemas: [],
      enableSchemaRequest: false
    })
  } catch {
    /* optional */
  }

  try {
    const css = (monaco.languages as { css?: { cssDefaults?: { setOptions: (o: unknown) => void } } }).css
    css?.cssDefaults?.setOptions({ validate: true })
  } catch {
    /* optional */
  }

  return monaco
}

/** Map file path → Monaco language id. */
export function monacoLanguageFromPath(filePath: string): string {
  const base = (filePath || '').replace(/\\/g, '/').split('/').pop() || ''
  const lower = base.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''

  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    md: 'markdown',
    mdx: 'markdown',
    markdown: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    cs: 'csharp',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    lua: 'lua',
    luau: 'lua',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    psm1: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    r: 'r',
    dart: 'dart',
    dockerfile: 'dockerfile',
    env: 'ini',
    gitignore: 'ignore',
    editorconfig: 'ini',
    txt: 'plaintext',
    log: 'plaintext'
  }

  if (lower === 'dockerfile') return 'dockerfile'
  return map[ext] || 'plaintext'
}
