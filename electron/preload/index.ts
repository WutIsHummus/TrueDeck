import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentPreset,
  AppSettings,
  MemoryNote,
  MemoryScope,
  ProjectConfig,
  ProjectOnOpenCommand,
  SessionInfo
} from '../shared/types'

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('app:getSettings'),
  setSettings: (s: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('app:setSettings', s),

  listAgents: (): Promise<AgentPreset[]> => ipcRenderer.invoke('agents:list'),
  saveAgents: (agents: AgentPreset[]): Promise<AgentPreset[]> =>
    ipcRenderer.invoke('agents:save', agents),
  resetAgents: (): Promise<AgentPreset[]> => ipcRenderer.invoke('agents:reset'),

  listProjects: (): Promise<ProjectConfig[]> => ipcRenderer.invoke('projects:list'),
  addProject: (): Promise<ProjectConfig | null> => ipcRenderer.invoke('projects:add'),
  openPath: (root: string): Promise<ProjectConfig> => ipcRenderer.invoke('projects:openPath', root),
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
  writeSession: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('sessions:write', id, data),
  resizeSession: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('sessions:resize', id, cols, rows),
  killSession: (id: string): Promise<void> => ipcRenderer.invoke('sessions:kill', id),
  openProject: (
    projectId: string
  ): Promise<{ project: ProjectConfig; sessionIds: string[] }> =>
    ipcRenderer.invoke('sessions:openProject', projectId),

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
  showItem: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),

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
  }
}

contextBridge.exposeInMainWorld('truedeck', api)

export type TrueDeckApi = typeof api
