/**
 * Detached pane windows — pop a session out of the main deck into its own
 * BrowserWindow (drag out or Ctrl+N). Shares the same PTY via backend broadcast.
 */
import { BrowserWindow, ipcMain, screen, app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

const detachedBySession = new Map<string, BrowserWindow>()
let ipcReady = false
let mainWindowGetter: () => BrowserWindow | null = () => null

export function setDetachedMainGetter(fn: () => BrowserWindow | null): void {
  mainWindowGetter = fn
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

function loadRenderer(win: BrowserWindow, query: Record<string, string>): void {
  const builtHtml = join(__dirname, '../renderer/index.html')
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const q = new URLSearchParams(query).toString()
  if (process.env.ELECTRON_RENDERER_URL && devUrl && !existsSync(builtHtml)) {
    void win.loadURL(`${devUrl.replace(/\/$/, '')}/?${q}`)
  } else if (existsSync(builtHtml)) {
    void win.loadFile(builtHtml, { query })
  } else if (devUrl) {
    void win.loadURL(`${devUrl.replace(/\/$/, '')}/?${q}`)
  }
}

export function openDetachedPaneWindow(opts: {
  sessionId: string
  title?: string
  /** Screen coords for window placement (e.g. drop point) */
  x?: number
  y?: number
  width?: number
  height?: number
}): BrowserWindow {
  const sessionId = String(opts.sessionId || '').trim()
  if (!sessionId) throw new Error('sessionId required')

  const existing = detachedBySession.get(sessionId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  const iconPath = resolveAppIcon()
  const display = screen.getDisplayNearestPoint({
    x: opts.x ?? 120,
    y: opts.y ?? 80
  })
  const work = display.workArea
  const width = Math.min(opts.width || 960, work.width)
  const height = Math.min(opts.height || 680, work.height)
  let x = typeof opts.x === 'number' ? Math.round(opts.x - width / 2) : work.x + 80
  let y = typeof opts.y === 'number' ? Math.round(opts.y - 40) : work.y + 60
  x = Math.max(work.x, Math.min(x, work.x + work.width - width))
  y = Math.max(work.y, Math.min(y, work.y + work.height - height))

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 480,
    minHeight: 320,
    show: true,
    title: opts.title || 'TrueDeck',
    backgroundColor: '#0c0c0c',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      // Reliable boot identity (URL query can be lost on file:// reloads)
      additionalArguments: [`--td-detached=${sessionId}`]
    }
  })

  detachedBySession.set(sessionId, win)
  win.setTitle(opts.title || 'TrueDeck')

  win.on('closed', () => {
    detachedBySession.delete(sessionId)
    // Tell main deck to re-dock the session if still running
    const main = mainWindowGetter()
    if (main && !main.isDestroyed()) {
      try {
        main.webContents.send('detached:closed', { sessionId })
      } catch {
        /* ignore */
      }
    }
  })

  // Push boot params after load in case query/argv is missed by renderer
  win.webContents.once('did-finish-load', () => {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('detached:boot', { sessionId })
      }
    } catch {
      /* ignore */
    }
  })

  loadRenderer(win, { detached: '1', session: sessionId })
  return win
}

export function focusDetachedPane(sessionId: string): boolean {
  const w = detachedBySession.get(sessionId)
  if (w && !w.isDestroyed()) {
    w.focus()
    return true
  }
  return false
}

export function listDetachedSessionIds(): string[] {
  return Array.from(detachedBySession.keys()).filter((id) => {
    const w = detachedBySession.get(id)
    return Boolean(w && !w.isDestroyed())
  })
}

/** Window controls work for whichever window sent the IPC (main or detached). */
export function ensureDetachedIpc(): void {
  if (ipcReady) return
  ipcReady = true

  ipcMain.handle(
    'window:openDetached',
    (
      _e,
      opts: { sessionId: string; title?: string; x?: number; y?: number }
    ): { ok: boolean; sessionId: string } => {
      const sessionId = String(opts?.sessionId || '').trim()
      if (!sessionId) throw new Error('sessionId required')
      openDetachedPaneWindow({
        sessionId,
        title: opts?.title,
        x: opts?.x,
        y: opts?.y
      })
      return { ok: true, sessionId }
    }
  )

  ipcMain.handle('window:listDetached', () => listDetachedSessionIds())

  ipcMain.handle('window:getMode', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { detached: false, sessionId: null as string | null }
    for (const [sid, w] of detachedBySession) {
      if (w === win) return { detached: true, sessionId: sid }
    }
    return { detached: false, sessionId: null as string | null }
  })
}

/** Prefer event.sender window for chrome actions. */
export function windowFromEvent(e: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}
