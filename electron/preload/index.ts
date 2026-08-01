import { contextBridge, ipcRenderer } from 'electron'
import type {
 AgentMemoryInjectResult,
 AgentPreset,
 AgentProbe,
 AppSettings,
 MemoryNote,
 MemoryProviderConfig,
 MemoryProviderStatus,
 MemoryScope,
 MemorySpaceInfo,
 ProjectConfig,
 ProjectOnOpenCommand,
 SessionInfo,
 SessionLayout
} from '../shared/types'

/** Detached pane boot identity (argv is more reliable than file:// query). */
function parseDetachedBoot(): { detached: boolean; sessionId: string | null } {
 try {
  const arg = process.argv.find((a) => a.startsWith('--td-detached='))
  if (arg) {
   const sessionId = arg.slice('--td-detached='.length).trim()
   if (sessionId) return { detached: true, sessionId }
  }
 } catch {
  /* ignore */
 }
 try {
  const q = new URLSearchParams(
   typeof location !== 'undefined' ? location.search : ''
  )
  const session = (q.get('session') || '').trim()
  if (q.get('detached') === '1' && session) {
   return { detached: true, sessionId: session }
  }
 } catch {
  /* ignore */
 }
 return { detached: false, sessionId: null }
}

const detachedBoot = parseDetachedBoot()

