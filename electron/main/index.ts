import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { ensureDetachedIpc, setDetachedMainGetter } from './detached-windows'
import { join, dirname, normalize } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import {
 getBackend,
 findBackendBinary,
 shutdownBackend,
 type BackendBridge
} from './backend-bridge'
import {
 setSessionsWindow,
 requireRustBackend,
 listSessions,
 spawnAgent as rustSpawnAgent,
 spawnCommand as rustSpawnCommand,
 writeSession,
 resizeSession,
 killSession,
 backendStatus
} from './sessions-rust'
import { loadAgents, saveAgents, getDefaultAgents, createCustomAgentPreset } from './agents'
import { probeAgents, resolveAgentCommand, clearResolveCache } from './resolve-command'
import {
 prepareNewSessionSpawn,
 prepareResumeSpawn,
 tryDiscoverCodexSessionId,
 discoverCodexSessionId
} from './agent-resume'
import {
 listProjects,
 upsertProject,
 removeProject,
 getProject,
 setOnOpenCommands,
 suggestOnOpenCommands,
 cloneRepoAsProject,
 importReposFromFolder,
 getDefaultCloneParent
} from './projects'
import {
 ensureGlobalMemory,
 ensureRepoMemory,
 listMemory,
 readMemoryNote,
 writeMemoryNote,
 deleteMemoryNote,
 buildAgentBootstrapPrompt
} from './memory'
import { getGlobalDataDir, getSettingsPath } from './paths'
import {
 loadSessionLayout,
 MAX_SAVED_TABS,
 saveSessionLayout,
 layoutFromLiveSessions,
 layoutFromPersistSnapshot,
 remapPaneTree,
 sanitizePaneTree,
 sessionInfoToSavedTab,
 isCommandSessionRunning,
 isAgentSessionRunning,
 type PersistSnapshot
} from './session-layout'
import { runFirstRunSeed } from './first-run'
import { getMemPalaceStatus, ensureMemPalace, mempalaceMcpSnippet } from './mempalace'
import {
 loadMemoryProviders,
 saveMemoryProviders,
 listProviderStatuses,
 ensureEnabledProviders,
 setProviderEnabled,
 upsertMemoryProvider,
 removeMemoryProvider,
 addCustomMcpProvider,
 buildMcpServerMap,
 defaultMemoryProviders
} from './memory-providers'
import {
 onProjectOpen,
 onProjectOpenFast,
 onAgentSpawnFast,
 getRuntimeStatus,
 getProjectSetupStatus,
 setupProject,
 warmProjectInBackground,
 reconcileMineStampInBackground
} from './memory-service'
import {
 injectMemoryForAgent,
 injectMemoryForSyncedAgents,
 listMemorySpaces,
 pickMemorySpaceFolder,
 applyPalaceToProviders,
 getConfiguredPalacePath,
 DEFAULT_SYNCED_AGENT_IDS
} from './agent-inject'
import {
 listAllMcpEntries,
 loadUserMcpServers,
 upsertUserMcpServer,
 removeUserMcpServer,
 setUserMcpEnabled,
 buildUnifiedMcpMap,
 injectMcpToAllClients,
 exportUnifiedMcpSnippets,
 purgeDockerMemoryMcpOnStartup
} from './mcp-hub'
import {
 listTasks,
 getTask,
 createTask,
 updateTask,
 deleteTask,
 onSessionExit as taskOnSessionExit
} from './tasks'
import { listRuns, endRun } from './runs'
import { dispatchTask } from './task-dispatch'
import { startDeckCommandWorker } from './deck-commands'
import { setDocumentViewerParent } from './document-viewer'
import { writeAppLock, clearAppLock } from './app-lock'
import { maybeWrapAgentFrame } from './agent-frame'
import {
 getGraphifyStatus,
 syncGraphify,
 scheduleGraphifySync
} from './graphify-service'
import { listRoles, saveRoles, getRole } from './roles'
import {
 listPipelines,
 listPipelineRuns,
 getPipelineRun,
 startPipeline,
 cancelPipelineRun,
 pausePipelineRun,
 resumePipelineRun
} from './orchestrator'
import {
 listNamedLayouts,
 saveCurrentLayout,
 deleteNamedLayout,
 getNamedLayout,
 presetTree
} from './layouts'
import { getGitReview } from './review'
import type { AgentRole, NamedLayout, TaskStatus } from '../shared/types'
import { checkForUpdates } from './update-check'
import {
 getOnboardingState,
 completeOnboarding,
 resetOnboarding
} from './onboarding'
import type {
 AgentPreset,
 AppSettings,
 MemoryProviderConfig,
 MemoryScope,
 ProjectOnOpenCommand,
 SessionInfo,
 SessionLayout
} from '../shared/types'

const isDev = !app.isPackaged

// Never hard-exit on stray async errors during restore/spawn (was killing the window)
process.on('uncaughtException', (err) => {
 console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
 console.error('[unhandledRejection]', reason)
})

/** Max agent/command tabs to respawn on launch (ConPTY storms crash Electron on Windows). */
const MAX_RESTORE_TABS = 4

