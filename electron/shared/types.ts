export type MemoryScope = 'global' | 'repo'

export interface AgentPreset {
  id: string
  name: string
  command: string
  args: string[]
  color: string
  icon: string
  description?: string
}

export interface ProjectOnOpenCommand {
  id: string
  label: string
  command: string
  enabled: boolean
}

export interface ProjectConfig {
  id: string
  name: string
  root: string
  lastOpened?: number
  onOpenCommands: ProjectOnOpenCommand[]
  defaultAgents: string[]
  color?: string
}

export type SessionStatus = 'running' | 'exited'

export interface SessionInfo {
  id: string
  agentId: string
  agentName: string
  color: string
  projectRoot: string
  status: SessionStatus
  createdAt: number
  title: string
  exitCode?: number
}

export interface MemoryNote {
  id: string
  path: string
  relativePath: string
  title: string
  content: string
  mtime: number
  scope?: MemoryScope
}

export type LayoutMode = 'tabs' | 'grid'

/** Built-in or user-added memory backends (MemPalace, OpenMemory, custom MCP, files). */
export type MemoryProviderKind =
  | 'truememory'
  | 'mempalace'
  | 'openmemory'
  | 'custom-mcp'

export interface MemoryProviderConfig {
  id: string
  kind: MemoryProviderKind
  name: string
  /** User can turn backends on/off without uninstalling */
  enabled: boolean
  description?: string
  /** stdio MCP command (not used for pure file TrueMemory) */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Optional palace / data path */
  dataPath?: string
  /** Prefer native over docker for kinds that support both */
  preferNative?: boolean
  /** Never use Docker even if present */
  noDocker?: boolean
}

export interface MemoryProviderStatus {
  id: string
  kind: MemoryProviderKind
  name: string
  enabled: boolean
  ready: boolean
  mode: 'files' | 'native' | 'mcp' | 'docker' | 'missing' | 'disabled'
  message: string
  version?: string
  mcp?: {
    command: string
    args: string[]
  }
}

export interface AppSettings {
  injectMemoryOnAgentStart: boolean
  theme: 'dark' | 'light'
  fontSize: number
  layoutMode: LayoutMode
  /** When true, opening a project auto-switches to grid if 2+ panes */
  autoGrid: boolean
  /** Show Grok/Codex/Cursor/Claude chips in the title bar */
  showQuickAgents: boolean
  /** Restore last project on launch */
  reopenLastProject: boolean
  /**
   * Memory backends. TrueMemory (files) is always present.
   * MemPalace defaults to native (no Docker).
   * Add OpenMemory / custom MCP from the UI.
   */
  memoryProviders: MemoryProviderConfig[]
}
