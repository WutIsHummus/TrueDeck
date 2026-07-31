/**
 * Agent "show me this" — TrueDeck in-app pop-out window (not the system browser).
 * Scroll + select + copy while agent TUIs keep running.
 */
import {
  BrowserWindow,
  clipboard,
  ipcMain,
  app,
  type BrowserWindowConstructorOptions
} from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { basename, dirname, extname, join, normalize } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalDataDir } from './paths'
import type { SessionInfo } from '../shared/types'

const MAX_BYTES = 2_000_000
const openByPath = new Map<string, BrowserWindow>()

let ipcReady = false

/** Kept for main-window lifecycle hooks (focus/close coordination later). */
export function setDocumentViewerParent(_win: BrowserWindow | null): void {
  // Pop-outs are independent windows; parent link intentionally unused.
}

function ensureViewerIpc(): void {
  if (ipcReady) return
  ipcReady = true
  ipcMain.handle('viewer:copyText', (_e, text: string) => {
    try {
      clipboard.writeText(String(text ?? ''))
      return true
    } catch {
      return false
    }
  })
}

function resolveViewerPreload(): string | null {
  const candidates = [
    join(process.resourcesPath || '', 'viewer-preload.cjs'),
    join(app.getAppPath(), 'resources', 'viewer-preload.cjs'),
    join(process.cwd(), 'resources', 'viewer-preload.cjs'),
    join(__dirname, '../../resources/viewer-preload.cjs'),
    join(__dirname, '../../../resources/viewer-preload.cjs')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath || '', 'icon.png'),
    join(process.resourcesPath || '', 'icon.ico'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.cwd(), 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return undefined
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function languageExt(language?: string, title?: string, pathHint?: string): string {
  const fromPath = pathHint ? extname(pathHint).replace(/^\./, '').toLowerCase() : ''
  if (fromPath) return fromPath
  const t = (title || '').toLowerCase()
  const m = t.match(/\.([a-z0-9]{1,8})$/)
  if (m) return m[1]
  const lang = (language || '').toLowerCase().trim()
  const map: Record<string, string> = {
    markdown: 'md',
    md: 'md',
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    js: 'js',
    jsx: 'jsx',
    python: 'py',
    py: 'py',
    rust: 'rs',
    rs: 'rs',
    go: 'go',
    json: 'json',
    yaml: 'yml',
    yml: 'yml',
    toml: 'toml',
    html: 'html',
    css: 'css',
    shell: 'sh',
    bash: 'sh',
    powershell: 'ps1',
    ps1: 'ps1',
    text: 'txt',
    txt: 'txt',
    plain: 'txt'
  }
  if (map[lang]) return map[lang]
  if (/^[a-z0-9]{1,8}$/.test(lang)) return lang
  if (!lang && title && /plan|readme|notes?|doc|spec|design|view/i.test(title)) return 'md'
  return 'md'
}

function slugTitle(title?: string): string {
  const raw = (title || 'snippet').trim() || 'snippet'
  const slug = raw
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return slug || 'snippet'
}

/** Resolve absolute path: open existing file or write agent content to a scratch viewer file. */
export function resolveShowDocumentPath(opts: {
  path?: string
  content?: string
  title?: string
  language?: string
  projectRoot?: string
}): { path: string; written: boolean; title: string } {
  const pathIn = (opts.path || '').trim()
  if (pathIn) {
    const p = normalize(pathIn)
    if (!existsSync(p) || !statSync(p).isFile()) {
      throw new Error(`File not found: ${p}`)
    }
    const st = statSync(p)
    if (st.size > MAX_BYTES) {
      throw new Error('File is larger than 2MB - open it in an external editor')
    }
    const name = basename(p)
    return { path: p, written: false, title: opts.title?.trim() || name }
  }

  const content = opts.content != null ? String(opts.content) : ''
  if (!content.length) {
    throw new Error('Provide path or content')
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw new Error('Content larger than 2MB')
  }

  const ext = languageExt(opts.language, opts.title, undefined)
  const base = slugTitle(opts.title)
  const short = randomUUID().slice(0, 8)
  const root =
    (opts.projectRoot && existsSync(opts.projectRoot) && opts.projectRoot) ||
    getGlobalDataDir()
  const dir = join(root, '.truedeck', 'viewer')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${base}-${short}.${ext}`)
  writeFileSync(filePath, content, 'utf8')
  return {
    path: filePath,
    written: true,
    title: opts.title?.trim() || `${base}.${ext}`
  }
}

export function buildDocumentSession(opts: {
  path: string
  title?: string
  projectRoot?: string
}): SessionInfo {
  const docPath = normalize(opts.path)
  const name = basename(docPath)
  const projectRoot =
    (opts.projectRoot && opts.projectRoot.trim()) || dirname(docPath) || docPath
  return {
    id: `doc-${randomUUID()}`,
    agentId: 'document',
    agentName: 'Doc',
    color: '#a78bfa',
    projectRoot,
    status: 'running',
    createdAt: Date.now(),
    title: opts.title?.trim() || name,
    kind: 'document',
    documentPath: docPath
  }
}

function buildViewerHtml(opts: {
  title: string
  path: string
  content: string
}): string {
  const title = escapeHtml(opts.title)
  const pathLabel = escapeHtml(opts.path)
  const body = escapeHtml(opts.content)
  const lines = opts.content.split(/\r?\n/).length
  const chars = opts.content.length
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — TrueDeck</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0c0c0c;
    --panel: #141414;
    --border: #2a2a2a;
    --text: #e8e8e8;
    --muted: #9a9a9a;
    --accent: #a78bfa;
    --btn: #1e1e1e;
    --btn-hover: #2a2a2a;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 2;
    -webkit-app-region: drag;
  }
  .toolbar button { -webkit-app-region: no-drag; }
  .brand {
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .title {
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 32vw;
  }
  .path {
    color: var(--muted);
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .meta { color: var(--muted); font-size: 11px; white-space: nowrap; }
  button {
    appearance: none;
    border: 1px solid var(--border);
    background: var(--btn);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover { background: var(--btn-hover); }
  button.primary {
    border-color: #6d28d9;
    color: #f3e8ff;
  }
  .body {
    height: calc(100% - 45px);
    overflow: auto;
    padding: 16px 18px 40px;
    -webkit-user-select: text;
    user-select: text;
    cursor: text;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.55;
  }
  .toast {
    position: fixed;
    right: 14px;
    bottom: 14px;
    background: #222;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="brand">TrueDeck</span>
    <span class="title" title="${title}">${title}</span>
    <span class="path" title="${pathLabel}">${pathLabel}</span>
    <span class="meta">${lines} lines · ${chars.toLocaleString()} chars</span>
    <button type="button" class="primary" id="copy">Copy all</button>
    <button type="button" id="copySel">Copy selection</button>
  </div>
  <div class="body" id="root"><pre id="text">${body}</pre></div>
  <div class="toast" id="toast">Copied</div>
  <script>
    const RAW = document.getElementById('text').textContent || '';
    const toast = document.getElementById('toast');
    const root = document.getElementById('root');
    let toastTimer;
    function showToast(msg) {
      toast.textContent = msg || 'Copied';
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1200);
    }
    async function copyText(text) {
      try {
        if (window.truedeckViewer && window.truedeckViewer.copy) {
          var ok = await window.truedeckViewer.copy(String(text || ''));
          if (ok) { showToast('Copied'); return; }
        }
        await navigator.clipboard.writeText(String(text || ''));
        showToast('Copied');
      } catch (e) {
        try {
          var ta = document.createElement('textarea');
          ta.value = String(text || '');
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          showToast('Copied');
        } catch (e2) {
          showToast('Copy failed');
        }
      }
    }
    document.getElementById('copy').onclick = function () { copyText(RAW); };
    document.getElementById('copySel').onclick = function () {
      var sel = String(window.getSelection() || '');
      if (!sel) { showToast('Select text first'); return; }
      copyText(sel);
    };
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        var range = document.createRange();
        range.selectNodeContents(root);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        var sel2 = String(window.getSelection() || '');
        if (sel2) {
          e.preventDefault();
          copyText(sel2);
        }
      }
    });
  </script>
</body>
</html>`
}

/**
 * Open (or focus) a TrueDeck native pop-out window for a file path.
 * Not the system browser — a separate Electron window owned by the app.
 */
export function openDocumentPopout(opts: {
  path: string
  title?: string
}): BrowserWindow {
  ensureViewerIpc()

  const p = normalize(opts.path)
  const key = p.toLowerCase()
  const existing = openByPath.get(key)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  if (!existsSync(p) || !statSync(p).isFile()) {
    throw new Error(`File not found: ${p}`)
  }
  const st = statSync(p)
  if (st.size > MAX_BYTES) {
    throw new Error('File is larger than 2MB')
  }
  const content = readFileSync(p, 'utf8')
  const title = opts.title?.trim() || basename(p)
  const preload = resolveViewerPreload()
  const icon = resolveAppIcon()

  const conf: BrowserWindowConstructorOptions = {
    width: 960,
    height: 740,
    minWidth: 480,
    minHeight: 320,
    title: `${title} — TrueDeck`,
    backgroundColor: '#0c0c0c',
    autoHideMenuBar: true,
    show: false,
    // Independent TrueDeck window (not system browser; can move to another monitor)
    modal: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...(preload ? { preload } : {})
    }
  }

  const html = buildViewerHtml({ title, path: p, content })
  const cacheDir = join(getGlobalDataDir(), 'viewer-cache')
  mkdirSync(cacheDir, { recursive: true })
  const htmlPath = join(cacheDir, `${randomUUID()}.html`)
  writeFileSync(htmlPath, html, 'utf8')

  const win = new BrowserWindow(conf)
  openByPath.set(key, win)

  win.on('closed', () => {
    if (openByPath.get(key) === win) openByPath.delete(key)
  })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })

  void win.loadFile(htmlPath)
  return win
}
