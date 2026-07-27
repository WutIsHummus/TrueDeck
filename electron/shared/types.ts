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

export interface AppSettings {
  injectMemoryOnAgentStart: boolean
  theme: 'dark' | 'light'
  fontSize: number
  layoutMode: LayoutMode
  /** When true, opening a project auto-switches to grid if 2+ panes */
  autoGrid: boolean
}
