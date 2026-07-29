import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { ptyManager } from './pty-manager'
import { findRustPtyBinary } from './rust-pty-host'
import {
 getBackend,
 findBackendBinary,
 shutdownBackend,
 type BackendBridge
} from './backend-bridge'
import { loadAgents, saveAgents, getDefaultAgents } from './agents'
import { probeAgents, resolveAgentCommand, clearResolveCache } from './resolve-command'
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
import { onProjectOpen, onAgentSpawnFast, getRuntimeStatus } from './memory-service'
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
 console.warn(`[backend] ${method} failed, will try TS fallback`, e)
 return null
 }
}

/**
 * Merge sessions from Rust backend + ptyManager.
 * UI spawn prefers truedeck-backend; restore/openProject often use ptyManager - 
 * either side alone is incomplete for persist / on-open dedupe.
 */
async function listLiveSessions(): Promise<SessionInfo[]> {
 const byId = new Map<string, SessionInfo>()
 for (const s of ptyManager.list()) {
 byId.set(s.id, s)
 }
 const viaRust = await rustCall<SessionInfo[]>('sessions.list', {})
 if (Array.isArray(viaRust)) {
 for (const s of viaRust) {
 if (s?.id) byId.set(s.id, s)
 }
 }
 return Array.from(byId.values())
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

 mainWindow = new BrowserWindow({
 width: 1440,
 height: 900,
 minWidth: 960,
 minHeight: 600,
 show: false,
 title: 'TrueDeck',
 backgroundColor: '#0c0c0c',
 // Custom title bar - no native Windows frame
 frame: false,
 titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
 autoHideMenuBar: true,
 icon: iconPath,
 webPreferences: {
 preload: join(__dirname, '../preload/index.js'),
 contextIsolation: true,
 nodeIntegration: false,
 sandbox: false
 }
 })

 mainWindow.on('ready-to-show', () => {
 mainWindow?.show()
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

 // Reliable app shortcuts while xterm/agent TUIs own focus.
 // Always match by input.code (more stable on Windows than input.key).
 // Ctrl+Arrow must preventDefault on *every* keydown including auto-repeat - 
 // otherwise held/fast arrows leak into the agent PTY.
 mainWindow.webContents.on('before-input-event', (event, input) => {
 if (input.type !== 'keyDown') return
 const ctrl = Boolean(input.control || input.meta)
 if (!ctrl) return

 const code = String(input.code || '')
 const keyRaw = String(input.key || '')
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
 const isTab = code === 'Tab' || keyRaw === 'Tab'
 const letter =
 (keyRaw.length === 1 ? keyRaw.toLowerCase() : '') ||
 (code.startsWith('Key') ? code.slice(3).toLowerCase() : '')
 const isAppLetter =
 !input.isAutoRepeat && ['w', 't', 'o', 's', 'n', 'd', 'x'].includes(letter)

 // Font zoom: Ctrl+= / Ctrl++ in, Ctrl+- out, Ctrl+0 reset.
 // Must claim before agent TUIs / Chromium page-zoom swallow the chord.
 // (US keyboards: + is Shift+=; browsers also accept Ctrl+= for zoom-in.)
 const zoomKey =
 code === 'Equal' || code === 'NumpadAdd' || keyRaw === '+' || keyRaw === '='
 ? keyRaw === '+' || input.shift || code === 'NumpadAdd'
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
 const isZoom = Boolean(zoomKey) && !input.alt

 // Pane focus: always hard-hijack Ctrl+Arrow so agent TUIs cannot swallow it.
 // Auto-repeat included. Renderer decides navigation; we only guarantee delivery.
 if (arrow) {
 event.preventDefault()
 const win = mainWindow
 if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
 win.webContents.send('app:shortcut', {
 key: arrow,
 shift: Boolean(input.shift),
 alt: Boolean(input.alt),
 ctrl: true,
 repeat: Boolean(input.isAutoRepeat)
 })
 }
 return
 }

 if (isTab) {
 event.preventDefault()
 mainWindow?.webContents.send('app:shortcut', {
 key: 'Tab',
 shift: Boolean(input.shift),
 alt: Boolean(input.alt),
 ctrl: true,
 repeat: Boolean(input.isAutoRepeat)
 })
 return
 }

 if (isZoom) {
 event.preventDefault()
 mainWindow?.webContents.send('app:shortcut', {
 key: zoomKey,
 shift: Boolean(input.shift),
 alt: Boolean(input.alt),
 ctrl: true,
 repeat: Boolean(input.isAutoRepeat)
 })
 return
 }

 if (!isAppLetter) return
 // Letters: notify renderer; preventDefault for app chords so agents don't eat them
 if (['w', 't', 'o', 's', 'n', 'd', 'x'].includes(letter) && !input.alt) {
 event.preventDefault()
 }
 mainWindow?.webContents.send('app:shortcut', {
 key: letter,
 shift: Boolean(input.shift),
 alt: Boolean(input.alt),
 ctrl: true,
 repeat: Boolean(input.isAutoRepeat)
 })
 })

 // Multi-pane layout lives in the renderer. Async fire-and-forget flush on
 // close often never ran (window destroyed mid-executeJavaScript) → session
 // tabs restored but paneTree collapsed to a single leaf / default ratios.
 // Block close until a sync flush (sendSync from renderer) finishes.
 mainWindow.on('close', (e) => {
 if (layoutFlushDone) return
 if (!mainWindow || mainWindow.isDestroyed()) return
 if (mainWindow.webContents.isDestroyed()) {
 layoutFlushDone = true
 return
 }
 e.preventDefault()
 const win = mainWindow
 void win.webContents
 .executeJavaScript(
 `try{if(typeof window.__truedeckFlushSessions==='function'){window.__truedeckFlushSessions();'ok'}else{'skip'}}catch(err){String(err&&err.message||err)}`,
 true
 )
 .catch(() => 'err')
 .finally(() => {
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

 ptyManager.setWindow(mainWindow)
 rustBackend?.setWindow(mainWindow)

 mainWindow.on('closed', () => {
 try {
 ptyManager.setWindow(null)
 } catch {
 /* ignore */
 }
 try {
 rustBackend?.setWindow(null)
 } catch {
 /* ignore */
 }
 if (mainWindow) mainWindow = null
 })

 if (isDev && process.env['ELECTRON_RENDERER_URL']) {
 mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
 } else {
 mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
 }
}

function registerIpc(): void {
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

 // Custom window chrome (frameless)
 ipcMain.handle('window:minimize', () => {
 mainWindow?.minimize()
 })
 ipcMain.handle('window:maximize', () => {
 if (!mainWindow) return false
 if (mainWindow.isMaximized()) mainWindow.unmaximize()
 else mainWindow.maximize()
 return mainWindow.isMaximized()
 })
 ipcMain.handle('window:close', () => {
 mainWindow?.close()
 })
 ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
 ipcMain.handle('window:setTitle', (_e, title: string) => {
 const t = String(title || 'TrueDeck').slice(0, 200)
 mainWindow?.setTitle(t)
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
 ipcMain.handle('agents:reset', () => {
 const d = getDefaultAgents()
 saveAgents(d)
 return d
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
 const info = await ptyManager.spawnCommand({
 projectRoot: opts.projectRoot,
 label: `install ${agent.name}`,
 command: isWin
 ? `Write-Host "=== Install ${agent.name} CLI ===" -ForegroundColor Cyan; Write-Host ""; Write-Host "Run:" -ForegroundColor Yellow; Write-Host '${install.replace(/'/g, "''")}' -ForegroundColor Green; Write-Host ""; Write-Host "Then restart TrueDeck / re-open agents palette." -ForegroundColor DarkGray; Write-Host ""; Write-Host "Paste & run the command above, or press Up and Enter if you want me to try it now." -ForegroundColor DarkGray; Write-Host ""; $ans = Read-Host "Type y to run install now"; if ($ans -eq 'y') { ${install} } else { Write-Host "Skipped. Copy the command when ready." }`
 : `echo "=== Install ${agent.name} CLI ==="; echo ""; echo "Run:"; echo '${install.replace(/'/g, `'\\''`)}'; echo ""; echo "Then re-open the agent palette in TrueDeck."; echo ""; printf "Type y to run install now: "; read ans; if [ "$ans" = "y" ]; then ${install}; else echo Skipped.; fi`,
 color: agent.color
 })
 return { alreadyInstalled: false, session: info, installCommand: install }
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
 let spawnCommand = resolved.command
 let spawnArgs = [...(resolved.args || [])]
 const { env: memEnv } = onAgentSpawnFast(opts.projectRoot)
 const extraEnv: Record<string, string> = {
 ...memEnv,
 TRUEDECK_PROJECT: opts.projectRoot
 }
 void maybeWrapAgentFrame

 // Prefer Rust backend with absolute (possibly frame-wrapped) command
 const viaRust = await rustCall('sessions.spawn', {
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
 if (viaRust) {
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
 : undefined
 }
 mainWindow?.webContents.send('pty:spawned', withFocus)
 return withFocus
 }
 return ptyManager.spawn({
 projectRoot: opts.projectRoot,
 agent: { ...agent, command: spawnCommand, args: spawnArgs },
 cols: opts.cols,
 rows: opts.rows,
 extraEnv
 })
 }
 )
 ipcMain.handle(
 'sessions:spawnCommand',
 async (
 _e,
 opts: { projectRoot: string; label: string; command: string; color?: string; cols?: number; rows?: number }
 ) => {
 const viaRust = await rustCall('sessions.spawnCommand', opts)
 if (viaRust) {
 mainWindow?.webContents.send('pty:spawned', viaRust)
 return viaRust
 }
 return ptyManager.spawnCommand(opts)
 }
 )
 ipcMain.handle('sessions:list', async () => {
 const viaRust = await rustCall<unknown[]>('sessions.list', {})
 if (viaRust) return viaRust
 return ptyManager.list()
 })
 ipcMain.handle('sessions:backend', async () => {
 if (rustBackend?.isReady) {
 return {
 backend: 'rust' as const,
 rustBinary: findBackendBinary(),
 version: rustBackend.version
 }
 }
 const kind = await ptyManager.ensureBackend()
 return { backend: kind, rustBinary: findRustPtyBinary() || findBackendBinary() }
 })
 /**
 * Route I/O to the backend that actually owns the session.
 * Bug: rust backend ready + session spawned via ptyManager (restore / fallback)
 * used to swallow write/resize → TUI never got input or correct size.
 */
 ipcMain.handle('sessions:write', async (_e, id: string, data: string) => {
 if (ptyManager.has(id)) {
 ptyManager.write(id, data)
 return
 }
 if (rustBackend?.isReady) {
 try {
 await rustBackend.request('sessions.write', { id, data })
 return
 } catch {
 // not a rust session (or died) - try node/rust-pty host
 }
 }
 ptyManager.write(id, data)
 })
 ipcMain.handle(
 'sessions:resize',
 async (_e, id: string, cols: number, rows: number, force?: boolean) => {
 const forceWinch = force === true
 if (ptyManager.has(id)) {
 ptyManager.resize(id, cols, rows, forceWinch)
 return
 }
 if (rustBackend?.isReady) {
 try {
 // Backend always applies; no skip-same-size on the wire
 await rustBackend.request('sessions.resize', { id, cols, rows })
 return
 } catch {
 // fall through
 }
 }
 ptyManager.resize(id, cols, rows, forceWinch)
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
 const live =
 ptyManager.list().find((s) => s.id === sid) ||
 (await listLiveSessions()).find((s) => s.id === sid)
 endRun(sid, -1)
 taskOnSessionExit(sid, -1)
 if (live?.projectRoot) scheduleGraphifySync(live.projectRoot, 'update')
 } catch {
 // ignore
 }
 if (ptyManager.has(sid)) {
 ptyManager.kill(sid)
 return
 }
 if (rustBackend?.isReady) {
 try {
 await rustBackend.request('sessions.kill', { id: sid })
 return
 } catch {
 // fall through
 }
 }
 // Last resort: only this id (ptyManager.kill no-ops if missing)
 ptyManager.kill(sid)
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
 ipcMain.handle('tasks:onSessionExit', (_e, sessionId: string, exitCode?: number) => {
 endRun(sessionId, exitCode)
 const live = ptyManager.list().find((s) => s.id === sessionId)
 const root = live?.projectRoot
 if (root) scheduleGraphifySync(root, 'update')
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
 const sessions = live ?? ptyManager.list()
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
 // Always go through TS path so MAX_SAVED_TABS clamp applies (Rust may lag).
 // Still prefer Rust for actual PTY spawn when available via ptyManager.
 const layout = loadSessionLayout()
 if (!layout.tabs.length) {
 return { layout, sessions: [] as SessionInfo[], restored: 0 }
 }

 console.log(
 `[layout] restore: ${layout.tabs.length} tab(s) (max ${MAX_SAVED_TABS})`
 )

 const agents = loadAgents()
 const sessions: SessionInfo[] = []
 /** Original saved tab index → index in `sessions` (skips failed spawns). */
 const oldToNew = new Map<number, number>()
 const rootsWarmed = new Set<string>()
 // Snapshot once; spawn path below uses ptyManager so new ids appear in `sessions`.
 let backendLive = await listLiveSessions()

 for (let ti = 0; ti < layout.tabs.length; ti++) {
 const tab = layout.tabs[ti]
 if (!tab.projectRoot || !existsSync(tab.projectRoot)) continue
 // Safety: stop if something bypassed the clamp
 if (sessions.length >= MAX_SAVED_TABS) break

 if (!rootsWarmed.has(tab.projectRoot)) {
 try {
 await onProjectOpen(tab.projectRoot)
 } catch {
 // memory is best-effort
 }
 rootsWarmed.add(tab.projectRoot)
 upsertProject(tab.projectRoot)
 }

 try {
 // Prefer already-running PTYs (restore after soft reload / race with openProject).
 // Include Rust-backend sessions so we don't stack duplicates.
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
 if (!sessions.some((s) => s.id === existing.id)) {
 oldToNew.set(ti, sessions.length)
 sessions.push(existing)
 } else {
 oldToNew.set(ti, sessions.findIndex((s) => s.id === existing.id))
 }
 continue
 }
 const info = await ptyManager.spawnCommand({
 projectRoot: tab.projectRoot,
 label: tab.agentName || 'cmd',
 command: tab.commandLine || 'echo restored',
 color: tab.color
 })
 oldToNew.set(ti, sessions.length)
 sessions.push(info)
 continue
 }

 const agent = agents.find((a) => a.id === tab.agentId)
 if (!agent) continue
 // Reuse first matching live agent so we don't stack Shell x N
 const reuseAgent = liveAll.find((s) =>
 isAgentSessionRunning([s], tab.projectRoot, tab.agentId)
 )
 if (reuseAgent) {
 if (!sessions.some((s) => s.id === reuseAgent.id)) {
 oldToNew.set(ti, sessions.length)
 sessions.push(reuseAgent)
 } else {
 oldToNew.set(ti, sessions.findIndex((s) => s.id === reuseAgent.id))
 }
 continue
 }
 const { env } = onAgentSpawnFast(tab.projectRoot)
 const info = await ptyManager.spawn({
 projectRoot: tab.projectRoot,
 agent,
 extraEnv: env
 })
 oldToNew.set(ti, sessions.length)
 sessions.push(info)
 } catch {
 // skip broken tab - indices remapped below so multi-pane survives
 }
 }

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
 })

 ipcMain.handle('sessions:openProject', async (_e, projectId: string) => {
 const project = getProject(projectId) || listProjects().find((p) => p.root === projectId)
 if (!project) throw new Error('Project not found')
 upsertProject(project.root) // touch lastOpened

 // Fully automatic memory: files + MemPalace mine + auto-context
 const mem = await onProjectOpen(project.root)

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
 const info = await ptyManager.spawnCommand({
 projectRoot: project.root,
 label: cmd.label,
 command: cmd.command,
 color: '#3b82f6'
 })
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
 const info = await ptyManager.spawn({
 projectRoot: project.root,
 agent,
 extraEnv: env
 })
 launched.push(info.id)
 liveHere.push(info)
 }
 // sessionIds = newly launched only; reused are already in the UI store
 return { project, sessionIds: launched, reusedSessionIds: reused, memory: mem }
 })

 ipcMain.handle('memory:status', (_e, projectRoot?: string) => getRuntimeStatus(projectRoot))

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
 // Windows taskbar grouping + correct custom icon
 if (process.platform === 'win32') {
 app.setAppUserModelId('dev.truedeck.app')
 }
 mkdirSync(getGlobalDataDir(), { recursive: true })
 ensureGlobalMemory()
 registerIpc()
 // Rust truedeck-backend is the main session engine (always prefer).
 // node-pty / legacy truedeck-pty only if Rust cannot start.
 void (async () => {
 rustBackend = await getBackend()
 if (rustBackend) {
 if (mainWindow) rustBackend.setWindow(mainWindow)
 return
 }
 console.warn(
 '[backend] Rust primary backend unavailable - emergency fallback path'
 )
 const b = await ptyManager.ensureBackend()
 console.warn(
 b === 'rust'
 ? '[pty] fallback engine: rust truedeck-pty (legacy sidecar)'
 : '[pty] fallback engine: node-pty (last resort)'
 )
 })()
 createWindow()

 // Replace leftover docker-run mempalace MCP entries so opening agents
 // does not launch Docker Desktop. Native mempalace-mcp only.
 void (async () => {
 try {
 const r = purgeDockerMemoryMcpOnStartup()
 if (r.serverCount >= 0) {
 console.log('[mcp-hub]', r.message)
 }
 } catch (e) {
 console.warn('[mcp-hub] startup purge failed', e)
 }
 })()

 // Warm enabled memory providers (MemPalace native only - never Docker)
 void ensureEnabledProviders().catch(() => {
 // optional
 })

 // MCP / agents enqueue launch+dispatch here - no Deck Tools UI required
 const stopDeckWorker = startDeckCommandWorker({
 onSession: (session) => {
 // Re-emit after dispatch stamps taskId / focusTitle / status for chrome
 mainWindow?.webContents.send('pty:spawned', session)
 }
 })
 app.on('will-quit', () => {
 try {
 stopDeckWorker()
 } catch {
 /* ignore */
 }
 })

 app.on('activate', () => {
 if (BrowserWindow.getAllWindows().length === 0) createWindow()
 })
})

let shuttingDown = false
function persistAndDisposeSessions(): void {
 if (shuttingDown) return
 shuttingDown = true
 try {
 // Drop renderer refs first so kill/dispose never IPC into a dead window
 try {
 ptyManager.setWindow(null)
 } catch {
 /* ignore */
 }
 const live = ptyManager.list()
 // Renderer owns full paneTree + sessionOrder via sessions:persist.
 // layoutFromLiveSessions reorders tabs by PTY map iteration and desyncs
 // paneTree indices - only fill disk if nothing was ever saved.
 // Never overwrite a non-empty layout with empty live (Rust sessions are
 // not in ptyManager - that used to wipe session-layout.json on quit).
 if (live.length > 0) {
 const prev = loadSessionLayout()
 if (!prev.tabs.length) {
 saveSessionLayout(layoutFromLiveSessions(live, prev))
 }
 // else: leave renderer's last snapshot intact
 }
 } catch {
 // ignore
 }
 try {
 ptyManager.dispose()
 } catch {
 // never surface "Object has been destroyed" as a main-process dialog
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
})