function sameRootPath(a?: string | null, b?: string | null): boolean {
 if (!a || !b) return false
 return a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
 b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function loadSettings(): AppSettings {
 try {
 if (existsSync(getSettingsPath())) {
 const merged = {
 ...defaultSettings(),
 ...JSON.parse(readFileSync(getSettingsPath(), 'utf8'))
 } as AppSettings
 // Force off - in-PTY frame blanked CLIs (nested ConPTY). Setting is dead.
 if (merged.agentFrameTui || merged.frameShellPanes) {
 merged.agentFrameTui = false
 merged.frameShellPanes = false
 try {
 saveSettings(merged)
 } catch {
 /* ignore */
 }
 }
 return merged
 }
 } catch {
 // ignore
 }
 return defaultSettings()
}

function defaultSettings(): AppSettings {
 return {
 injectMemoryOnAgentStart: true,
 theme: 'dark',
 fontSize: 13,
 layoutMode: 'tabs',
 autoGrid: false,
 showQuickAgents: false,
 reopenLastProject: true,
 preferredAgentId: undefined,
 syncedAgentIds: [...DEFAULT_SYNCED_AGENT_IDS],
 palacePath: undefined,
 memoryProviders: defaultMemoryProviders(),
 maxPanes: 16,
 worktreeIsolationDefault: false,
 // In-band PTY frame opt-in only (Grok full-screen redraw leaks). Use Electron chrome bar.
 agentFrameTui: false,
 frameShellPanes: false,
 // Click paths in agent terminals → Document tab (Settings → MCP)
 openCliPathsInDocument: true,
 editorVimMode: false,
 showProjectExplorer: true,
 // Graphify + memory are automatic; these flags are legacy no-ops if present on disk
 graphifyEnabled: true,
 graphifyOnProjectOpen: 'always-update',
 graphifyWatch: false
 }
}

function saveSettings(s: AppSettings): void {
 mkdirSync(getGlobalDataDir(), { recursive: true })
 writeFileSync(getSettingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

let mainWindow: BrowserWindow | null = null
/** Rust backend when `truedeck-backend` binary is available */
let rustBackend: BackendBridge | null = null

async function rustCall<T>(method: string, params: unknown = {}): Promise<T | null> {
 if (!rustBackend?.isReady) return null
 try {
 return await rustBackend.request<T>(method, params)
 } catch (e) {
 console.warn(`[backend] ${method} failed`, e)
 return null
 }
}

/** Live sessions from the Rust backend only. */
async function listLiveSessions(): Promise<SessionInfo[]> {
 return listSessions()
}

function resolveAppIcon(): string | undefined {
 // Prefer platform-native assets so Windows taskbar/title use the TrueDeck mark.
 const names =
 process.platform === 'win32'
 ? ['icon.ico', 'icon.png', 'icon.svg']
 : process.platform === 'darwin'
 ? ['icon.icns', 'icon.png', 'icon.svg']
 : ['icon.png', 'icon.svg']

 const bases = app.isPackaged
 ? [process.resourcesPath, join(process.resourcesPath, 'resources')]
 : [
 join(app.getAppPath(), 'resources'),
 join(app.getAppPath(), 'build'),
 join(__dirname, '../../resources'),
 join(__dirname, '../../build')
 ]

 for (const base of bases) {
 for (const name of names) {
 const p = join(base, name)
 if (existsSync(p)) return p
 }
 }
 return undefined
}

function createWindow(): void {
 const iconPath = resolveAppIcon()
 /** Set after renderer layout flush on close - allows the real destroy pass. */
 let layoutFlushDone = false
 let shown = false
 const showMain = (): void => {
 if (shown || !mainWindow || mainWindow.isDestroyed()) return
 shown = true
 mainWindow.show()
 mainWindow.focus()
 }

 mainWindow = new BrowserWindow({
 width: 1440,
 height: 900,
 minWidth: 960,
 minHeight: 600,
 // Show immediately so the window is never "running but invisible"
 show: true,
 x: 80,
 y: 60,
 title: 'TrueDeck',
 backgroundColor: '#0c0c0c',
 // Custom title bar - no native Windows frame
 frame: false,
 titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
 autoHideMenuBar: true,
 icon: iconPath,
 center: true,
 alwaysOnTop: true, // brief: force visible above other apps, cleared after load
 paintWhenInitiallyHidden: true,
 webPreferences: {
 preload: join(__dirname, '../preload/index.js'),
 contextIsolation: true,
 nodeIntegration: false,
 sandbox: false,
 backgroundThrottling: true
 }
 })

 // Ensure visible + focused even if Windows lost the HWND
 showMain()
 mainWindow.setAlwaysOnTop(true)
 mainWindow.once('ready-to-show', () => {
 showMain()
 mainWindow?.setAlwaysOnTop(true)
 mainWindow?.focus()
 })
 mainWindow.webContents.once('did-finish-load', () => {
 showMain()
 // Drop always-on-top after UI is up so it behaves normally
 setTimeout(() => {
 try {
 if (mainWindow && !mainWindow.isDestroyed()) {
 mainWindow.setAlwaysOnTop(false)
 mainWindow.focus()
 }
 } catch {
 /* ignore */
 }
 }, 1500)
 })
 // Safety net
 setTimeout(() => {
 showMain()
 try {
 mainWindow?.setAlwaysOnTop(false)
 mainWindow?.center()
 mainWindow?.focus()
 } catch {
 /* ignore */
 }
 }, 3000)

 mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
 console.error('[renderer] did-fail-load', code, desc, url)
 showMain()
 })
 mainWindow.webContents.on('render-process-gone', (_e, details) => {
 console.error('[renderer] render-process-gone', details)
 // Recover from blank/black screen after renderer crash
 try {
 if (mainWindow && !mainWindow.isDestroyed()) {
 mainWindow.webContents.reload()
 }
 } catch {
 /* ignore */
 }
 })
 mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
 if (level >= 2) {
 console.warn(`[renderer console] ${message} (${sourceId}:${line})`)
 }
 })

 // Terminal font uses Ctrl+/- (see app:shortcut). Never use Chromium page zoom —
 // old Ctrl+- left partition zoom_levels (e.g. localhost: -2.5) and the whole
 // UI stayed tiny until Preferences were cleared.
 const resetPageZoom = (): void => {
 const wc = mainWindow?.webContents
 if (!wc || wc.isDestroyed()) return
 try {
 wc.setZoomLevel(0)
 wc.setZoomFactor(1)
 wc.setVisualZoomLevelLimits(1, 1)
 } catch {
 /* older Electron */
 }
 }
 resetPageZoom()
 mainWindow.webContents.on('did-finish-load', resetPageZoom)
 mainWindow.webContents.on('dom-ready', resetPageZoom)

 // App shortcuts while xterm/agent TUIs own focus.
 // Single owner: only claim chords the renderer actually handles.
 // Do NOT claim Ctrl+C/V (terminal copy/paste) or Ctrl+Shift+letter
 // (leave those for the agent / shell). Match by input.code on Windows.
 // Ctrl+Arrow: preventDefault on every keydown including auto-repeat so
 // held arrows never leak into the agent PTY.
 mainWindow.webContents.on('before-input-event', (event, input) => {
 if (input.type !== 'keyDown') return
 const ctrl = Boolean(input.control || input.meta)
 if (!ctrl) return

 const code = String(input.code || '')
 const keyRaw = String(input.key || '')
 const shift = Boolean(input.shift)
 const alt = Boolean(input.alt)
 const repeat = Boolean(input.isAutoRepeat)

 const send = (key: string): void => {
 event.preventDefault()
 const win = mainWindow
 if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
 win.webContents.send('app:shortcut', {
 key,
 shift,
 alt,
 ctrl: true,
 repeat
 })
 }
 }

 const arrowCode =
 code === 'ArrowLeft' ||
 code === 'ArrowRight' ||
 code === 'ArrowUp' ||
 code === 'ArrowDown'
 ? code
 : ''
 const arrowKey =
 keyRaw === 'ArrowLeft' ||
 keyRaw === 'ArrowRight' ||
 keyRaw === 'ArrowUp' ||
 keyRaw === 'ArrowDown'
 ? keyRaw
 : keyRaw === 'Left' ||
 keyRaw === 'Right' ||
 keyRaw === 'Up' ||
 keyRaw === 'Down'
 ? `Arrow${keyRaw}`
 : ''
 const arrow = arrowCode || arrowKey
 if (arrow) {
 send(arrow)
 return
 }

 if (code === 'Tab' || keyRaw === 'Tab') {
 send('Tab')
 return
 }

 // Font zoom: Ctrl+= / Ctrl++ in, Ctrl+- out, Ctrl+0 reset.
 // Claim before agent TUIs / Chromium page-zoom swallow the chord.
 const zoomKey =
 code === 'Equal' || code === 'NumpadAdd' || keyRaw === '+' || keyRaw === '='
 ? keyRaw === '+' || shift || code === 'NumpadAdd'
 ? '+'
 : '='
 : code === 'Minus' ||
 code === 'NumpadSubtract' ||
 keyRaw === '-' ||
 keyRaw === '_'
 ? '-'
 : code === 'Digit0' || code === 'Numpad0' || keyRaw === '0'
 ? '0'
 : ''
 if (zoomKey && !alt) {
 send(zoomKey)
 return
 }

 const letter =
 (keyRaw.length === 1 ? keyRaw.toLowerCase() : '') ||
 (code.startsWith('Key') ? code.slice(3).toLowerCase() : '')

 // Plain Ctrl+letter (no Shift/Alt): app actions. Skip auto-repeat.
 // w close · t agent · o project · s settings · n pop-out · d v-split · x h-split · z undo move
 if (
 !shift &&
 !alt &&
 !repeat &&
 ['w', 't', 'o', 's', 'n', 'd', 'x', 'z'].includes(letter)
 ) {
 send(letter)
 return
 }

 // Ctrl+Alt+D / Ctrl+Alt+X: unsplit / merge all panes
 if (!shift && alt && !repeat && (letter === 'd' || letter === 'x')) {
 send(letter)
 return
 }

 // Ctrl+1..9: jump tab (no Shift/Alt). Not Digit0 (zoom).
 const digit =
 (code.startsWith('Digit') && code.length === 6 ? code.slice(5) : '') ||
 (code.startsWith('Numpad') && code.length === 7 ? code.slice(6) : '') ||
 (/^[1-9]$/.test(keyRaw) ? keyRaw : '')
 if (digit && digit >= '1' && digit <= '9' && !shift && !alt && !repeat) {
 send(digit)
 return
 }

 // Everything else (Ctrl+C/V, Ctrl+Shift+*, bare agent chords) → page / PTY.
 })

 // Multi-pane layout lives in the renderer. Async fire-and-forget flush on
 // close often never ran (window destroyed mid-executeJavaScript) → session
 // tabs restored but paneTree collapsed to a single leaf / default ratios.
 // Block close until a sync flush (sendSync from renderer) finishes.
 mainWindow.on('close', (e) => {
 console.log('[window] close event, layoutFlushDone=', layoutFlushDone)
 if (layoutFlushDone) return
 if (!mainWindow || mainWindow.isDestroyed()) return
 if (mainWindow.webContents.isDestroyed()) {
 layoutFlushDone = true
 return
 }
 e.preventDefault()
 const win = mainWindow
 const flushTimer = setTimeout(() => {
 // Never hang forever on flush — force close after 1.5s
 console.warn('[window] layout flush timeout — closing')
 layoutFlushDone = true
 if (win && !win.isDestroyed()) win.close()
 }, 1500)
 void win.webContents
 .executeJavaScript(
 `try{if(typeof window.__truedeckFlushSessions==='function'){window.__truedeckFlushSessions();'ok'}else{'skip'}}catch(err){String(err&&err.message||err)}`,
 true
 )
 .catch((err) => {
 console.warn('[window] flush failed', err)
 return 'err'
 })
 .finally(() => {
 clearTimeout(flushTimer)
 layoutFlushDone = true
 if (win && !win.isDestroyed()) win.close()
 })
 })

 const emitMaxState = (): void => {
 mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
 }
 mainWindow.on('maximize', emitMaxState)
 mainWindow.on('unmaximize', emitMaxState)

 mainWindow.webContents.setWindowOpenHandler((details) => {
 shell.openExternal(details.url)
 return { action: 'deny' }
 })

 setSessionsWindow(mainWindow)
 rustBackend?.setWindow(mainWindow)
 setDocumentViewerParent(mainWindow)

 mainWindow.on('closed', () => {
 try {
 setSessionsWindow(null)
 } catch {
 /* ignore */
 }
 try {
 rustBackend?.setWindow(null)
 } catch {
 /* ignore */
 }
 try {
 setDocumentViewerParent(null)
 } catch {
 /* ignore */
 }
 if (mainWindow) mainWindow = null
 })

 // Prefer built renderer when present so `electron .` always works even if
 // ELECTRON_RENDERER_URL points at a dead Vite dev server.
 const builtHtml = join(__dirname, '../renderer/index.html')
 const devUrl = process.env['ELECTRON_RENDERER_URL']
 if (isDev && devUrl && !existsSync(builtHtml)) {
 console.log('[boot] loadURL', devUrl)
 void mainWindow.loadURL(devUrl)
 } else if (existsSync(builtHtml)) {
 console.log('[boot] loadFile', builtHtml)
 void mainWindow.loadFile(builtHtml)
 } else if (devUrl) {
 console.log('[boot] loadURL fallback', devUrl)
 void mainWindow.loadURL(devUrl)
 } else {
 console.error('[boot] no renderer found at', builtHtml)
 }
}

