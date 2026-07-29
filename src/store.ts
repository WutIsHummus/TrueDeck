import { create } from 'zustand'
import type {
 AgentPreset,
 MemoryNote,
 MemoryScope,
 ProjectConfig,
 SessionInfo
} from '../electron/shared/types'
import { sameProjectRoot } from './lib/paths'
import { sanitizeSessionTitle } from './lib/session-label'

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
 /**
 * Register a live session. By default only steals keyboard focus when the
 * session belongs to the active project (or there is no project yet) - 
 * background spawns (MCP launch into another folder) must not jump the UI.
 */
 addSession: (s: SessionInfo, opts?: { focus?: boolean }) => void
 removeSession: (id: string) => void
 setActiveSession: (id: string | null) => void
 markSessionExited: (id: string, exitCode: number) => void
 /** Patch session fields (e.g. OSC terminal title → tab label). */
 patchSession: (id: string, patch: Partial<SessionInfo>) => void
 /** Reorder sessions globally by moving id to before targetId (or end if null). */
 reorderSession: (id: string, beforeId: string | null) => void
 /** Move session to an explicit index within its project group. */
 moveSessionInProject: (id: string, toIndex: number, projectRoot: string) => void
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

 setActiveProject: (id) =>
 set((state) => {
 if (state.activeProjectId === id) return state
 const project = id ? state.projects.find((p) => p.id === id) : null
 // When switching folders, never keep focus on another project's tab - 
 // that made the title bar / persist look like we "jumped" projects.
 let activeSessionId = state.activeSessionId
 if (project) {
 const cur = state.sessions.find((s) => s.id === state.activeSessionId)
 if (!cur || !sameProjectRoot(cur.projectRoot, project.root)) {
 const inProject = state.sessions.filter(
 (s) =>
 s.status === 'running' && sameProjectRoot(s.projectRoot, project.root)
 )
 activeSessionId = inProject[inProject.length - 1]?.id || null
 }
 } else if (id === null) {
 activeSessionId = null
 }
 return { activeProjectId: id, activeSessionId }
 }),

 addSession: (s, opts) =>
 set((state) => {
 const sessions = [...state.sessions.filter((x) => x.id !== s.id), s]
 const force = opts?.focus === true
 const never = opts?.focus === false
 if (never) {
 return { sessions, activeSessionId: state.activeSessionId }
 }
 const activeProj = state.projects.find((p) => p.id === state.activeProjectId)
 const sameProj =
 !activeProj || sameProjectRoot(s.projectRoot, activeProj.root)
 // Default: only steal focus for same-project spawns (or no project yet).
 const shouldFocus = force || sameProj || !state.activeSessionId
 return {
 sessions,
 activeSessionId: shouldFocus ? s.id : state.activeSessionId
 }
 }),

 removeSession: (id) =>
 set((state) => {
 const victim = state.sessions.find((s) => s.id === id)
 const sessions = state.sessions.filter((s) => s.id !== id)
 let activeSessionId = state.activeSessionId
 if (state.activeSessionId === id) {
 // Stay inside the same project when possible - otherwise Ctrl+W spam on
 // an empty SPTS/Rojo project jumps focus to TrueDeck tabs and kills them.
 const sameRoot = victim
 ? sessions.filter((s) => sameProjectRoot(s.projectRoot, victim.projectRoot))
 : []
 activeSessionId = sameRoot[sameRoot.length - 1]?.id || null
 // Do NOT fall back to another project's tabs
 }
 return { sessions, activeSessionId }
 }),

 setActiveSession: (id) => set({ activeSessionId: id }),

 reorderSession: (id, beforeId) =>
 set((state) => {
 const list = [...state.sessions]
 const from = list.findIndex((s) => s.id === id)
 if (from < 0) return state
 const [item] = list.splice(from, 1)
 if (!beforeId) {
 list.push(item)
 } else {
 const to = list.findIndex((s) => s.id === beforeId)
 if (to < 0) list.push(item)
 else list.splice(to, 0, item)
 }
 return { sessions: list }
 }),

 moveSessionInProject: (id, toIndex, projectRoot) =>
 set((state) => {
 const others = state.sessions.filter(
 (s) => !sameProjectRoot(s.projectRoot, projectRoot)
 )
 const group = state.sessions.filter((s) =>
 sameProjectRoot(s.projectRoot, projectRoot)
 )
 const from = group.findIndex((s) => s.id === id)
 if (from < 0) return state
 const [item] = group.splice(from, 1)
 const clamped = Math.max(0, Math.min(toIndex, group.length))
 group.splice(clamped, 0, item)
 // Rebuild: walk original order, replace project block with reordered group once
 const rebuilt: SessionInfo[] = []
 let inserted = false
 for (const s of state.sessions) {
 if (sameProjectRoot(s.projectRoot, projectRoot)) {
 if (!inserted) {
 rebuilt.push(...group)
 inserted = true
 }
 } else {
 rebuilt.push(s)
 }
 }
 if (!inserted) rebuilt.push(...group)
 return { sessions: rebuilt }
 }),

 markSessionExited: (id, exitCode) =>
 set((state) => ({
 sessions: state.sessions.map((s) =>
 s.id === id ? { ...s, status: 'exited' as const, exitCode } : s
 )
 })),

 patchSession: (id, patch) =>
 set((state) => {
 const next = { ...patch }
 // Never store secret-looking OSC / prompt text as the tab or window title
 if (typeof next.title === 'string') {
 const safe = sanitizeSessionTitle(next.title)
 if (!safe) delete next.title
 else next.title = safe
 }
 if (typeof next.focusTitle === 'string') {
 const safe = sanitizeSessionTitle(next.focusTitle)
 if (!safe) delete next.focusTitle
 else next.focusTitle = safe
 }
 if (Object.keys(next).length === 0) return state
 return {
 sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...next } : s))
 }
 }),

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