const api = {
 /** Pop-out window boot: which session this renderer owns (if any). */
 getDetachedBoot: (): { detached: boolean; sessionId: string | null } => detachedBoot,
 getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('app:getSettings'),
 setSettings: (s: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('app:setSettings', s),
 firstRun: (
 force?: boolean
 ): Promise<{ seeded: ProjectConfig[]; firstRun: boolean }> =>
 ipcRenderer.invoke('app:firstRun', force),
 version: (): Promise<string> => ipcRenderer.invoke('app:version'),
 checkUpdates: (
 force?: boolean
 ): Promise<{
 currentVersion: string
 latestVersion: string | null
 updateAvailable: boolean
 releaseUrl: string | null
 downloadUrl: string | null
 releaseName: string | null
 publishedAt: string | null
 checkedAt: number
 error?: string
 }> => ipcRenderer.invoke('app:checkUpdates', force),
 getOnboarding: (): Promise<{ completed: boolean; skipped?: boolean }> =>
 ipcRenderer.invoke('app:onboarding'),
 completeOnboarding: (skipped?: boolean): Promise<{ completed: boolean }> =>
 ipcRenderer.invoke('app:completeOnboarding', skipped),
 resetOnboarding: (): Promise<{ completed: boolean }> =>
 ipcRenderer.invoke('app:resetOnboarding'),

 windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
 windowMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:maximize'),
 windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
 windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
 /** OS / taskbar title (also updates frameless window title metadata). */
 setWindowTitle: (title: string): Promise<string> =>
 ipcRenderer.invoke('window:setTitle', title),
 /** Pop a session into its own window (drag out / Ctrl+N). */
 openDetachedPane: (opts: {
 sessionId: string
 title?: string
 x?: number
 y?: number
 }): Promise<{ ok: boolean; sessionId: string }> =>
 ipcRenderer.invoke('window:openDetached', opts),
 getWindowMode: (): Promise<{ detached: boolean; sessionId: string | null }> =>
 ipcRenderer.invoke('window:getMode'),
 listDetachedSessions: (): Promise<string[]> => ipcRenderer.invoke('window:listDetached'),
 onDetachedClosed: (cb: (info: { sessionId: string }) => void): (() => void) => {
 const listener = (
 _: Electron.IpcRendererEvent,
 info: { sessionId: string }
 ): void => cb(info)
 ipcRenderer.on('detached:closed', listener)
 return () => ipcRenderer.removeListener('detached:closed', listener)
 },
 /** Main → detached window: session id after load (fallback if argv/query missed). */
 onDetachedBoot: (cb: (info: { sessionId: string }) => void): (() => void) => {
 const listener = (
 _: Electron.IpcRendererEvent,
 info: { sessionId: string }
 ): void => cb(info)
 ipcRenderer.on('detached:boot', listener)
 return () => ipcRenderer.removeListener('detached:boot', listener)
 },
 onWindowMaximized: (cb: (maximized: boolean) => void): (() => void) => {
 const listener = (_: Electron.IpcRendererEvent, maximized: boolean): void => cb(maximized)
 ipcRenderer.on('window:maximized', listener)
 return () => ipcRenderer.removeListener('window:maximized', listener)
 },

 listAgents: (): Promise<AgentPreset[]> => ipcRenderer.invoke('agents:list'),
 probeAgents: (): Promise<AgentProbe[]> => ipcRenderer.invoke('agents:probe'),
 installAgentHelp: (opts: {
 projectRoot: string
 agentId: string
 }): Promise<{
 alreadyInstalled: boolean
 path?: string
 session?: SessionInfo
 installCommand?: string
 }> => ipcRenderer.invoke('agents:installHelp', opts),
 saveAgents: (agents: AgentPreset[]): Promise<AgentPreset[]> =>
 ipcRenderer.invoke('agents:save', agents),
 addCustomAgent: (opts: {
 name: string
 command: string
 args?: string[]
 color?: string
 installCommand?: string
 description?: string
 }): Promise<{ agents: AgentPreset[]; preset: AgentPreset }> =>
 ipcRenderer.invoke('agents:addCustom', opts),
 removeCustomAgent: (agentId: string): Promise<AgentPreset[]> =>
 ipcRenderer.invoke('agents:removeCustom', agentId),
 resetAgents: (): Promise<AgentPreset[]> => ipcRenderer.invoke('agents:reset'),

 listProjects: (): Promise<ProjectConfig[]> => ipcRenderer.invoke('projects:list'),
 addProject: (): Promise<ProjectConfig | null> => ipcRenderer.invoke('projects:add'),
 openPath: (root: string): Promise<ProjectConfig> => ipcRenderer.invoke('projects:openPath', root),
 /** Clone git URL (or open existing path) → project. */
 cloneRepo: (opts: {
 url: string
 parentDir?: string
 folderName?: string
 }): Promise<{ project: ProjectConfig; path: string; cloned: boolean }> =>
 ipcRenderer.invoke('projects:clone', opts),
 /** Import all git repos under a chosen parent folder. */
 importRepos: (): Promise<{
 imported: ProjectConfig[]
 skipped: string[]
 parent: string | null
 }> => ipcRenderer.invoke('projects:importRepos'),
 defaultCloneParent: (): Promise<string> => ipcRenderer.invoke('projects:defaultCloneParent'),
 pickCloneParent: (): Promise<string | null> => ipcRenderer.invoke('projects:pickCloneParent'),
 removeProject: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:remove', id),
 setOnOpen: (id: string, commands: ProjectOnOpenCommand[]): Promise<ProjectConfig | undefined> =>
 ipcRenderer.invoke('projects:setOnOpen', id, commands),
 updateProject: (
 id: string,
 patch: Partial<{
 name: string
 onOpenCommands: ProjectOnOpenCommand[]
 defaultAgents: string[]
 color: string
 }>
 ): Promise<ProjectConfig | undefined> => ipcRenderer.invoke('projects:update', id, patch),
 getProject: (id: string): Promise<ProjectConfig | undefined> =>
 ipcRenderer.invoke('projects:get', id),
 getProjectFocus: (
 projectRoot: string
 ): Promise<{ title: string; idea: string } | null> =>
 ipcRenderer.invoke('projects:getFocus', projectRoot),

 spawnSession: (opts: {
 projectRoot: string
 agentId: string
 cols?: number
 rows?: number
 }): Promise<SessionInfo> => ipcRenderer.invoke('sessions:spawn', opts),
 spawnCommand: (opts: {
 projectRoot: string
 label: string
 command: string
 color?: string
 }): Promise<SessionInfo> => ipcRenderer.invoke('sessions:spawnCommand', opts),
 listSessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke('sessions:list'),
 ptyBackend: (): Promise<{
 backend: 'node' | 'rust' | 'none'
 rustBinary: string | null
 version?: string | null
 }> => ipcRenderer.invoke('sessions:backend'),
 writeSession: (id: string, data: string): Promise<void> =>
 ipcRenderer.invoke('sessions:write', id, data),
 /** OS clipboard (for terminal copy/paste; more reliable than navigator.clipboard). */
 readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
 writeClipboard: (text: string): Promise<boolean> =>
 ipcRenderer.invoke('clipboard:writeText', text),
 /** Readable project files (plans, markdown, source) in a document tab. */
 readProjectFile: (
 filePath: string
 ): Promise<{ path: string; content: string; mtimeMs: number }> =>
 ipcRenderer.invoke('files:readText', filePath),
 writeProjectFile: (
 filePath: string,
 content: string
 ): Promise<{ path: string; mtimeMs: number }> =>
 ipcRenderer.invoke('files:writeText', filePath, content),
 pathExists: (filePath: string): Promise<boolean> =>
 ipcRenderer.invoke('files:pathExists', filePath),
 listProjectDir: (
 dirPath: string
 ): Promise<
 Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>
 > => ipcRenderer.invoke('files:listDir', dirPath),
 pickProjectFile: (opts?: {
 projectRoot?: string
 title?: string
 }): Promise<string | null> => ipcRenderer.invoke('files:pickOpen', opts),
 resizeSession: (id: string, cols: number, rows: number, force?: boolean): Promise<void> =>
 ipcRenderer.invoke('sessions:resize', id, cols, rows, force),
 killSession: (id: string): Promise<void> => ipcRenderer.invoke('sessions:kill', id),
 getSessionLayout: (): Promise<SessionLayout> => ipcRenderer.invoke('sessions:getLayout'),
 saveSessionLayout: (layout: SessionLayout): Promise<SessionLayout> =>
 ipcRenderer.invoke('sessions:saveLayout', layout),
 persistSessions: (snapshot: {
 activeProjectRoot: string | null
 activeSessionId: string | null
 splitSessionId: string | null
 splitRatio?: number
 sessionOrder?: string[]
 /** Aligned with sessionOrder - preferred tab metadata for disk. */
 tabs?: SessionLayout['tabs']
 paneTree?: SessionLayout['paneTree']
 focusedGroupTabIndex?: number | null
 }): Promise<SessionLayout> => ipcRenderer.invoke('sessions:persist', snapshot),
 /**
 * Blocking flush for quit / reload. Prefer this on pagehide so multi-pane
 * layout lands on disk before the process exits.
 */
 persistSessionsSync: (snapshot: {
 activeProjectRoot: string | null
 activeSessionId: string | null
 splitSessionId: string | null
 splitRatio?: number
 sessionOrder?: string[]
 tabs?: SessionLayout['tabs']
 paneTree?: SessionLayout['paneTree']
 focusedGroupTabIndex?: number | null
 }): SessionLayout | { error: string } =>
 ipcRenderer.sendSync('sessions:persist-sync', snapshot) as SessionLayout | { error: string },
 restoreSessions: (): Promise<{
 layout: SessionLayout
 sessions: SessionInfo[]
 restored: number
 }> => ipcRenderer.invoke('sessions:restore'),
 openProject: (
 projectId: string
 ): Promise<{
 project: ProjectConfig
 /** Newly spawned on-open / default-agent tabs */
 sessionIds: string[]
 /** Already-running tabs that matched on-open (not re-spawned) */
 reusedSessionIds?: string[]
 memory?: { ok: boolean; label: string; detail: string }
 }> => ipcRenderer.invoke('sessions:openProject', projectId),

 memoryStatus: (
 projectRoot?: string
 ): Promise<{ ok: boolean; label: string; detail: string }> =>
 ipcRenderer.invoke('memory:status', projectRoot),
 projectSetupStatus: (
 projectRoot: string,
 openAgentIds?: string[]
 ): Promise<import('../shared/types').ProjectSetupStatus> =>
 ipcRenderer.invoke('project:setupStatus', projectRoot, openAgentIds || []),
 setupProject: (opts: {
 projectRoot: string
 openAgentIds?: string[]
 }): Promise<import('../shared/types').ProjectSetupResult> =>
 ipcRenderer.invoke('project:setup', opts),

 graphifyStatus: (projectRoot?: string): Promise<import('../shared/types').GraphifyStatus> =>
 ipcRenderer.invoke('graphify:status', projectRoot),
 graphifySync: (
 projectRoot: string,
 mode?: 'full' | 'update'
 ): Promise<import('../shared/types').GraphifyStatus> =>
 ipcRenderer.invoke('graphify:sync', projectRoot, mode),

 listRoles: (): Promise<import('../shared/types').AgentRole[]> =>
 ipcRenderer.invoke('roles:list'),
 saveRoles: (
 roles: import('../shared/types').AgentRole[]
 ): Promise<import('../shared/types').AgentRole[]> => ipcRenderer.invoke('roles:save', roles),
 getRole: (id: string): Promise<import('../shared/types').AgentRole | null> =>
 ipcRenderer.invoke('roles:get', id),

 listPipelines: (): Promise<import('../shared/types').Pipeline[]> =>
 ipcRenderer.invoke('pipelines:list'),
 listPipelineRuns: (
 projectRoot?: string
 ): Promise<import('../shared/types').PipelineRun[]> =>
 ipcRenderer.invoke('pipelines:runs', projectRoot),
 getPipelineRun: (
 id: string
 ): Promise<import('../shared/types').PipelineRun | null> =>
 ipcRenderer.invoke('pipelines:getRun', id),
 startPipeline: (opts: {
 pipelineId: string
 projectRoot: string
 title: string
 body?: string
 }): Promise<import('../shared/types').PipelineRun> =>
 ipcRenderer.invoke('pipelines:start', opts),
 cancelPipeline: (id: string): Promise<import('../shared/types').PipelineRun | null> =>
 ipcRenderer.invoke('pipelines:cancel', id),
 pausePipeline: (id: string): Promise<import('../shared/types').PipelineRun | null> =>
 ipcRenderer.invoke('pipelines:pause', id),
 resumePipeline: (id: string): Promise<import('../shared/types').PipelineRun | null> =>
 ipcRenderer.invoke('pipelines:resume', id),

 listLayouts: (): Promise<import('../shared/types').NamedLayout[]> =>
 ipcRenderer.invoke('layouts:list'),
 getLayout: (id: string): Promise<import('../shared/types').NamedLayout | null> =>
 ipcRenderer.invoke('layouts:get', id),
 layoutPreset: (
 preset: string
 ): Promise<{ tree: import('../shared/types').SavedPaneNode; tabs: number }> =>
 ipcRenderer.invoke('layouts:preset', preset),
 saveLayout: (input: {
 name: string
 paneTree: import('../shared/types').SessionLayout['paneTree']
 fillAgentIds?: string[]
 }): Promise<import('../shared/types').NamedLayout> =>
 ipcRenderer.invoke('layouts:save', input),
 deleteLayout: (id: string): Promise<boolean> => ipcRenderer.invoke('layouts:delete', id),

 gitReview: (projectRoot: string): Promise<import('../shared/types').GitReviewSnapshot> =>
 ipcRenderer.invoke('review:git', projectRoot),
 listMemorySpaces: (): Promise<MemorySpaceInfo[]> => ipcRenderer.invoke('memory:listSpaces'),
 pickMemorySpace: (): Promise<string | null> => ipcRenderer.invoke('memory:pickSpace'),
 getPalacePath: (): Promise<string> => ipcRenderer.invoke('memory:getPalacePath'),
 setPalacePath: (palacePath: string): Promise<AppSettings> =>
 ipcRenderer.invoke('memory:setPalacePath', palacePath),
 injectMemoryForAgent: (opts: {
 agentId?: string
 agentIds?: string[]
 projectRoot?: string
 palacePath?: string
 /** Sync every CLI in settings.syncedAgentIds (default all known agents) */
 allSynced?: boolean
 }): Promise<AgentMemoryInjectResult> => ipcRenderer.invoke('memory:injectForAgent', opts),

 listMemory: (scope: MemoryScope, projectRoot?: string): Promise<MemoryNote[]> =>
 ipcRenderer.invoke('memory:list', scope, projectRoot),
 readMemory: (filePath: string): Promise<string> => ipcRenderer.invoke('memory:read', filePath),
 writeMemory: (opts: {
 scope: MemoryScope
 projectRoot?: string
 relativePath: string
 content: string
 }): Promise<MemoryNote> => ipcRenderer.invoke('memory:write', opts),
 deleteMemory: (filePath: string): Promise<boolean> =>
 ipcRenderer.invoke('memory:delete', filePath),
 memoryBootstrap: (projectRoot?: string): Promise<string> =>
 ipcRenderer.invoke('memory:bootstrap', projectRoot),
 ensureMemory: (
 projectRoot?: string
 ): Promise<{ global: string; repo?: string }> =>
 ipcRenderer.invoke('memory:ensure', projectRoot),

 openPathInOs: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
 openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
 showItem: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),

 mempalaceStatus: (): Promise<{
 installed: boolean
 cliPath: string | null
 mcpPath: string | null
 palacePath: string
 ready: boolean
 mode: 'native' | 'docker' | 'missing'
 message: string
 version?: string
 }> => ipcRenderer.invoke('mempalace:status'),
 mempalaceEnsure: (opts?: {
 projectRoot?: string
 wing?: string
 }): Promise<{
 installed: boolean
 ready: boolean
 mode: string
 message: string
 palacePath: string
 }> => ipcRenderer.invoke('mempalace:ensure', opts),

 listMemoryProviders: (): Promise<MemoryProviderConfig[]> =>
 ipcRenderer.invoke('memoryProviders:list'),
 memoryProviderStatus: (): Promise<MemoryProviderStatus[]> =>
 ipcRenderer.invoke('memoryProviders:status'),
 saveMemoryProviders: (providers: MemoryProviderConfig[]): Promise<MemoryProviderConfig[]> =>
 ipcRenderer.invoke('memoryProviders:save', providers),
 setMemoryProviderEnabled: (id: string, enabled: boolean): Promise<MemoryProviderConfig[]> =>
 ipcRenderer.invoke('memoryProviders:setEnabled', id, enabled),
 upsertMemoryProvider: (provider: MemoryProviderConfig): Promise<MemoryProviderConfig[]> =>
 ipcRenderer.invoke('memoryProviders:upsert', provider),
 removeMemoryProvider: (id: string): Promise<MemoryProviderConfig[]> =>
 ipcRenderer.invoke('memoryProviders:remove', id),
 addCustomMemoryMcp: (opts: {
 name: string
 command: string
 args?: string[]
 env?: Record<string, string>
 }): Promise<MemoryProviderConfig[]> => ipcRenderer.invoke('memoryProviders:addCustom', opts),
 ensureMemoryProviders: (projectRoot?: string): Promise<MemoryProviderStatus[]> =>
 ipcRenderer.invoke('memoryProviders:ensure', projectRoot),
 exportMemoryMcpSnippet: (): Promise<{ cursor: string; grokToml: string }> =>
 ipcRenderer.invoke('memoryProviders:exportSnippet'),

 /** Unified MCP hub - one set of servers for all agent clients */
 listMcpServers: (): Promise<
 Array<{
 id: string
 name: string
 enabled: boolean
 source: 'user' | 'memory' | 'builtin'
 command: string
 args: string[]
 env?: Record<string, string>
 description?: string
 }>
 > => ipcRenderer.invoke('mcp:list'),
 upsertMcpServer: (entry: {
 id?: string
 name: string
 command: string
 args?: string[]
 env?: Record<string, string>
 enabled?: boolean
 description?: string
 }): Promise<
 Array<{
 id: string
 name: string
 enabled: boolean
 source: 'user' | 'memory' | 'builtin'
 command: string
 args: string[]
 }>
 > => ipcRenderer.invoke('mcp:upsert', entry),
 removeMcpServer: (id: string): Promise<unknown> => ipcRenderer.invoke('mcp:remove', id),
 setMcpServerEnabled: (id: string, enabled: boolean): Promise<unknown> =>
 ipcRenderer.invoke('mcp:setEnabled', id, enabled),
 injectMcpAllClients: (
 projectRoot?: string
 ): Promise<{
 ok: boolean
 serverCount: number
 filesWritten: string[]
 message: string
 }> => ipcRenderer.invoke('mcp:injectAll', projectRoot),
 exportUnifiedMcp: (): Promise<{
 cursor: string
 claude: string
 grokToml: string
 serverCount: number
 }> => ipcRenderer.invoke('mcp:export'),

 // ── Tasks (BridgeBoard) ──
 listTasks: (projectRoot?: string): Promise<
 Array<{
 id: string
 projectRoot: string
 title: string
 body: string
 status: string
 assigneeAgentId?: string
 sessionId?: string
 runIds: string[]
 createdAt: number
 updatedAt: number
 }>
 > => ipcRenderer.invoke('tasks:list', projectRoot),
 createTask: (input: {
 projectRoot: string
 title: string
 body?: string
 status?: string
 assigneeAgentId?: string
 roleId?: string
 isolate?: boolean
 }): Promise<unknown> => ipcRenderer.invoke('tasks:create', input),
 updateTask: (
 id: string,
 patch: Partial<{
 title: string
 body: string
 status: string
 assigneeAgentId: string
 roleId: string
 }>
 ): Promise<unknown> => ipcRenderer.invoke('tasks:update', id, patch),
 deleteTask: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:delete', id),
 dispatchTask: (
 taskId: string,
 agentId?: string
 ): Promise<{ task: unknown; session: unknown; runId: string; taskFile: string }> =>
 ipcRenderer.invoke('tasks:dispatch', taskId, agentId),
 listRuns: (opts?: {
 projectRoot?: string
 taskId?: string
 limit?: number
 }): Promise<unknown[]> => ipcRenderer.invoke('runs:list', opts),
 taskSessionExit: (sessionId: string, exitCode?: number): Promise<unknown> =>
 ipcRenderer.invoke('tasks:onSessionExit', sessionId, exitCode),
 /** Git branch for chrome (best-effort). */
 getGitBranch: (projectRoot: string): Promise<string | null> =>
 ipcRenderer.invoke('git:branch', projectRoot),

 onPtyData: (cb: (payload: { id: string; data: string }) => void): (() => void) => {
 const listener = (_: Electron.IpcRendererEvent, payload: { id: string; data: string }): void =>
 cb(payload)
 ipcRenderer.on('pty:data', listener)
 return () => ipcRenderer.removeListener('pty:data', listener)
 },
 onPtyExit: (cb: (payload: { id: string; exitCode: number }) => void): (() => void) => {
 const listener = (
 _: Electron.IpcRendererEvent,
 payload: { id: string; exitCode: number }
 ): void => cb(payload)
 ipcRenderer.on('pty:exit', listener)
 return () => ipcRenderer.removeListener('pty:exit', listener)
 },
 onPtySpawned: (cb: (info: SessionInfo) => void): (() => void) => {
 const listener = (_: Electron.IpcRendererEvent, info: SessionInfo): void => cb(info)
 ipcRenderer.on('pty:spawned', listener)
 return () => ipcRenderer.removeListener('pty:spawned', listener)
 },
 /** Main-process shortcuts (before-input-event) - reliable under agent TUIs. */
 onLayoutRehydrate: (
    cb: (payload: {
      sessionIds: string[]
      paneTree: import('../shared/types').SessionLayout['paneTree']
      focusedGroupTabIndex?: number | null
      activeProjectRoot?: string | null
    }) => void
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: {
        sessionIds: string[]
        paneTree: import('../shared/types').SessionLayout['paneTree']
        focusedGroupTabIndex?: number | null
        activeProjectRoot?: string | null
      }
    ): void => {
      cb(payload)
    }
    ipcRenderer.on('layout:rehydrate', listener)
    return () => {
      ipcRenderer.removeListener('layout:rehydrate', listener)
    }
  },
  onAppShortcut: (
 cb: (payload: {
 key: string
 shift: boolean
 alt: boolean
 ctrl: boolean
 repeat?: boolean
 }) => void
 ): (() => void) => {
 const listener = (
 _: Electron.IpcRendererEvent,
 payload: {
 key: string
 shift: boolean
 alt: boolean
 ctrl: boolean
 repeat?: boolean
 }
 ): void => cb(payload)
 ipcRenderer.on('app:shortcut', listener)
 return () => ipcRenderer.removeListener('app:shortcut', listener)
 }
}

contextBridge.exposeInMainWorld('truedeck', api)

export type TrueDeckApi = typeof api
