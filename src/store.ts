import { create } from 'zustand'
import type {
  AgentPreset,
  MemoryNote,
  MemoryScope,
  ProjectConfig,
  SessionInfo
} from '../electron/shared/types'

interface DeckState {
  projects: ProjectConfig[]
  agents: AgentPreset[]
  activeProjectId: string | null
  sessions: SessionInfo[]
  activeSessionId: string | null
  memoryScope: MemoryScope
  notes: MemoryNote[]
  activeNotePath: string | null
  noteDraft: string
  busy: boolean
  status: string

  setStatus: (s: string) => void
  refreshProjects: () => Promise<void>
  refreshAgents: () => Promise<void>
  setActiveProject: (id: string | null) => void
  addSession: (s: SessionInfo) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  markSessionExited: (id: string, exitCode: number) => void
  refreshMemory: () => Promise<void>
  setMemoryScope: (scope: MemoryScope) => void
  setActiveNote: (path: string | null, content?: string) => void
  setNoteDraft: (content: string) => void
}

export const useDeck = create<DeckState>((set, get) => ({
  projects: [],
  agents: [],
  activeProjectId: null,
  sessions: [],
  activeSessionId: null,
  memoryScope: 'repo',
  notes: [],
  activeNotePath: null,
  noteDraft: '',
  busy: false,
  status: 'Ready',

  setStatus: (status) => set({ status }),

  refreshProjects: async () => {
    const projects = await window.truedeck.listProjects()
    set({ projects })
  },

  refreshAgents: async () => {
    const agents = await window.truedeck.listAgents()
    set({ agents })
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  addSession: (s) =>
    set((state) => ({
      sessions: [...state.sessions.filter((x) => x.id !== s.id), s],
      activeSessionId: s.id
    })),

  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id)
      const activeSessionId =
        state.activeSessionId === id ? sessions[sessions.length - 1]?.id || null : state.activeSessionId
      return { sessions, activeSessionId }
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  markSessionExited: (id, exitCode) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status: 'exited' as const, exitCode } : s
      )
    })),

  refreshMemory: async () => {
    const { memoryScope, activeProjectId, projects } = get()
    const project = projects.find((p) => p.id === activeProjectId)
    if (memoryScope === 'repo' && !project) {
      set({ notes: [] })
      return
    }
    const notes = await window.truedeck.listMemory(memoryScope, project?.root)
    set({ notes })
  },

  setMemoryScope: (scope) => set({ memoryScope: scope }),

  setActiveNote: (path, content) =>
    set({
      activeNotePath: path,
      noteDraft: content ?? get().noteDraft
    }),

  setNoteDraft: (content) => set({ noteDraft: content })
}))