function registerIpc(): void {
 setDetachedMainGetter(() => mainWindow)
 ensureDetachedIpc()

 ipcMain.handle('clipboard:readText', () => {
 try {
 return clipboard.readText()
 } catch {
 return ''
 }
 })
 ipcMain.handle('clipboard:writeText', (_e, text: string) => {
 try {
 clipboard.writeText(String(text ?? ''))
 return true
 } catch {
 return false
 }
 })

 ipcMain.handle('app:getSettings', () => loadSettings())
 ipcMain.handle('app:setSettings', (_e, s: AppSettings) => {
 const next = { ...defaultSettings(), ...s }
 saveSettings(next)
 if (next.palacePath) {
 try {
 applyPalaceToProviders(next.palacePath)
 } catch {
 // ignore
 }
 }
 return loadSettings()
 })
 ipcMain.handle('app:firstRun', (_e, force?: boolean) => runFirstRunSeed(Boolean(force)))
 ipcMain.handle('app:version', () => app.getVersion())
 ipcMain.handle('app:checkUpdates', (_e, force?: boolean) => checkForUpdates(Boolean(force)))
 ipcMain.handle('app:onboarding', () => getOnboardingState())
 ipcMain.handle('app:completeOnboarding', (_e, skipped?: boolean) =>
 completeOnboarding(Boolean(skipped))
 )
 ipcMain.handle('app:resetOnboarding', () => resetOnboarding())

 // Custom window chrome (frameless) — works for main + detached pane windows
 ipcMain.handle('window:minimize', (e) => {
 const w = BrowserWindow.fromWebContents(e.sender) || mainWindow
 w?.minimize()
 })
 ipcMain.handle('window:maximize', (e) => {
 const w = BrowserWindow.fromWebContents(e.sender) || mainWindow
 if (!w) return false
 if (w.isMaximized()) w.unmaximize()
 else w.maximize()
 return w.isMaximized()
 })
 ipcMain.handle('window:close', (e) => {
 const w = BrowserWindow.fromWebContents(e.sender) || mainWindow
 w?.close()
 })
 ipcMain.handle('window:isMaximized', (e) => {
 const w = BrowserWindow.fromWebContents(e.sender) || mainWindow
 return w?.isMaximized() ?? false
 })
 ipcMain.handle('window:setTitle', (e, title: string) => {
 const t = String(title || 'TrueDeck').slice(0, 200)
 const w = BrowserWindow.fromWebContents(e.sender) || mainWindow
 w?.setTitle(t)
 return t
 })

 // MemPalace (native, no Docker) - kept for backward-compatible UI hooks
 ipcMain.handle('mempalace:status', () => getMemPalaceStatus())
 ipcMain.handle(
 'mempalace:ensure',
 (_e, opts?: { projectRoot?: string; wing?: string }) => ensureMemPalace(opts)
 )
 ipcMain.handle('mempalace:mcpSnippet', async () => {
 const s = await getMemPalaceStatus()
 return mempalaceMcpSnippet(s)
 })

 // Pluggable memory providers (TrueMemory + MemPalace + OpenMemory + custom MCP)
 ipcMain.handle('memoryProviders:list', () => loadMemoryProviders())
 ipcMain.handle('memoryProviders:status', () => listProviderStatuses())
 ipcMain.handle('memoryProviders:save', (_e, providers: MemoryProviderConfig[]) => {
 saveMemoryProviders(providers)
 return loadMemoryProviders()
 })
 ipcMain.handle('memoryProviders:setEnabled', (_e, id: string, enabled: boolean) =>
 setProviderEnabled(id, enabled)
 )
 ipcMain.handle('memoryProviders:upsert', (_e, provider: MemoryProviderConfig) =>
 upsertMemoryProvider(provider)
 )
 ipcMain.handle('memoryProviders:remove', (_e, id: string) => removeMemoryProvider(id))
 ipcMain.handle(
 'memoryProviders:addCustom',
 (_e, opts: { name: string; command: string; args?: string[]; env?: Record<string, string> }) =>
 addCustomMcpProvider(opts)
 )
 ipcMain.handle('memoryProviders:ensure', (_e, projectRoot?: string) =>
 ensureEnabledProviders(projectRoot)
 )
 ipcMain.handle('memoryProviders:mcpMap', () => buildUnifiedMcpMap())
 ipcMain.handle('memoryProviders:exportSnippet', () => {
 const snip = exportUnifiedMcpSnippets()
 return { cursor: snip.cursor, grokToml: snip.grokToml }
 })

 // ── Unified MCP hub (one config → all agent clients) ──
 ipcMain.handle('mcp:list', () => listAllMcpEntries())
 ipcMain.handle('mcp:listUser', () => loadUserMcpServers())
 ipcMain.handle('mcp:map', () => buildUnifiedMcpMap())
 ipcMain.handle(
 'mcp:upsert',
 (
 _e,
 entry: {
 id?: string
 name: string
 command: string
 args?: string[]
 env?: Record<string, string>
 enabled?: boolean
 description?: string
 }
 ) =>
 upsertUserMcpServer({
 id: entry.id || '',
 name: entry.name,
 command: entry.command,
 args: entry.args || [],
 env: entry.env,
 enabled: entry.enabled !== false,
 description: entry.description,
 source: 'user'
 })
 )
 ipcMain.handle('mcp:remove', (_e, id: string) => removeUserMcpServer(id))
 ipcMain.handle('mcp:setEnabled', (_e, id: string, enabled: boolean) =>
 setUserMcpEnabled(id, enabled)
 )
 ipcMain.handle('mcp:injectAll', (_e, projectRoot?: string) =>
 injectMcpToAllClients({ projectRoot })
 )
 ipcMain.handle('mcp:export', () => exportUnifiedMcpSnippets())

 ipcMain.handle('agents:list', () => loadAgents())
 ipcMain.handle('agents:probe', () => {
 clearResolveCache()
 return probeAgents(loadAgents())
 })
 ipcMain.handle('agents:save', (_e, agents: AgentPreset[]) => {
 saveAgents(agents)
 return agents
 })
 ipcMain.handle(
 'agents:addCustom',
 (
 _e,
 opts: {
 name: string
 command: string
 args?: string[]
 color?: string
 installCommand?: string
 description?: string
 }
 ) => {
 const cmd = String(opts?.command || '').trim()
 if (!cmd) throw new Error('Command is required')
 const preset = createCustomAgentPreset({
 name: String(opts?.name || '').trim() || cmd,
 command: cmd,
 args: Array.isArray(opts?.args) ? opts.args.map(String) : [],
 color: opts?.color,
 installCommand: opts?.installCommand,
 description: opts?.description
 })
 const next = [...loadAgents().filter((a) => a.id !== preset.id), preset]
 saveAgents(next)
 clearResolveCache()
 return { agents: loadAgents(), preset }
 }
 )
 ipcMain.handle('agents:removeCustom', (_e, agentId: string) => {
 const id = String(agentId || '')
 if (!id.startsWith('custom-') && !loadAgents().find((a) => a.id === id)?.custom) {
 throw new Error('Only custom CLIs can be removed here')
 }
 const next = loadAgents().filter((a) => a.id !== id)
 saveAgents(next)
 clearResolveCache()
 return loadAgents()
 })
 ipcMain.handle('agents:reset', () => {
 const d = getDefaultAgents()
 // Keep user custom CLIs when resetting built-ins
 const customs = loadAgents().filter((a) => a.custom || a.id.startsWith('custom-'))
 saveAgents([...d, ...customs])
 return loadAgents()
 })
 /** Open a shell tab and print the install one-liner for a missing CLI. */
 ipcMain.handle(
 'agents:installHelp',
 async (_e, opts: { projectRoot: string; agentId: string }) => {
 const agents = loadAgents()
 const agent = agents.find((a) => a.id === opts.agentId)
 if (!agent) throw new Error('Unknown agent')
 const probe = resolveAgentCommand(agent.id, agent.command, agent.args || [])
 if (probe.available) {
 return { alreadyInstalled: true, path: probe.command }
 }
 const install =
 probe.installCommand ||
 agent.installCommand ||
 `echo "No install command for ${agent.name}"`
 const isWin = process.platform === 'win32'
 const info = await rustSpawnCommand({
 projectRoot: opts.projectRoot,
 label: `install ${agent.name}`,
 command: isWin
 ? `Write-Host "=== Install ${agent.name} CLI ===" -ForegroundColor Cyan; Write-Host ""; Write-Host "Run:" -ForegroundColor Yellow; Write-Host '${install.replace(/'/g, "''")}' -ForegroundColor Green; Write-Host ""; Write-Host "Then restart TrueDeck / re-open agents palette." -ForegroundColor DarkGray; Write-Host ""; Write-Host "Paste & run the command above, or press Up and Enter if you want me to try it now." -ForegroundColor DarkGray; Write-Host ""; $ans = Read-Host "Type y to run install now"; if ($ans -eq 'y') { ${install} } else { Write-Host "Skipped. Copy the command when ready." }`
 : `echo "=== Install ${agent.name} CLI ==="; echo ""; echo "Run:"; echo '${install.replace(/'/g, `'\\''`)}'; echo ""; echo "Then re-open the agent palette in TrueDeck."; echo ""; printf "Type y to run install now: "; read ans; if [ "$ans" = "y" ]; then ${install}; else echo Skipped.; fi`,
 color: agent.color
 })
 mainWindow?.webContents.send('pty:spawned', info)
 return { alreadyInstalled: false, session: info, installCommand: install }
 }
 )

 // ── Project file reader (plans, markdown, source) ─────────────────────────
 ipcMain.handle(
 'files:readText',
 async (_e, filePath: string): Promise<{ path: string; content: string; mtimeMs: number }> => {
 const p = normalize(String(filePath || ''))
 if (!p || !existsSync(p) || !statSync(p).isFile()) {
 throw new Error('File not found')
 }
 // Cap huge files so the UI stays snappy (still enough for plans / modules)
 const st = statSync(p)
 if (st.size > 2_000_000) {
 throw new Error('File is larger than 2MB - open it in an external editor')
 }
 const content = readFileSync(p, 'utf8')
 return { path: p, content, mtimeMs: st.mtimeMs }
 }
 )
 ipcMain.handle('files:pathExists', (_e, filePath: string): boolean => {
 try {
 const p = normalize(String(filePath || ''))
 return Boolean(p && existsSync(p) && statSync(p).isFile())
 } catch {
 return false
 }
 })
 ipcMain.handle(
 'files:listDir',
 (
 _e,
 dirPath: string
 ): Array<{
 name: string
 path: string
 isDirectory: boolean
 isFile: boolean
 }> => {
 try {
 const dir = normalize(String(dirPath || ''))
 if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
 return []
 }
 const skip = new Set([
 'node_modules',
 '.git',
 '.hg',
 '.svn',
 'target',
 'dist',
 'out',
 'build',
 '.next',
 '.turbo',
 'coverage',
 '__pycache__',
 '.cache',
 '.venv',
 'venv',
 'release',
 'win-unpacked'
 ])
 const names = readdirSync(dir)
 const rows: Array<{
 name: string
 path: string
 isDirectory: boolean
 isFile: boolean
 }> = []
 for (const name of names) {
 if (!name || name === '.' || name === '..') continue
 // Hide most dotfolders except useful project ones
 if (name.startsWith('.') && !['.memory', '.truedeck', '.agents', '.github', '.vscode', '.kiro'].includes(name)) {
 continue
 }
 if (skip.has(name)) continue
 const full = join(dir, name)
 let st
 try {
 st = statSync(full)
 } catch {
 continue
 }
 rows.push({
 name,
 path: full,
 isDirectory: st.isDirectory(),
 isFile: st.isFile()
 })
 }
 rows.sort((a, b) => {
 if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
 return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
 })
 return rows
 } catch {
 return []
 }
 }
 )
 ipcMain.handle(
 'files:writeText',
 async (_e, filePath: string, content: string): Promise<{ path: string; mtimeMs: number }> => {
 const p = normalize(String(filePath || ''))
 if (!p) throw new Error('No path')
 mkdirSync(dirname(p), { recursive: true })
 writeFileSync(p, String(content ?? ''), 'utf8')
 const st = statSync(p)
 return { path: p, mtimeMs: st.mtimeMs }
 }
 )
 ipcMain.handle(
 'files:pickOpen',
 async (
 _e,
 opts?: { projectRoot?: string; title?: string }
 ): Promise<string | null> => {
 const root = opts?.projectRoot && existsSync(opts.projectRoot) ? opts.projectRoot : undefined
 const result = await dialog.showOpenDialog(mainWindow!, {
 properties: ['openFile'],
 title: opts?.title || 'Open file to read',
 defaultPath: root,
 filters: [
 {
 name: 'Text & code',
 extensions: [
 'md',
 'txt',
 'json',
 'ts',
 'tsx',
 'js',
 'jsx',
 'mjs',
 'cjs',
 'py',
 'rs',
 'go',
 'java',
 'kt',
 'cs',
 'cpp',
 'c',
 'h',
 'hpp',
 'css',
 'scss',
 'html',
 'xml',
 'yaml',
 'yml',
 'toml',
 'ini',
 'cfg',
 'sh',
 'ps1',
 'sql',
 'graphql',
 'env',
 'log',
 'lua',
 'luau',
 'rb',
 'php'
 ]
 },
 { name: 'Markdown', extensions: ['md', 'mdx', 'markdown'] },
 { name: 'All files', extensions: ['*'] }
 ]
 })
 if (result.canceled || !result.filePaths[0]) return null
 return result.filePaths[0]
 }
 )

 ipcMain.handle('projects:list', () => listProjects())
 ipcMain.handle('projects:add', async () => {
 const result = await dialog.showOpenDialog(mainWindow!, {
 properties: ['openDirectory']
 })
 if (result.canceled || !result.filePaths[0]) return null
 const root = result.filePaths[0]
 const suggested = suggestOnOpenCommands(root)
 return upsertProject(root, { onOpenCommands: suggested })
 })
 ipcMain.handle('projects:openPath', (_e, root: string) => {
 const suggested = suggestOnOpenCommands(root)
 const existing = listProjects().find((p) => p.root === root)
 return upsertProject(root, {
 onOpenCommands: existing?.onOpenCommands?.length ? existing.onOpenCommands : suggested
 })
 })
 /** Clone a git URL (or open an existing path) and register as a project. */
 ipcMain.handle(
 'projects:clone',
 async (
 _e,
 opts: { url: string; parentDir?: string; folderName?: string }
 ) => {
 return cloneRepoAsProject(opts || { url: '' })
 }
 )
 /**
 * Pick a parent folder and import every direct child that is a git repo
 * (plus the parent itself if it has .git).
 */
 ipcMain.handle('projects:importRepos', async () => {
 const result = await dialog.showOpenDialog(mainWindow!, {
 properties: ['openDirectory'],
 title: 'Import git repositories from folder'
 })
 if (result.canceled || !result.filePaths[0]) {
 return { imported: [] as ReturnType<typeof listProjects>, skipped: [] as string[], parent: null }
 }
 const parent = result.filePaths[0]
 const res = importReposFromFolder(parent)
 return { ...res, parent }
 })
 ipcMain.handle('projects:defaultCloneParent', () => getDefaultCloneParent())
 ipcMain.handle(
 'projects:pickCloneParent',
 async () => {
 const result = await dialog.showOpenDialog(mainWindow!, {
 properties: ['openDirectory'],
 title: 'Choose folder for git clones',
 defaultPath: getDefaultCloneParent()
 })
 if (result.canceled || !result.filePaths[0]) return null
 return result.filePaths[0]
 }
 )
 ipcMain.handle('projects:remove', (_e, id: string) => {
 removeProject(id)
 return true
 })
 ipcMain.handle('projects:setOnOpen', (_e, id: string, commands: ProjectOnOpenCommand[]) => {
 return setOnOpenCommands(id, commands)
 })
 ipcMain.handle(
 'projects:update',
 (
 _e,
 id: string,
 patch: Partial<{
 name: string
 onOpenCommands: ProjectOnOpenCommand[]
 defaultAgents: string[]
 color: string
 }>
 ) => {
 const existing = getProject(id)
 if (!existing) return undefined
 return upsertProject(existing.root, {
 name: patch.name ?? existing.name,
 onOpenCommands: patch.onOpenCommands ?? existing.onOpenCommands,
 defaultAgents: patch.defaultAgents ?? existing.defaultAgents,
 color: patch.color ?? existing.color
 })
 }
 )
 ipcMain.handle('projects:get', (_e, id: string) => getProject(id))
 /** Read `.truedeck/current-focus.md` for Electron agent chrome idea line. */
 ipcMain.handle('projects:getFocus', (_e, projectRoot: string) => {
 try {
 if (!projectRoot || !existsSync(projectRoot)) return null
 const focusPath = join(projectRoot, '.truedeck', 'current-focus.md')
 if (!existsSync(focusPath)) return null
 const text = readFileSync(focusPath, 'utf8')
 const title = (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() || ''
 const body = text
 .split(/\r?\n/)
 .map((l) => l.trim())
 .filter((l) => l && !l.startsWith('#') && !/^task:|^agent:/i.test(l))
 .join(' ')
 .replace(/\s+/g, ' ')
 .trim()
 const idea = body || title
 if (!idea && !title) return null
 return { title: title.slice(0, 80), idea: idea.slice(0, 160) }
 } catch {
 return null
 }
 })

 ipcMain.handle(
 'sessions:spawn',
 async (_e, opts: { projectRoot: string; agentId: string; cols?: number; rows?: number }) => {
 // Always resolve in TS first - block IDE fallbacks and missing CLIs before Rust/node spawn
 const agents = loadAgents()
 const agent = agents.find((a) => a.id === opts.agentId)
 if (!agent) throw new Error(`Unknown agent: ${opts.agentId}`)
 const resolved = resolveAgentCommand(agent.id, agent.command, agent.args || [])
 if (!resolved.available) {
 const install = resolved.installCommand || agent.installCommand || '(unknown)'
 throw new Error(
 `${agent.name} CLI not installed (${agent.command}). Install: ${install}`
 )
 }
 // Extra guard: never launch Cursor/VS Code IDE binaries
 // (Program Files\cursor\...\cursor.cmd → Cursor.exe)
 const cmdLower = resolved.command.toLowerCase().replace(/\//g, '\\')
 const isIde =
 cmdLower.endsWith('cursor.exe') ||
 cmdLower.endsWith('\\cursor.cmd') ||
 cmdLower.includes('\\program files\\cursor\\') ||
 cmdLower.includes('\\program files (x86)\\cursor\\') ||
 (cmdLower.includes('cursor') &&
 !cmdLower.includes('cursor-agent') &&
 !cmdLower.endsWith('node.exe'))
 if (isIde) {
 throw new Error(
 'Blocked: Cursor IDE is not supported. Install cursor-agent CLI only.'
 )
 }

 // Always raw CLI - in-PTY frame wrap disabled (blank terminals on Windows ConPTY)
 const spawnCommand = resolved.command
 const prepared = prepareNewSessionSpawn(
 agent.id,
 resolved.args || [],
 opts.projectRoot,
 resolved.command
 )
 const spawnArgs = prepared.args
 const notBefore = Date.now() - 500
 const { env: memEnv } = onAgentSpawnFast(opts.projectRoot)
 const extraEnv: Record<string, string> = {
 ...memEnv,
 TRUEDECK_PROJECT: opts.projectRoot
 }
 if (prepared.resumeToken) {
 extraEnv.TRUEDECK_CLI_SESSION = prepared.resumeToken
 }
 void maybeWrapAgentFrame

 console.log(
 `[spawn] ${agent.id} bind session=${prepared.resumeToken || '(discover)'} args=${spawnArgs.join(' ')}`
 )

 const viaRust = await rustSpawnAgent({
 projectRoot: opts.projectRoot,
 agentId: opts.agentId,
 cols: opts.cols,
 rows: opts.rows,
 command: spawnCommand,
 args: spawnArgs,
 agentName: agent.name,
 color: agent.color,
 env: extraEnv
 })

 // Codex session id discovery is background-only — never block palette spawn
 // for up to 5s while scanning ~/.codex.
 const resumeToken = prepared.resumeToken || viaRust.resumeToken
 if (!resumeToken && prepared.needsDiscover && agent.id === 'codex') {
 void discoverCodexSessionId(opts.projectRoot, notBefore, 5000)
 .then((token) => {
 const found = token || tryDiscoverCodexSessionId(opts.projectRoot, notBefore)
 if (!found) return
 console.log(`[spawn] codex discovered session ${found}`)
 mainWindow?.webContents.send('pty:spawned', {
 ...viaRust,
 resumeToken: found
 })
 })
 .catch(() => {
 /* ignore */
 })
 }

 const taskId =
 typeof extraEnv.TRUEDECK_TASK === 'string' ? extraEnv.TRUEDECK_TASK : undefined
 const withFocus = {
 ...viaRust,
 title: extraEnv.TRUEDECK_TASK_TITLE || viaRust.title,
 focusTitle: extraEnv.TRUEDECK_TASK_TITLE || undefined,
 focusIdea: extraEnv.TRUEDECK_TASK_IDEA || undefined,
 taskId,
 taskStatus: taskId ? ('running' as const) : undefined,
 roleLabel:
 typeof extraEnv.TRUEDECK_ROLE_LABEL === 'string'
 ? extraEnv.TRUEDECK_ROLE_LABEL
 : undefined,
 worktreeLabel:
 typeof extraEnv.TRUEDECK_WORKTREE_LABEL === 'string'
 ? extraEnv.TRUEDECK_WORKTREE_LABEL
 : undefined,
 resumeToken: resumeToken || undefined
 }
 mainWindow?.webContents.send('pty:spawned', withFocus)
 return withFocus
 }
 )
 ipcMain.handle(
 'sessions:spawnCommand',
 async (
 _e,
 opts: { projectRoot: string; label: string; command: string; color?: string; cols?: number; rows?: number }
 ) => {
 const info = await rustSpawnCommand(opts)
 mainWindow?.webContents.send('pty:spawned', info)
 return info
 }
 )
 ipcMain.handle('sessions:list', async () => listSessions())
 ipcMain.handle('sessions:backend', async () => {
 await requireRustBackend()
 return backendStatus()
 })
 /** Session I/O - Rust backend only. */
 ipcMain.handle('sessions:write', async (_e, id: string, data: string) => {
 await writeSession(id, data)
 })
 ipcMain.handle(
 'sessions:resize',
 async (_e, id: string, cols: number, rows: number, _force?: boolean) => {
 await resizeSession(id, cols, rows)
 }
 )
 ipcMain.handle('sessions:kill', async (_e, id: string) => {
 // Never kill-all: require a real session id (closing one tab must not wipe the deck)
 if (!id || typeof id !== 'string' || !id.trim()) {
 console.warn('[sessions:kill] ignored empty id')
 return
 }
 const sid = id.trim()
 try {
 const live = (await listLiveSessions()).find((s) => s.id === sid)
 endRun(sid, -1)
 taskOnSessionExit(sid, -1)
 if (live?.projectRoot) scheduleGraphifySync(live.projectRoot, 'update')
 } catch {
 // ignore
 }
 await killSession(sid)
 })

 // ── Tasks (BridgeBoard) ──
 ipcMain.handle('tasks:list', (_e, projectRoot?: string) => listTasks(projectRoot))
 ipcMain.handle('tasks:get', (_e, id: string) => getTask(id))
 ipcMain.handle(
 'tasks:create',
 (
 _e,
 input: {
 projectRoot: string
 title: string
 body?: string
 status?: TaskStatus
 assigneeAgentId?: string
 roleId?: string
 isolate?: boolean
 }
 ) => createTask(input)
 )
 ipcMain.handle(
 'tasks:update',
 (
 _e,
 id: string,
 patch: Partial<{
 title: string
 body: string
 status: TaskStatus
 assigneeAgentId: string
 roleId: string
 }>
 ) => updateTask(id, patch)
 )
 ipcMain.handle('tasks:delete', (_e, id: string) => deleteTask(id))
 ipcMain.handle(
 'tasks:dispatch',
 async (_e, taskId: string, agentId?: string) => {
 const result = await dispatchTask(taskId, agentId)
 mainWindow?.webContents.send('pty:spawned', result.session)
 return result
 }
 )
 ipcMain.handle('runs:list', (_e, opts?: { projectRoot?: string; taskId?: string; limit?: number }) =>
 listRuns(opts)
 )
 ipcMain.handle('tasks:onSessionExit', async (_e, sessionId: string, exitCode?: number) => {
 endRun(sessionId, exitCode)
 try {
 const live = (await listLiveSessions()).find((s) => s.id === sessionId)
 if (live?.projectRoot) scheduleGraphifySync(live.projectRoot, 'update')
 } catch {
 /* ignore */
 }
 return taskOnSessionExit(sessionId, exitCode)
 })

 // Layout I/O always uses the TS path. Rust SessionLayout lacks paneTree /
 // focusedGroupTabIndex and save_layout rewrites version:1, which used to
 // strip multi-pane state from session-layout.json.
 ipcMain.handle('sessions:getLayout', async () => loadSessionLayout())

 ipcMain.handle('sessions:saveLayout', async (_e, layout: SessionLayout) => {
 return saveSessionLayout(layout)
 })

 /** Shared persist path - used by async invoke and sync quit flush. */
 const applyPersistSnapshot = (
 snapshot: PersistSnapshot,
 live?: SessionInfo[]
 ): SessionLayout => {
 // Prefer TS path so nested paneTree is preserved.
 // Trust renderer sessionOrder + tabs[]; do not append orphan live PTYs
 // (that desynced paneTree indices and collapsed multi-pane on next launch).
 // live is optional - when missing (sync quit), renderer tabs are enough.
 // Prefer explicit live list; on sync quit renderer tabs alone are enough
 const sessions = live ?? []
 const built = layoutFromPersistSnapshot(
 snapshot || ({} as PersistSnapshot),
 sessions
 )
 return saveSessionLayout(built)
 }

 /** Persist current open tabs + focus/split from the renderer. */
 ipcMain.handle('sessions:persist', async (_e, snapshot: PersistSnapshot) => {
 const live = await listLiveSessions()
 return applyPersistSnapshot(snapshot, live)
 })

 /**
 * Synchronous flush for pagehide / beforeunload / window close.
 * Async invoke often does not finish before the process dies, so multi-pane
 * layouts were lost on quit. Renderer tabs[] are authoritative here because
 * we cannot await rust sessions.list on the sync path.
 */
 ipcMain.on('sessions:persist-sync', (e, snapshot: PersistSnapshot) => {
 try {
 e.returnValue = applyPersistSnapshot(snapshot)
 } catch (err) {
 e.returnValue = {
 error: err instanceof Error ? err.message : String(err)
 }
 }
 })

 /** Respawn tabs from the last saved layout (app restart). Hard-capped. */
 ipcMain.handle('sessions:restore', async () => {
 const t0 = Date.now()
 try {
 await requireRustBackend()
 const layout = loadSessionLayout()
 if (!layout.tabs.length) {
 return { layout, sessions: [] as SessionInfo[], restored: 0 }
 }

 // STABILITY (Windows): auto-respawning many ConPTY agent tabs on launch was
 // freezing/killing the app ("closed by itself"). Skip PTY restore by default;
 // keep project root so the UI opens to the right workspace. User launches agents.
 const skipPtyRestore =
 process.env.TRUEDECK_RESTORE_PTYS !== '1' && process.env.TRUEDECK_RESTORE_PTYS !== 'true'
 if (skipPtyRestore) {
 console.log(
 `[layout] restore: skipping ${layout.tabs.length} PTY tab(s) on launch (set TRUEDECK_RESTORE_PTYS=1 to enable)`
 )
 if (layout.activeProjectRoot && existsSync(layout.activeProjectRoot)) {
 try {
 onProjectOpenFast(layout.activeProjectRoot)
 upsertProject(layout.activeProjectRoot)
 warmProjectInBackground(layout.activeProjectRoot)
 } catch {
 /* ignore */
 }
 }
 console.log(`[layout] restore done (no PTYs) in ${Date.now() - t0}ms`)
 return {
 layout: {
 ...layout,
 tabs: [],
 paneTree: null,
 activeIndex: 0,
 splitIndex: null,
 focusedGroupTabIndex: null
 },
 sessions: [] as SessionInfo[],
 restored: 0
 }
 }

 // Prefer tabs for the last active project only — restoring 9 ConPTYs across
 // 5 folders has been freezing/killing Electron on Windows.
 const activeRoot = layout.activeProjectRoot
 const indexed = layout.tabs
 .map((tab, ti) => ({ tab, ti }))
 .filter(({ tab }) => tab.projectRoot && existsSync(tab.projectRoot))
 const inActive = activeRoot
 ? indexed.filter(({ tab }) => sameRootPath(tab.projectRoot, activeRoot))
 : []
 let pick = inActive.length ? inActive : indexed
 // Keep focused tab first when present
 const focusTi =
 typeof layout.focusedGroupTabIndex === 'number'
 ? layout.focusedGroupTabIndex
 : layout.activeIndex
 pick = [
 ...pick.filter((p) => p.ti === focusTi),
 ...pick.filter((p) => p.ti !== focusTi)
 ].slice(0, MAX_RESTORE_TABS)

 console.log(
 `[layout] restore: ${pick.length}/${layout.tabs.length} tab(s) ` +
 `(active=${activeRoot || 'any'}, max ${MAX_RESTORE_TABS})`
 )

 const agents = loadAgents()
 const sessions: SessionInfo[] = []
 const oldToNew = new Map<number, number>()
 const rootsWarmed = new Set<string>()
 const backendLive = await listLiveSessions()

 for (const { tab } of pick) {
 if (!tab.projectRoot || rootsWarmed.has(tab.projectRoot)) continue
 try {
 onProjectOpenFast(tab.projectRoot)
 upsertProject(tab.projectRoot)
 } catch {
 /* ignore */
 }
 rootsWarmed.add(tab.projectRoot)
 }

 // Sequential spawn — parallel ConPTY on Windows is a common crash source
 for (const { tab, ti } of pick) {
 if (sessions.length >= MAX_RESTORE_TABS) break
 try {
 if (tab.kind === 'document' || tab.documentPath) {
 const docPath = (tab.documentPath || '').trim()
 if (!docPath || !existsSync(docPath)) continue
 const name = docPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'File'
 const info: SessionInfo = {
 id: `doc-${Date.now().toString(36)}-${ti}`,
 agentId: 'document',
 agentName: 'Doc',
 color: tab.color || '#a78bfa',
 projectRoot: tab.projectRoot,
 status: 'running',
 createdAt: Date.now(),
 title: tab.title || name,
 kind: 'document',
 documentPath: docPath
 }
 oldToNew.set(ti, sessions.length)
 sessions.push(info)
 continue
 }

 const liveAll = [...sessions, ...backendLive]

 if (tab.kind === 'command' || tab.commandLine) {
 const existing = liveAll.find(
 (s) =>
 isCommandSessionRunning([s], tab.projectRoot, {
 command: tab.commandLine,
 label: tab.agentName,
 agentId: tab.agentId
 })
 )
 if (existing) {
 const kept = { ...existing, title: tab.title || existing.title }
 if (!sessions.some((s) => s.id === existing.id)) {
 oldToNew.set(ti, sessions.length)
 sessions.push(kept)
 } else {
 oldToNew.set(ti, sessions.findIndex((s) => s.id === existing.id))
 }
 continue
 }
 const info = await rustSpawnCommand({
 projectRoot: tab.projectRoot,
 label: tab.agentName || 'cmd',
 command: tab.commandLine || 'echo restored',
 color: tab.color
 })
 mainWindow?.webContents.send('pty:spawned', info)
 oldToNew.set(ti, sessions.length)
 sessions.push(info)
 continue
 }

 const agent = agents.find((a) => a.id === tab.agentId)
 if (!agent) continue
 const reuseAgent = liveAll.find((s) =>
 isAgentSessionRunning([s], tab.projectRoot, tab.agentId)
 )
 if (reuseAgent) {
 const kept: SessionInfo = {
 ...reuseAgent,
 title: tab.title || reuseAgent.title,
 resumeToken: tab.resumeToken || reuseAgent.resumeToken
 }
 if (!sessions.some((s) => s.id === reuseAgent.id)) {
 oldToNew.set(ti, sessions.length)
 sessions.push(kept)
 } else {
 oldToNew.set(ti, sessions.findIndex((s) => s.id === reuseAgent.id))
 }
 continue
 }

 const { env } = onAgentSpawnFast(tab.projectRoot)
 const resolved = resolveAgentCommand(agent.id, agent.command, agent.args || [])
 if (!resolved.available) continue

 const savedToken = (tab.resumeToken || '').trim()
 let spawnArgs = resolved.args || []
 let resumeToken: string | null = savedToken || null
 let needsDiscover = false
 const notBefore = Date.now() - 500

 if (savedToken) {
 const resumed = prepareResumeSpawn(agent.id, resolved.args || [], savedToken)
 if (resumed) {
 spawnArgs = resumed
 console.log(
 `[layout] resume ${agent.id} id=${savedToken} → ${resolved.command} ${spawnArgs.join(' ')}`
 )
 }
 } else {
 const prepared = prepareNewSessionSpawn(
 agent.id,
 resolved.args || [],
 tab.projectRoot,
 resolved.command
 )
 spawnArgs = prepared.args
 resumeToken = prepared.resumeToken
 needsDiscover = prepared.needsDiscover
 console.log(
 `[layout] restore ${agent.id}: new session=${resumeToken || '(discover)'}`
 )
 }

 const info = await rustSpawnAgent({
 projectRoot: tab.projectRoot,
 agentId: agent.id,
 command: resolved.command,
 args: spawnArgs,
 agentName: agent.name,
 color: agent.color,
 env: {
 ...env,
 ...(resumeToken ? { TRUEDECK_CLI_SESSION: resumeToken } : {})
 }
 })

 if (!resumeToken && needsDiscover && agent.id === 'codex') {
 resumeToken =
 (await discoverCodexSessionId(tab.projectRoot, notBefore, 800)) ||
 tryDiscoverCodexSessionId(tab.projectRoot, notBefore)
 }

 const withTitle: SessionInfo = {
 ...info,
 title: tab.title || info.title,
 resumeToken: resumeToken || info.resumeToken
 }
 mainWindow?.webContents.send('pty:spawned', withTitle)
 oldToNew.set(ti, sessions.length)
 sessions.push(withTitle)
 } catch (e) {
 console.warn('[layout] skip tab', ti, tab.agentId, e)
 }
 // Yield between ConPTY creates
 await new Promise((r) => setTimeout(r, 80))
 }

 for (const root of rootsWarmed) {
 warmProjectInBackground(root)
 }

 console.log(`[layout] restore spawns done in ${Date.now() - t0}ms`)

 const remappedTree = remapPaneTree(sanitizePaneTree(layout.paneTree), oldToNew)
 const mapIdx = (i: number | null | undefined): number | null => {
 if (i == null || typeof i !== 'number') return null
 return oldToNew.has(i) ? oldToNew.get(i)! : null
 }
 const activeIndex = mapIdx(layout.activeIndex) ?? 0
 const splitIndex = mapIdx(layout.splitIndex)
 const focusedGroupTabIndex = mapIdx(layout.focusedGroupTabIndex ?? layout.activeIndex)

 const nextLayout = saveSessionLayout({
 version: 2,
 activeProjectRoot: layout.activeProjectRoot,
 activeIndex,
 splitIndex:
 splitIndex != null && sessions.length >= 2 && splitIndex !== activeIndex
 ? splitIndex
 : null,
 splitRatio: layout.splitRatio,
 tabs: sessions.map(sessionInfoToSavedTab),
 paneTree: remappedTree,
 focusedGroupTabIndex,
 savedAt: Date.now()
 })

 console.log(
 `[layout] restore done: ${sessions.length}/${layout.tabs.length} tab(s), paneTree=${
 nextLayout.paneTree?.type || 'none'
 }`
 )

 return { layout: nextLayout, sessions, restored: sessions.length }
 } catch (e) {
 console.error('[layout] restore failed hard — opening empty', e)
 const layout = loadSessionLayout()
 return { layout, sessions: [] as SessionInfo[], restored: 0 }
 }
 })

 ipcMain.handle('sessions:openProject', async (_e, projectId: string) => {
 const project = getProject(projectId) || listProjects().find((p) => p.root === projectId)
 if (!project) throw new Error('Project not found')
 upsertProject(project.root) // touch lastOpened

 // Cheap paths immediately; full memory/MCP warm in background
 const mem = onProjectOpenFast(project.root)
 warmProjectInBackground(project.root)

 // Only spawn on-open / default agents when nothing matching is already live.
 // Re-opening (or restore + open) used to stack Rojo/Shell until MAX_SAVED_TABS.
 // Include Rust-backend sessions - UI spawn prefers truedeck-backend.
 const liveHere = (await listLiveSessions()).filter((s) => s.status === 'running')

 const launched: string[] = []
 const reused: string[] = []
 for (const cmd of project.onOpenCommands || []) {
 if (!cmd.enabled) continue
 if (
 isCommandSessionRunning(liveHere, project.root, {
 command: cmd.command,
 label: cmd.label
 })
 ) {
 const existing = liveHere.find((s) =>
 isCommandSessionRunning([s], project.root, {
 command: cmd.command,
 label: cmd.label
 })
 )
 if (existing) reused.push(existing.id)
 console.log(`[openProject] skip on-open "${cmd.label}" - already running`)
 continue
 }
 const info = await rustSpawnCommand({
 projectRoot: project.root,
 label: cmd.label,
 command: cmd.command,
 color: '#3b82f6'
 })
 mainWindow?.webContents.send('pty:spawned', info)
 launched.push(info.id)
 liveHere.push(info)
 }
 const agents = loadAgents()
 const { env } = onAgentSpawnFast(project.root)
 for (const agentId of project.defaultAgents || []) {
 const agent = agents.find((a) => a.id === agentId)
 if (!agent) continue
 if (isAgentSessionRunning(liveHere, project.root, agentId)) {
 const existing = liveHere.find((s) =>
 isAgentSessionRunning([s], project.root, agentId)
 )
 if (existing) reused.push(existing.id)
 console.log(`[openProject] skip default agent "${agentId}" - already running`)
 continue
 }
 const resolved = resolveAgentCommand(agent.id, agent.command, agent.args || [])
 if (!resolved.available) continue
 const prepared = prepareNewSessionSpawn(
 agent.id,
 resolved.args || [],
 project.root,
 resolved.command
 )
 const notBefore = Date.now() - 500
 const info = await rustSpawnAgent({
 projectRoot: project.root,
 agentId: agent.id,
 command: resolved.command,
 args: prepared.args,
 agentName: agent.name,
 color: agent.color,
 env: {
 ...env,
 ...(prepared.resumeToken ? { TRUEDECK_CLI_SESSION: prepared.resumeToken } : {})
 }
 })
 let resumeToken = prepared.resumeToken
 if (!resumeToken && prepared.needsDiscover && agent.id === 'codex') {
 resumeToken =
 (await discoverCodexSessionId(project.root, notBefore, 4000)) ||
 tryDiscoverCodexSessionId(project.root, notBefore)
 }
 const withToken: SessionInfo = {
 ...info,
 resumeToken: resumeToken || info.resumeToken
 }
 mainWindow?.webContents.send('pty:spawned', withToken)
 launched.push(withToken.id)
 liveHere.push(withToken)
 }
 // sessionIds = newly launched only; reused are already in the UI store
 return { project, sessionIds: launched, reusedSessionIds: reused, memory: mem }
 })

 ipcMain.handle('memory:status', (_e, projectRoot?: string) => getRuntimeStatus(projectRoot))
 ipcMain.handle(
 'project:setupStatus',
 (_e, projectRoot: string, openAgentIds?: string[]) => {
 const root = String(projectRoot || '')
 const open = openAgentIds || []
 const st = getProjectSetupStatus(root, open)
 // Never await mempalace status here — that CLI freezes tab open for seconds.
 // Reconcile stamp in the background; next poll clears "Memory warming…".
 if (root && st.ready && st.warming) {
 reconcileMineStampInBackground(root)
 }
 return st
 }
 )
 ipcMain.handle(
 'project:setup',
 async (
 _e,
 opts: { projectRoot: string; openAgentIds?: string[] }
 ): Promise<import('../shared/types').ProjectSetupResult> => {
 const s = loadSettings()
 return setupProject({
 projectRoot: String(opts.projectRoot || ''),
 openAgentIds: opts.openAgentIds,
 settings: s
 })
 }
 )

 // ── Graphify knowledge graph ──
 ipcMain.handle('graphify:status', (_e, projectRoot?: string) =>
 getGraphifyStatus(projectRoot || null)
 )
 ipcMain.handle(
 'graphify:sync',
 async (_e, projectRoot: string, mode?: 'full' | 'update') => {
 if (!projectRoot) throw new Error('projectRoot required')
 return syncGraphify(projectRoot, mode === 'full' ? 'full' : 'update')
 }
 )

 // ── Roles (orchestration personas) ──
 ipcMain.handle('roles:list', () => listRoles())
 ipcMain.handle('roles:save', (_e, roles: AgentRole[]) => saveRoles(roles || []))
 ipcMain.handle('roles:get', (_e, id: string) => getRole(id) || null)

 // ── Pipelines / orchestrator ──
 ipcMain.handle('pipelines:list', () => listPipelines())
 ipcMain.handle('pipelines:runs', (_e, projectRoot?: string) => listPipelineRuns(projectRoot))
 ipcMain.handle('pipelines:getRun', (_e, id: string) => getPipelineRun(id) || null)
 ipcMain.handle(
 'pipelines:start',
 async (
 _e,
 opts: { pipelineId: string; projectRoot: string; title: string; body?: string }
 ) => {
 const s = loadSettings()
 return startPipeline({
 ...opts,
 isolationDefault: s.worktreeIsolationDefault === true
 })
 }
 )
 ipcMain.handle('pipelines:cancel', (_e, id: string) => cancelPipelineRun(id))
 ipcMain.handle('pipelines:pause', (_e, id: string) => pausePipelineRun(id))
 ipcMain.handle('pipelines:resume', (_e, id: string) => resumePipelineRun(id))

 // ── Named layouts ──
 ipcMain.handle('layouts:list', () => listNamedLayouts())
 ipcMain.handle('layouts:get', (_e, id: string) => getNamedLayout(id) || null)
 ipcMain.handle('layouts:preset', (_e, preset: string) => presetTree(preset))
 ipcMain.handle(
 'layouts:save',
 (
 _e,
 input: { name: string; paneTree: SessionLayout['paneTree']; fillAgentIds?: string[] }
 ) => saveCurrentLayout(input)
 )
 ipcMain.handle('layouts:delete', (_e, id: string) => deleteNamedLayout(id))

 // ── Review (git) ──
 ipcMain.handle('review:git', (_e, projectRoot: string) => getGitReview(projectRoot))
 /** Lightweight branch name for agent chrome (no full review snapshot). */
 ipcMain.handle('git:branch', async (_e, projectRoot: string) => {
 if (!projectRoot || typeof projectRoot !== 'string') return null
 try {
 const { execFile } = await import('child_process')
 const { promisify } = await import('util')
 const execFileAsync = promisify(execFile)
 const { stdout } = await execFileAsync(
 'git',
 ['-C', projectRoot, 'rev-parse', '--abbrev-ref', 'HEAD'],
 { windowsHide: true, timeout: 4000, encoding: 'utf8' }
 )
 const b = (stdout || '').trim()
 return b || null
 } catch {
 return null
 }
 })

 ipcMain.handle('memory:listSpaces', async () => {
 const via = await rustCall('memory.listSpaces', {})
 if (via) return via
 return listMemorySpaces()
 })
 ipcMain.handle('memory:pickSpace', () => pickMemorySpaceFolder())
 ipcMain.handle('memory:getPalacePath', async () => {
 const via = await rustCall<string>('memory.getPalacePath', {})
 if (via) return via
 const s = loadSettings()
 return getConfiguredPalacePath(s)
 })
 ipcMain.handle('memory:setPalacePath', async (_e, palacePath: string) => {
 const via = await rustCall('memory.setPalacePath', { path: palacePath })
 if (via) return via
 const s = loadSettings()
 const next = { ...s, palacePath }
 saveSettings(next)
 applyPalaceToProviders(palacePath)
 return next
 })
 ipcMain.handle(
 'memory:injectForAgent',
 async (
 _e,
 opts: {
 agentId?: string
 agentIds?: string[]
 projectRoot?: string
 palacePath?: string
 /** When true (default for project open), sync entire syncedAgentIds set */
 allSynced?: boolean
 }
 ) => {
 // Always use TS inject so unified MCP hub reaches every client
 // (Rust inject only knows MemPalace).
 const s = loadSettings()
 const palace = opts.palacePath || s.palacePath || getConfiguredPalacePath(s)
 if (opts.palacePath || !s.palacePath) {
 saveSettings({ ...s, palacePath: palace })
 }
 if (opts.allSynced || opts.agentId === 'all' || (!opts.agentId && !opts.agentIds?.length)) {
 return injectMemoryForSyncedAgents({
 projectRoot: opts.projectRoot,
 palacePath: palace,
 force: true,
 settings: s
 })
 }
 if (opts.agentIds?.length) {
 return injectMemoryForAgent({
 agentId: 'all',
 agentIds: opts.agentIds,
 projectRoot: opts.projectRoot,
 palacePath: palace,
 force: true,
 settings: s
 })
 }
 return injectMemoryForAgent({
 agentId: opts.agentId || 'all',
 projectRoot: opts.projectRoot,
 palacePath: palace,
 force: true,
 settings: s
 })
 }
 )

 ipcMain.handle('memory:list', (_e, scope: MemoryScope, projectRoot?: string) =>
 listMemory(scope, projectRoot)
 )
 ipcMain.handle('memory:read', (_e, filePath: string) => readMemoryNote(filePath))
 ipcMain.handle(
 'memory:write',
 (
 _e,
 opts: { scope: MemoryScope; projectRoot?: string; relativePath: string; content: string }
 ) => writeMemoryNote(opts)
 )
 ipcMain.handle('memory:delete', (_e, filePath: string) => {
 deleteMemoryNote(filePath)
 return true
 })
 ipcMain.handle('memory:bootstrap', (_e, projectRoot?: string) =>
 buildAgentBootstrapPrompt(projectRoot)
 )
 ipcMain.handle('memory:ensure', (_e, projectRoot?: string) => {
 const global = ensureGlobalMemory()
 if (projectRoot) {
 return { global, repo: ensureRepoMemory(projectRoot) }
 }
 return { global }
 })

 ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
 ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
 ipcMain.handle('shell:showItem', (_e, p: string) => {
 shell.showItemInFolder(p)
 })
}

app.whenReady().then(() => {
 const bootT0 = Date.now()
 // Windows taskbar grouping + correct custom icon
 if (process.platform === 'win32') {
 app.setAppUserModelId('dev.truedeck.app')
 }
 // Critical path only: data dir, lock, IPC, window. Everything else is deferred.
 try {
 mkdirSync(getGlobalDataDir(), { recursive: true })
 } catch {
 /* ignore */
 }
 writeAppLock()
 registerIpc()

 // Always register quit cleanup immediately (never nest inside deferred setTimeout)
 let stopDeckWorker: (() => void) | null = null
 const cleanupOnQuit = (): void => {
 try {
 stopDeckWorker?.()
 } catch {
 /* ignore */
 }
 try {
 clearAppLock()
 } catch {
 /* ignore */
 }
 }
 app.on('will-quit', cleanupOnQuit)
 app.on('before-quit', cleanupOnQuit)

 // 1) Window first — user sees TrueDeck ASAP (do not await backend/memory)
 createWindow()
 console.log(`[boot] window created ${Date.now() - bootT0}ms`)

 // 2) Backend in parallel with renderer load (needed for restore, not for paint)
 void (async () => {
 try {
 rustBackend = await getBackend()
 if (rustBackend) {
 if (mainWindow && !mainWindow.isDestroyed()) {
 setSessionsWindow(mainWindow)
 rustBackend.setWindow(mainWindow)
 }
 console.log('[backend] ready', `${Date.now() - bootT0}ms`)
 } else {
 console.error(
 '[backend] truedeck-backend failed to start - sessions will not work until it is available'
 )
 }
 } catch (e) {
 console.error('[backend] startup error', e)
 }
 })()

 // 3) Non-critical: memory tree, MCP purge, MemPalace, deck worker — after paint
 const deferMs = isDev ? 200 : 100
 setTimeout(() => {
 try {
 ensureGlobalMemory()
 } catch {
 /* ignore */
 }
 void (async () => {
 try {
 const r = purgeDockerMemoryMcpOnStartup()
 if (r.serverCount >= 0) console.log('[mcp-hub]', r.message)
 } catch (e) {
 console.warn('[mcp-hub] startup purge failed', e)
 }
 try {
 await ensureEnabledProviders()
 } catch {
 /* optional */
 }
 })()
 try {
 stopDeckWorker = startDeckCommandWorker({
 onSession: (session) => {
 mainWindow?.webContents.send('pty:spawned', session)
 }
 })
 } catch (e) {
 console.warn('[deck-commands] worker start failed', e)
 }
 }, deferMs)

 app.on('activate', () => {
 if (BrowserWindow.getAllWindows().length === 0) createWindow()
 })
 console.log(`[boot] whenReady critical path ${Date.now() - bootT0}ms`)
})

let shuttingDown = false
function persistAndDisposeSessions(): void {
 if (shuttingDown) return
 shuttingDown = true
 try {
 setSessionsWindow(null)
 // Renderer owns full paneTree + sessionOrder via sessions:persist.
 // Do not rebuild layout from live PTY order on quit.
 } catch {
 // ignore
 }
}

app.on('window-all-closed', () => {
 try {
 persistAndDisposeSessions()
 } catch {
 /* ignore */
 }
 try {
 shutdownBackend()
 } catch {
 /* ignore */
 }
 if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
 try {
 persistAndDisposeSessions()
 } catch {
 /* ignore */
 }
 try {
 shutdownBackend()
 } catch {
 /* ignore */
 }
 try {
 clearAppLock()
 } catch {
 /* ignore */
 }
})
