import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { ptyManager } from './pty-manager'
import { loadAgents, saveAgents, getDefaultAgents } from './agents'
import {
  listProjects,
  upsertProject,
  removeProject,
  getProject,
  setOnOpenCommands,
  suggestOnOpenCommands
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
import { onProjectOpen, onAgentSpawn, getRuntimeStatus } from './memory-service'
import { checkForUpdates } from './update-check'
import type {
  AgentPreset,
  AppSettings,
  MemoryProviderConfig,
  MemoryScope,
  ProjectOnOpenCommand
} from '../shared/types'

const isDev = !app.isPackaged

function loadSettings(): AppSettings {
  try {
    if (existsSync(getSettingsPath())) {
      return { ...defaultSettings(), ...JSON.parse(readFileSync(getSettingsPath(), 'utf8')) }
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
    showQuickAgents: true,
    reopenLastProject: true,
    memoryProviders: defaultMemoryProviders()
  }
}

function saveSettings(s: AppSettings): void {
  mkdirSync(getGlobalDataDir(), { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.svg')
    : join(app.getAppPath(), 'resources', 'icon.svg')

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'TrueDeck',
    backgroundColor: '#0c0c0c',
    autoHideMenuBar: true,
    icon: existsSync(iconPath) ? iconPath : undefined,
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  ptyManager.setWindow(mainWindow)

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('app:getSettings', () => loadSettings())
  ipcMain.handle('app:setSettings', (_e, s: AppSettings) => {
    saveSettings({ ...defaultSettings(), ...s })
    return loadSettings()
  })
  ipcMain.handle('app:firstRun', (_e, force?: boolean) => runFirstRunSeed(Boolean(force)))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:checkUpdates', (_e, force?: boolean) => checkForUpdates(Boolean(force)))

  // MemPalace (native, no Docker) — kept for backward-compatible UI hooks
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
  ipcMain.handle('memoryProviders:mcpMap', () => buildMcpServerMap())
  ipcMain.handle('memoryProviders:exportSnippet', () => {
    const map = buildMcpServerMap()
    return {
      cursor: JSON.stringify({ mcpServers: map }, null, 2),
      grokToml: Object.entries(map)
        .map(([id, cfg]) => {
          const args = (cfg.args || []).map((a) => `"${a.replace(/\\/g, '\\\\')}"`).join(', ')
          const cmd = cfg.command.replace(/\\/g, '\\\\')
          return `[mcp_servers.${id}]\ncommand = "${cmd}"\nargs = [${args}]\nenabled = true\nstartup_timeout_sec = 60`
        })
        .join('\n\n')
    }
  })

  ipcMain.handle('agents:list', () => loadAgents())
  ipcMain.handle('agents:save', (_e, agents: AgentPreset[]) => {
    saveAgents(agents)
    return agents
  })
  ipcMain.handle('agents:reset', () => {
    const d = getDefaultAgents()
    saveAgents(d)
    return d
  })

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

  ipcMain.handle(
    'sessions:spawn',
    async (_e, opts: { projectRoot: string; agentId: string; cols?: number; rows?: number }) => {
      const agents = loadAgents()
      const agent = agents.find((a) => a.id === opts.agentId)
      if (!agent) throw new Error(`Unknown agent: ${opts.agentId}`)
      // Memory abstracted: refresh auto-context + env before spawn
      const { env } = await onAgentSpawn(opts.projectRoot)
      return ptyManager.spawn({
        projectRoot: opts.projectRoot,
        agent,
        cols: opts.cols,
        rows: opts.rows,
        extraEnv: env
      })
    }
  )
  ipcMain.handle(
    'sessions:spawnCommand',
    (
      _e,
      opts: { projectRoot: string; label: string; command: string; color?: string; cols?: number; rows?: number }
    ) => ptyManager.spawnCommand(opts)
  )
  ipcMain.handle('sessions:list', () => ptyManager.list())
  ipcMain.handle('sessions:write', (_e, id: string, data: string) => {
    ptyManager.write(id, data)
  })
  ipcMain.handle('sessions:resize', (_e, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows)
  })
  ipcMain.handle('sessions:kill', (_e, id: string) => {
    ptyManager.kill(id)
  })
  ipcMain.handle('sessions:openProject', async (_e, projectId: string) => {
    const project = getProject(projectId) || listProjects().find((p) => p.root === projectId)
    if (!project) throw new Error('Project not found')
    upsertProject(project.root) // touch lastOpened

    // Fully automatic memory: files + MemPalace mine + auto-context
    const mem = await onProjectOpen(project.root)

    const launched: string[] = []
    for (const cmd of project.onOpenCommands || []) {
      if (!cmd.enabled) continue
      const info = ptyManager.spawnCommand({
        projectRoot: project.root,
        label: cmd.label,
        command: cmd.command,
        color: '#3b82f6'
      })
      launched.push(info.id)
    }
    const agents = loadAgents()
    const { env } = await onAgentSpawn(project.root)
    for (const agentId of project.defaultAgents || []) {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) continue
      const info = ptyManager.spawn({
        projectRoot: project.root,
        agent,
        extraEnv: env
      })
      launched.push(info.id)
    }
    return { project, sessionIds: launched, memory: mem }
  })

  ipcMain.handle('memory:status', (_e, projectRoot?: string) => getRuntimeStatus(projectRoot))

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
  mkdirSync(getGlobalDataDir(), { recursive: true })
  ensureGlobalMemory()
  registerIpc()
  createWindow()

  // Warm enabled memory providers (MemPalace native only — never Docker)
  void ensureEnabledProviders().catch(() => {
    // optional
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ptyManager.dispose()
})
