import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDeck } from './store'
import { OnOpenModal } from './components/OnOpenModal'
import { SettingsMenu } from './components/SettingsMenu'
import { Onboarding } from './components/Onboarding'
import { WindowControls } from './components/WindowControls'
import { ProjectMenu } from './components/ProjectMenu'
import { CloneRepoInput } from './components/CloneRepoInput'
import { PaneWorkspace } from './components/PaneWorkspace'
import { LoadingCard } from './components/LoadingCard'
import { getDraggingTabId, setDraggingTabId } from './lib/tab-drag'
import {
 activeSessionOf,
 closeGroup,
 countLeaves,
 createLayout,
 cycleTabsInFocusedGroup,
 edgeFromPoint,
 findGroup,
 focusSession as layoutFocusSession,
 groupIdFromPoint,
 isOverGroupTabBar,
 listGroups,
 mergeAllGroups,
 stepPaneFocus,
 placeSession,
 MAX_PANES,
 PANE_WARN_THRESHOLD,
 removeSessionFromLayout,
 reorderInGroup,
 setPrimaryRatio,
 setSplitRatio,
 syncSessions,
 normalizeLayout,
 serializePaneTree,
 deserializePaneTree,
 filterLayoutToSessionIds,
 allSessionIds,
 type DropEdge,
 type DropTarget,
 type NavDir,
 type PaneLayout
} from './lib/pane-layout'
import type { AgentPreset, AgentProbe, AppSettings, ProjectConfig } from '../electron/shared/types'
import appIconUrl from '../resources/icons/icon-32.png'
import { sessionTabLabel } from './lib/session-label'
import { sameProjectRoot } from './lib/paths'
import { AgentIcon } from './components/AgentIcon'

/**
 * Studio layout - between Codex TUI and raw CLI.
 * Memory is fully automatic (no user management UI).
 */
export default function App(): JSX.Element {
 const {
 projects,
 agents,
 activeProjectId,
 sessions,
 activeSessionId,
 status,
 refreshProjects,
 refreshAgents,
 setActiveProject,
 addSession,
 removeSession,
 setActiveSession,
 markSessionExited,
 moveSessionInProject,
 setStatus
 } = useDeck()

 const [paletteOpen, setPaletteOpen] = useState(false)
 const [paletteQuery, setPaletteQuery] = useState('')
 const [paletteIndex, setPaletteIndex] = useState(0)
 const [agentProbes, setAgentProbes] = useState<Record<string, AgentProbe>>({})
 const [onOpenProject, setOnOpenProject] = useState<ProjectConfig | null>(null)
 const [settingsOpen, setSettingsOpen] = useState(false)
 const [paneLayout, setPaneLayout] = useState<PaneLayout>(() => createLayout())
 const [version, setVersion] = useState('')
 const [fontSize, setFontSize] = useState(13)
 /** Live font size for Ctrl+/- zoom (shortcut handler must not read stale state). */
 const fontSizeRef = useRef(13)
 fontSizeRef.current = fontSize
 const [preferredAgentId, setPreferredAgentId] = useState<string | null>(null)
 const [theme, setTheme] = useState<'dark' | 'light'>('dark')
 const [updateInfo, setUpdateInfo] = useState<{
 updateAvailable: boolean
 latestVersion: string | null
 releaseUrl: string | null
 downloadUrl: string | null
 currentVersion: string
 } | null>(null)
 const [checkingUpdate, setCheckingUpdate] = useState(false)
 const [onboardingOpen, setOnboardingOpen] = useState(false)
 const [importGitOpen, setImportGitOpen] = useState(false)
 const [tabDragging, setTabDragging] = useState(false)
 /** Pane under cursor + dock edge (Roblox-style local docking). */
 const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
 /** False until initial restore finishes - prevents wiping saved tabs. */
 const [sessionHydrated, setSessionHydrated] = useState(false)
 /**
 * User-facing loading copy while PTYs restore / open-project / launch.
 * Empty string = not loading.
 */
 const [terminalLoadMsg, setTerminalLoadMsg] = useState('Starting TrueDeck…')
 const stageRef = useRef<HTMLElement | null>(null)
 const splitDragRef = useRef<{
 splitId: string
 axis: 'x' | 'y'
 rect: DOMRect
 lastFrac?: number
 } | null>(null)
 /** Latest snapshot builder for close flush + immediate geometry saves. */
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const buildPersistSnapshotRef = useRef<(() => any) | null>(null)

 /**
 * Persist an explicit layout tree immediately (the *next* tree from a
 * setPaneLayout updater). Waiting for React re-render often flushed the
 * previous single-leaf tree when the user quit right after splitting.
 */
 const persistLayoutSnapshot = useCallback((layoutIn: PaneLayout): void => {
 try {
 const st = useDeck.getState()
 const project = st.projects.find((p) => p.id === st.activeProjectId)
 const running = st.sessions.filter((s) => s.status === 'running')
 const live = new Set(running.map((s) => s.id))
 const layout = layoutIn?.root ? layoutIn : normalizeLayout(layoutIn)
 const groups = listGroups(layout)
 const fromLayout = groups.flatMap((g) => g.sessionIds).filter((id) => live.has(id))
 const seen = new Set<string>()
 const orderFinal: string[] = []
 for (const id of fromLayout.length ? fromLayout : running.map((s) => s.id)) {
 if (seen.has(id) || !live.has(id)) continue
 seen.add(id)
 orderFinal.push(id)
 }
 const focusSid = st.activeSessionId
 const focusSession = running.find((s) => s.id === focusSid)
 const activeProjectRoot =
 project?.root ||
 (focusSession &&
 project &&
 sameProjectRoot(focusSession.projectRoot, project.root)
 ? focusSession.projectRoot
 : null) ||
 focusSession?.projectRoot ||
 running[0]?.projectRoot ||
 null
 const splitSid =
 groups.length > 1
 ? groups[1]?.activeSessionId || groups[1]?.sessionIds[0] || null
 : null
 const tree = serializePaneTree(layout, orderFinal)
 const tabs = orderFinal.map((id) => {
 const s = running.find((x) => x.id === id)!
 return {
 agentId: s.agentId,
 agentName: s.agentName,
 projectRoot: s.projectRoot,
 color: s.color,
 kind: (s.kind === 'command' || s.commandLine ? 'command' : 'agent') as
 | 'agent'
 | 'command',
 commandLine: s.commandLine
 }
 })
 const focusedGroupTabIndex =
 st.activeSessionId && orderFinal.includes(st.activeSessionId)
 ? orderFinal.indexOf(st.activeSessionId)
 : null
 const snap = {
 activeProjectRoot,
 activeSessionId: st.activeSessionId,
 splitSessionId: splitSid && live.has(splitSid) ? splitSid : null,
 splitRatio: layout.root.type === 'split' ? layout.root.ratio : 0.5,
 sessionOrder: orderFinal,
 tabs,
 paneTree: tree,
 focusedGroupTabIndex
 }
 if (typeof window.truedeck.persistSessionsSync === 'function') {
 window.truedeck.persistSessionsSync(snap)
 } else {
 void window.truedeck.persistSessions(snap).catch(() => {
 // ignore
 })
 }
 } catch {
 // ignore
 }
 }, [])


 /** Sync write of current multi-pane tree (ratios + groups) to disk. */
 const flushLayoutToDisk = useCallback((): void => {
 try {
 const builder = buildPersistSnapshotRef.current
 if (!builder) return
 const snap = builder()
 if (typeof window.truedeck.persistSessionsSync === 'function') {
 window.truedeck.persistSessionsSync(snap)
 } else {
 void window.truedeck.persistSessions(snap).catch(() => {
 // ignore
 })
 }
 } catch {
 // ignore
 }
 }, [])

 const activeProject = useMemo(
 () => projects.find((p) => p.id === activeProjectId) || null,
 [projects, activeProjectId]
 )

 const projectSessions = useMemo(
 () =>
 sessions.filter((s) =>
 activeProject ? sameProjectRoot(s.projectRoot, activeProject.root) : true
 ),
 [sessions, activeProject]
 )

 const filteredAgents = useMemo(() => {
 const q = paletteQuery.trim().toLowerCase()
 if (!q) return agents
 return agents.filter(
 (a) =>
 a.name.toLowerCase().includes(q) ||
 a.id.toLowerCase().includes(q) ||
 a.command.toLowerCase().includes(q)
 )
 }, [agents, paletteQuery])

 /**
 * Keep the *canonical* pane tree aligned with **all** live sessions.
 * Never sync against project-filtered ids - that collapsed multi-pane layouts
 * whenever the active project didn't match session roots (or on project switch).
 * Display uses `displayLayout` (filtered) so other projects stay hidden.
 *
 * Important: do **not** depend on `activeSessionId`. Ctrl+Arrow / click update
 * layout first, then the store. Re-running syncSessions with a stale
 * preferActive snapped focus back to the previous tab after every move.
 * Membership changes (spawn/close) still flow through `sessions`.
 */
 useEffect(() => {
 if (!sessionHydrated) return
 const ids = sessions.map((s) => s.id)
 // Read latest focus from the store at effect time (sessions-change render
 // already has the matching activeSessionId from addSession / removeSession).
 const prefer = useDeck.getState().activeSessionId
 setPaneLayout((prev) => {
 const base = prev?.root ? prev : normalizeLayout(prev)
 return syncSessions(base, ids, prefer)
 })
 // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: not activeSessionId
 }, [sessionHydrated, sessions])

 /** Per-project view of the layout - does not mutate the saved tree. */
 const displayLayout = useMemo(() => {
 if (!activeProject) return paneLayout
 const keep = new Set(projectSessions.map((s) => s.id))
 // Same project as every session (common case) - skip clone work
 const all = allSessionIds(paneLayout)
 if (all.length === keep.size && all.every((id) => keep.has(id))) {
 return paneLayout
 }
 return filterLayoutToSessionIds(paneLayout, keep)
 }, [paneLayout, projectSessions, activeProject])

 const focusTab = useCallback(
 (id: string) => {
 setPaneLayout((prev) => layoutFocusSession(prev, id))
 setActiveSession(id)
 },
 [setActiveSession]
 )

 /** In-flight closes - never cascade kill more than one id per click/shortcut. */
 const closingIdsRef = useRef<Set<string>>(new Set())

 const closeSession = useCallback(
 async (id: string) => {
 if (!id || typeof id !== 'string') return
 if (closingIdsRef.current.has(id)) return
 closingIdsRef.current.add(id)
 try {
 // Drop from UI first so layout/sync cannot re-target another tab mid-kill.
 removeSession(id)
 setPaneLayout((prev) => removeSessionFromLayout(prev, id))
 setStatus('Tab closed')
 try {
 await window.truedeck.killSession(id)
 } catch {
 // ignore - UI already closed this tab only
 }
 } finally {
 closingIdsRef.current.delete(id)
 }
 },
 [removeSession, setStatus]
 )

 const applyDrop = useCallback(
 (sessionId: string, edge: DropEdge, targetGroupId?: string): boolean => {
 if (!sessionId) {
 setStatus('Drop failed - try again')
 return false
 }
 let nextLayout: PaneLayout | null = null
 setPaneLayout((prev) => {
 const next = placeSession(prev, sessionId, edge, targetGroupId)
 nextLayout = next
 const a = activeSessionOf(next)
 if (a) setActiveSession(a)
 return next
 })
 // Quiet status - long "Studio dock · …" messages were confusing and stuck around
 setStatus(
 edge === 'center'
 ? 'Tab joined group'
 : edge === 'left'
 ? 'Split left'
 : edge === 'right'
 ? 'Split right'
 : edge === 'top'
 ? 'Split above'
 : 'Split below'
 )
 // Persist the *next* tree immediately (don't wait for React re-render)
 if (nextLayout) persistLayoutSnapshot(nextLayout)
 return true
 },
 [setActiveSession, setStatus, persistLayoutSnapshot]
 )

 // Window-level DnD - dock relative to the pane under the cursor
 useEffect(() => {
 if (!tabDragging) {
 setDropTarget(null)
 return
 }

 const overStage = (clientX: number, clientY: number): boolean => {
 const el = stageRef.current
 if (!el) return false
 const r = el.getBoundingClientRect()
 return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
 }

 const resolveTarget = (clientX: number, clientY: number): DropTarget | null => {
 const groupId = groupIdFromPoint(clientX, clientY)
 if (!groupId) return null
 // Dropping on that pane’s tab strip = join tabs (Studio tab dock)
 if (isOverGroupTabBar(clientX, clientY, groupId)) {
 return { groupId, edge: 'center' }
 }
 const host = document.querySelector(
 `.pane-group[data-group-id="${CSS.escape(groupId)}"]`
 ) as HTMLElement | null
 if (!host) return null
 const rect = host.getBoundingClientRect()
 return { groupId, edge: edgeFromPoint(clientX, clientY, rect) }
 }

 const onDragOver = (e: DragEvent) => {
 if (!getDraggingTabId() && !(e.dataTransfer?.types || []).length) return
 if (!overStage(e.clientX, e.clientY)) {
 setDropTarget(null)
 return
 }
 e.preventDefault()
 if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
 setDropTarget(resolveTarget(e.clientX, e.clientY))
 }

 const onDrop = (e: DragEvent) => {
 if (!overStage(e.clientX, e.clientY)) return
 e.preventDefault()
 e.stopPropagation()
 const target = resolveTarget(e.clientX, e.clientY)
 const id =
 e.dataTransfer?.getData('application/x-truedeck-tab') ||
 e.dataTransfer?.getData('text/plain') ||
 getDraggingTabId() ||
 ''
 setDraggingTabId(null)
 setTabDragging(false)
 setDropTarget(null)
 if (target) applyDrop(id, target.edge, target.groupId)
 else applyDrop(id, 'center')
 }

 const onDragEnd = () => {
 setTabDragging(false)
 setDropTarget(null)
 window.setTimeout(() => setDraggingTabId(null), 0)
 }

 window.addEventListener('dragover', onDragOver, true)
 window.addEventListener('drop', onDrop, true)
 window.addEventListener('dragend', onDragEnd, true)
 return () => {
 window.removeEventListener('dragover', onDragOver, true)
 window.removeEventListener('drop', onDrop, true)
 window.removeEventListener('dragend', onDragEnd, true)
 }
 }, [tabDragging, applyDrop])

 // Resize a nested split gutter (only that split's ratio)
 useEffect(() => {
 const onMove = (e: MouseEvent) => {
 const drag = splitDragRef.current
 if (!drag) return
 const rect = drag.rect
 let frac: number | null = null
 if (drag.axis === 'x') {
 if (rect.width <= 0) return
 frac = (e.clientX - rect.left) / rect.width
 } else {
 if (rect.height <= 0) return
 frac = (e.clientY - rect.top) / rect.height
 }
 if (frac == null) return
 drag.lastFrac = frac
 setPaneLayout((prev) => setSplitRatio(prev, drag.splitId, frac!))
 }
 const onUp = () => {
 const drag = splitDragRef.current
 if (!drag) return
 const { splitId, lastFrac } = drag
 splitDragRef.current = null
 document.body.classList.remove('is-resizing-split')
 // Persist final ratio from the *next* tree (not stale React state)
 if (typeof lastFrac === 'number') {
 let nextLayout: PaneLayout | null = null
 setPaneLayout((prev) => {
 nextLayout = setSplitRatio(prev, splitId, lastFrac)
 return nextLayout
 })
 if (nextLayout) persistLayoutSnapshot(nextLayout)
 } else {
 flushLayoutToDisk()
 }
 }
 window.addEventListener('mousemove', onMove)
 window.addEventListener('mouseup', onUp)
 return () => {
 window.removeEventListener('mousemove', onMove)
 window.removeEventListener('mouseup', onUp)
 }
 }, [flushLayoutToDisk, persistLayoutSnapshot])

 const applySettings = useCallback((s: AppSettings) => {
 setFontSize(s.fontSize || 13)
 setTheme(s.theme || 'dark')
 document.documentElement.classList.toggle('theme-light', s.theme === 'light')
 if (s.preferredAgentId) setPreferredAgentId(s.preferredAgentId)
 }, [])

 useEffect(() => {
 let cancelled = false
 // Avoid treating restore spawns as user-created (active jumps / double-save).
 let restoring = true

 const offSpawn = window.truedeck.onPtySpawned((info) => {
 if (restoring) return
 addSession(info)
 })
 const offExit = window.truedeck.onPtyExit(({ id, exitCode }) => {
 markSessionExited(id, exitCode)
 void window.truedeck.taskSessionExit(id, exitCode).catch(() => {
 // ignore
 })
 })

 void (async () => {
 if (!cancelled) {
 setTerminalLoadMsg('Starting TrueDeck…')
 setStatus('Starting…')
 }
 await refreshProjects()
 await refreshAgents()
 try {
 const v = await window.truedeck.version()
 if (!cancelled) setVersion(v)
 } catch {
 // ignore
 }

 let shouldRestore = true
 try {
 const s = await window.truedeck.getSettings()
 if (!cancelled) {
 applySettings(s)
 if (s.preferredAgentId) setPreferredAgentId(s.preferredAgentId)
 }
 shouldRestore = s.reopenLastProject !== false
 } catch {
 // ignore
 }

 try {
 const result = await window.truedeck.firstRun()
 if (result.firstRun && result.seeded.length) {
 if (!cancelled) {
 setStatus(`Ready · seeded ${result.seeded.map((p) => p.name).join(', ')}`)
 }
 await refreshProjects()
 }
 } catch {
 // ignore
 }

 // Restore open agent tabs from last run (respawn PTYs).
 if (shouldRestore && !cancelled) {
 try {
 if (!cancelled) {
 setTerminalLoadMsg('Restoring terminals…')
 setStatus('Restoring terminals…')
 }
 const { layout, sessions: restored, restored: count } =
 await window.truedeck.restoreSessions()
 if (!cancelled && count > 0) {
 setTerminalLoadMsg(
 count === 1
 ? 'Connecting terminal…'
 : `Connecting ${count} terminals…`
 )
 // Bulk-load without stealing focus on each tab (last would thrash project UI)
 for (const info of restored) addSession(info, { focus: false })
 const projects = await window.truedeck.listProjects()
 const root = layout.activeProjectRoot
 const findByRoot = (r: string | null | undefined): ProjectConfig | null =>
 r
 ? projects.find((p) => sameProjectRoot(p.root, r)) || null
 : null
 // Honor the workspace the user last had open. Do NOT jump to
 // restored[0]'s folder just because tabs from other projects exist - 
 // that felt like random project switching on every restart.
 const focusedTab =
 restored[
 typeof layout.focusedGroupTabIndex === 'number'
 ? layout.focusedGroupTabIndex
 : layout.activeIndex
 ] || restored[layout.activeIndex]
 const proj =
 findByRoot(root) ||
 findByRoot(focusedTab?.projectRoot) ||
 findByRoot(restored[0]?.projectRoot) ||
 projects[0] ||
 null
 if (proj) setActiveProject(proj.id)
 const ids = restored.map((s) => s.id)
 // Prefer focusedGroupTabIndex (per-group) then activeIndex - but only
 // if that tab belongs to the workspace we just selected.
 const focusIdx =
 typeof layout.focusedGroupTabIndex === 'number' &&
 layout.focusedGroupTabIndex >= 0 &&
 layout.focusedGroupTabIndex < restored.length
 ? layout.focusedGroupTabIndex
 : layout.activeIndex
 const want = restored[focusIdx] || restored[layout.activeIndex]
 const inProj = proj
 ? restored.filter((s) => sameProjectRoot(s.projectRoot, proj.root))
 : restored
 // Never focus a tab outside the selected workspace (would look like
 // we switched projects / show the wrong title-bar session).
 const active =
 (want &&
 (!proj || sameProjectRoot(want.projectRoot, proj.root)) &&
 want) ||
 inProj[inProj.length - 1] ||
 null
 if (active) setActiveSession(active.id)
 else setActiveSession(null)
 // Prefer nested pane tree (v2); fall back to legacy splitIndex
 let pl: PaneLayout
 if (layout.paneTree) {
 pl = deserializePaneTree(layout.paneTree, ids, active?.id || null)
 } else if (
 layout.splitIndex !== null &&
 layout.splitIndex !== layout.activeIndex &&
 restored[layout.splitIndex] &&
 restored[layout.activeIndex]
 ) {
 const a = restored[layout.activeIndex].id
 const b = restored[layout.splitIndex].id
 pl = createLayout(ids, a)
 pl = placeSession(pl, b, 'right')
 pl = setPrimaryRatio(pl, layout.splitRatio || 0.5)
 } else {
 pl = createLayout(ids, active?.id || null)
 }
 // Ensure every restored session is placed (failed mid-tree remaps can orphan)
 pl = syncSessions(pl, ids, active?.id || null)
 // Align focused pane with active tab so Ctrl+Arrow works immediately
 if (active?.id) pl = layoutFocusSession(pl, active.id)
 setPaneLayout(pl)
 setStatus(
 count === 1
 ? 'Restored 1 terminal session'
 : `Restored ${count} terminal sessions` +
 (layout.paneTree?.type === 'split' ? ' · multi-pane' : '')
 )
 } else if (!cancelled) {
 const list = await window.truedeck.listProjects()
 if (list[0]) setActiveProject(list[0].id)
 }
 } catch {
 try {
 const list = await window.truedeck.listProjects()
 if (!cancelled && list[0]) setActiveProject(list[0].id)
 } catch {
 // ignore
 }
 }
 } else if (!cancelled) {
 try {
 const list = await window.truedeck.listProjects()
 if (list[0]) setActiveProject(list[0].id)
 } catch {
 // ignore
 }
 }

 restoring = false
 if (!cancelled) {
 setSessionHydrated(true)
 setTerminalLoadMsg('')
 // Re-seed layout focus after hydrate - first Ctrl+Arrow used to miss
 // because focusedGroupId lagged the restored activeSessionId.
 const st = useDeck.getState()
 const aid = st.activeSessionId
 if (aid) {
 setPaneLayout((prev) => layoutFocusSession(normalizeLayout(prev), aid))
 } else if (st.sessions.length) {
 const proj = st.projects.find((p) => p.id === st.activeProjectId)
 const pick =
 (proj &&
 st.sessions.find((s) => sameProjectRoot(s.projectRoot, proj.root))) ||
 st.sessions[0]
 if (pick) {
 setActiveSession(pick.id)
 setPaneLayout((prev) => layoutFocusSession(normalizeLayout(prev), pick.id))
 }
 }
 const prev = st.status || ''
 if (
 prev.startsWith('Restoring') ||
 prev.startsWith('Starting') ||
 prev.startsWith('Connecting') ||
 prev === 'Starting…'
 ) {
 setStatus('Ready')
 }
 }

 // First-run onboarding (walkthrough)
 try {
 const ob = await window.truedeck.getOnboarding()
 if (!cancelled && !ob.completed) setOnboardingOpen(true)
 } catch {
 // ignore
 }
 // Background release check
 try {
 const u = await window.truedeck.checkUpdates(false)
 if (cancelled) return
 setUpdateInfo({
 updateAvailable: u.updateAvailable,
 latestVersion: u.latestVersion,
 releaseUrl: u.releaseUrl,
 downloadUrl: u.downloadUrl,
 currentVersion: u.currentVersion
 })
 if (u.updateAvailable && u.latestVersion) {
 setStatus(`Update available: v${u.latestVersion}`)
 }
 } catch {
 // ignore offline
 }
 })()

 return () => {
 cancelled = true
 restoring = false
 offSpawn()
 offExit()
 }
 }, [
 addSession,
 applySettings,
 markSessionExited,
 refreshAgents,
 refreshProjects,
 setActiveProject,
 setActiveSession,
 setStatus
 ])

 /** Build a stable persist snapshot: running sessions only, tree indices match order. */
 const buildPersistSnapshot = useCallback(() => {
 const st = useDeck.getState()
 const project = st.projects.find((p) => p.id === st.activeProjectId)
 const running = st.sessions.filter((s) => s.status === 'running')
 const live = new Set(running.map((s) => s.id))
 // Always normalize so empty / partial state still serializes a valid tree
 const layout = paneLayout?.root ? paneLayout : normalizeLayout(paneLayout)
 const groups = listGroups(layout)
 // Only sessions that are actually in the pane tree - appending "orphan" running
 // PTYs (restore races / onOpen stacks) bloated session-layout.json to MAX tabs
 // and broke multi-pane restore.
 const fromLayout = groups.flatMap((g) => g.sessionIds).filter((id) => live.has(id))
 // Dedupe while preserving order (defensive)
 const seen = new Set<string>()
 const orderFinal: string[] = []
 for (const id of fromLayout.length ? fromLayout : running.map((s) => s.id)) {
 if (seen.has(id) || !live.has(id)) continue
 seen.add(id)
 orderFinal.push(id)
 }
 // Workspace root is the UI-selected project - never a random focused tab
 // from another folder (that rewrote activeProjectRoot and jumped projects
 // on the next launch).
 const activeProjectRoot =
 project?.root || activeProject?.root || running[0]?.projectRoot || null
 const splitSid =
 groups.length > 1
 ? groups[1]?.activeSessionId || groups[1]?.sessionIds[0] || null
 : null
 const tree = serializePaneTree(layout, orderFinal)
 // Explicit tab metadata so disk does not depend only on ptyManager list order
 const tabs = orderFinal.map((id) => {
 const s = running.find((x) => x.id === id)!
 return {
 agentId: s.agentId,
 agentName: s.agentName,
 projectRoot: s.projectRoot,
 color: s.color,
 kind: (s.kind === 'command' || s.commandLine ? 'command' : 'agent') as
 | 'agent'
 | 'command',
 commandLine: s.commandLine
 }
 })
 const focusedGroupTabIndex =
 st.activeSessionId && orderFinal.includes(st.activeSessionId)
 ? orderFinal.indexOf(st.activeSessionId)
 : null
 return {
 activeProjectRoot,
 activeSessionId: st.activeSessionId,
 splitSessionId: splitSid && live.has(splitSid) ? splitSid : null,
 splitRatio: layout.root.type === 'split' ? layout.root.ratio : 0.5,
 sessionOrder: orderFinal,
 tabs,
 paneTree: tree,
 focusedGroupTabIndex
 }
 }, [paneLayout, activeProject])

 buildPersistSnapshotRef.current = buildPersistSnapshot

 // Persist open tabs + multi-pane tree so restart brings them back.
 // Debounced for focus/tab noise; geometry mutations also call persistLayoutSnapshot.
 useEffect(() => {
 if (!sessionHydrated) return
 const timer = window.setTimeout(() => {
 void window.truedeck.persistSessions(buildPersistSnapshot()).catch(() => {
 // ignore
 })
 }, 200)
 return () => window.clearTimeout(timer)
 }, [sessionHydrated, sessions, activeSessionId, paneLayout, activeProject, buildPersistSnapshot])

 // Flush layout on page hide / unload (dev HMR + app close).
 // Must be **sync** - async invoke often dies before the write lands.
 useEffect(() => {
 if (!sessionHydrated) return
 const flush = (): void => {
 flushLayoutToDisk()
 }
 const onVis = (): void => {
 if (document.visibilityState === 'hidden') flush()
 }
 // Main process close handler calls this via executeJavaScript
 window.__truedeckFlushSessions = flush
 window.addEventListener('pagehide', flush)
 window.addEventListener('beforeunload', flush)
 document.addEventListener('visibilitychange', onVis)
 return () => {
 if (window.__truedeckFlushSessions === flush) delete window.__truedeckFlushSessions
 window.removeEventListener('pagehide', flush)
 window.removeEventListener('beforeunload', flush)
 document.removeEventListener('visibilitychange', onVis)
 }
 }, [sessionHydrated, flushLayoutToDisk])

 /**
 * Simple shortcuts: Ctrl + letter (no Shift).
 * Ctrl+O project · Ctrl+W close · Ctrl+S settings
 * Ctrl+T new agent · Ctrl+Tab next · Ctrl+D split vertical · Ctrl+X split horizontal · Ctrl+N shell · Ctrl+1-9 jump
 * Ctrl+←/→/↑/↓ move between panes (or tabs when single pane)
 * Ctrl+= / Ctrl++ font zoom in · Ctrl+- zoom out · Ctrl+0 reset (11–20px, saved)
 * Deck launch/pipelines: via truedeck-hub MCP (truedeck_launch) - no UI panel
 *
 * Handlers read layout/sessions from refs so they never go stale under agent TUIs.
 * Main process also emits app:shortcut (before-input-event) for Ctrl+Arrow.
 */
 const shortcutCtxRef = useRef({
 activeSessionId,
 activeProject,
 projectSessions,
 displayLayout,
 paneLayout,
 closeSession,
 persistLayoutSnapshot,
 addProjectFn: null as null | (() => void),
 launchAgentFn: null as null | ((id: string) => void)
 })
 /** Always-current layout for shortcuts (setState alone can lag one IPC event). */
 const paneLayoutRef = useRef(paneLayout)
 shortcutCtxRef.current.activeSessionId = activeSessionId
 shortcutCtxRef.current.activeProject = activeProject
 shortcutCtxRef.current.projectSessions = projectSessions
 shortcutCtxRef.current.displayLayout = displayLayout
 shortcutCtxRef.current.paneLayout = paneLayout
 shortcutCtxRef.current.closeSession = closeSession
 shortcutCtxRef.current.persistLayoutSnapshot = persistLayoutSnapshot
 paneLayoutRef.current = paneLayout

 useEffect(() => {
 const dirMap: Record<string, NavDir> = {
 ArrowLeft: 'left',
 ArrowRight: 'right',
 ArrowUp: 'up',
 ArrowDown: 'down'
 }

 /**
 * Per-key dedupe: DOM keydown + Electron before-input often fire together.
 * Map-based so Left/Right don't block each other; short windows only.
 */
 const lastAt = new Map<string, number>()
 const once = (sig: string, ms = 30): boolean => {
 const now = Date.now()
 const prev = lastAt.get(sig) || 0
 if (now - prev < ms) return false
 lastAt.set(sig, now)
 return true
 }

 const handleShortcut = (raw: {
 key: string
 shift: boolean
 alt: boolean
 ctrl: boolean
 fromDom?: boolean
 repeat?: boolean
 claim?: () => void
 }): void => {
 if (!raw.ctrl) return
 try {
 const ctx = shortcutCtxRef.current
 // Normalize arrow aliases (Left → ArrowLeft)
 let key = raw.key
 if (key === 'Left' || key === 'Right' || key === 'Up' || key === 'Down') {
 key = `Arrow${key}`
 }
 // Electron sometimes sends "ArrowLeft" with code only - also accept bare codes
 if (!(key in dirMap) && key.startsWith('Arrow')) {
 /* already ok */
 }
 const letter = key.length === 1 ? key.toLowerCase() : ''
 const isArrow = key in dirMap

 // Pane focus: Alt+Ctrl+Arrow still navigates (some keyboards leave Alt sticky).
 // Always claim so the agent TUI never eats the chord.
 if (isArrow) {
 raw.claim?.()
 // Only dedupe true double-fires (IPC+DOM). Repeat keys get a gentler gate.
 if (!once(`arrow:${key}`, raw.repeat ? 85 : 18)) return

 const st = useDeck.getState()
 const project = st.projects.find((p) => p.id === st.activeProjectId) || null
 // Prefer running sessions; fall back to any session so arrows work mid-exit
 let liveSessions = st.sessions.filter(
 (s) =>
 s.status === 'running' &&
 (project ? sameProjectRoot(s.projectRoot, project.root) : true)
 )
 if (!liveSessions.length) {
 liveSessions = st.sessions.filter((s) =>
 project ? sameProjectRoot(s.projectRoot, project.root) : true
 )
 }
 if (!liveSessions.length) {
 setStatus('No tabs to focus')
 return
 }
 const dir = dirMap[key]
 const allowIds = new Set(liveSessions.map((s) => s.id))
 const prefer =
 (st.activeSessionId && allowIds.has(st.activeSessionId) && st.activeSessionId) ||
 liveSessions[liveSessions.length - 1]?.id ||
 null

 // Synchronous layout step - never depend on setState updater timing
 const base = normalizeLayout(paneLayoutRef.current)
 let view = base
 if (project) {
 const all = allSessionIds(base)
 if (!(all.length === allowIds.size && all.every((id) => allowIds.has(id)))) {
 view = filterLayoutToSessionIds(base, allowIds)
 }
 }
 if (prefer && findGroup(view, prefer)) {
 view = layoutFocusSession(view, prefer)
 } else {
 const firstId = liveSessions[0]?.id
 if (firstId && findGroup(view, firstId)) {
 view = layoutFocusSession(view, firstId)
 }
 }

 const multi = listGroups(view).length > 1
 const { sessionId: sid } = stepPaneFocus(view, dir, {
 preferActive:
 (prefer && findGroup(view, prefer) && prefer) ||
 listGroups(view)[0]?.activeSessionId ||
 null,
 allowIds
 })

 if (!sid) {
 if (!raw.repeat) setStatus('No pane that way')
 return
 }

 const next = layoutFocusSession(base, sid)
 paneLayoutRef.current = next
 setPaneLayout(next)

 if (sid !== st.activeSessionId) {
 setActiveSession(sid)
 const label =
 liveSessions.find((s) => s.id === sid)?.agentName ||
 st.sessions.find((s) => s.id === sid)?.agentName ||
 'pane'
 setStatus(multi ? `Focus → ${label} (${dir})` : `Tab → ${label}`)
 } else if (!raw.repeat) {
 setStatus(
 multi
 ? 'Already focused that way'
 : liveSessions.length < 2
 ? 'Only one tab here - open another (Ctrl+T) or split (Ctrl+D)'
 : 'Already on that tab'
 )
 }
 return
 }

 if (letter === 'o' && !raw.shift && !raw.alt) {
 if (!once('o')) return
 raw.claim?.()
 ctx.addProjectFn?.()
 return
 }

 // Close ONE visible tab only - never cascade across projects or groups
 if (letter === 'w' && !raw.shift && !raw.alt) {
 if (!once('w')) return
 raw.claim?.()
 const visibleIds = new Set(ctx.projectSessions.map((s) => s.id))
 const target =
 (ctx.activeSessionId &&
 visibleIds.has(ctx.activeSessionId) &&
 ctx.activeSessionId) ||
 activeSessionOf(ctx.displayLayout) ||
 null
 if (target && visibleIds.has(target)) {
 void ctx.closeSession(target)
 } else {
 setStatus('No tab to close')
 }
 return
 }

 if (letter === 's' && !raw.shift && !raw.alt) {
 if (!once('s')) return
 raw.claim?.()
 setPaletteOpen(false)
 setSettingsOpen((v) => !v)
 return
 }

 if (letter === 't' && !raw.shift && !raw.alt) {
 if (!once('t')) return
 raw.claim?.()
 if (!ctx.activeProject) {
 setStatus('Pick a project first (Ctrl+O)')
 return
 }
 setSettingsOpen(false)
 setPaletteOpen(true)
 setPaletteQuery('')
 setPaletteIndex(0)
 setStatus('New agent - pick one')
 return
 }

 if (key === 'Tab') {
 if (!once(`tab:${raw.shift ? 'p' : 'n'}`)) return
 raw.claim?.()
 if (!ctx.projectSessions.length) return
 const allowIds = new Set(ctx.projectSessions.map((s) => s.id))
 let sessionId: string | null = null
 setPaneLayout((prev) => {
 const { layout: nextLayout, sessionId: sid } = cycleTabsInFocusedGroup(
 prev,
 raw.shift ? 'prev' : 'next',
 { preferActive: ctx.activeSessionId, allowIds }
 )
 sessionId = sid
 return sid ? nextLayout : prev
 })
 if (sessionId) {
 setActiveSession(sessionId)
 const label =
 ctx.projectSessions.find((s) => s.id === sessionId)?.agentName || 'tab'
 setStatus(`Tab → ${label}`)
 }
 return
 }

 if ((letter === 'd' || letter === 'x') && !raw.alt && !raw.shift) {
 if (!once(`split:${letter}`)) return
 raw.claim?.()
 if (ctx.projectSessions.length < 2 && countLeaves(ctx.paneLayout) < 2) {
 setStatus('Need 2+ tabs for multiple panes')
 return
 }
 // Move the *active* tab into the new pane (VS Code-style). Other tabs
 // stay in the current pane - never yank a background sibling instead.
 let splitNext: PaneLayout | null = null
 const moveId = ctx.activeSessionId
 setPaneLayout((prev) => {
 if (!moveId) {
 setStatus('No active tab to split')
 return prev
 }
 const groups = listGroups(prev)
 const home = groups.find((g) => g.sessionIds.includes(moveId))
 const siblings = home?.sessionIds.filter((id) => id !== moveId) || []
 if (siblings.length === 0) {
 setStatus('Need another tab in this pane to split')
 return prev
 }
 if (countLeaves(prev) >= MAX_PANES) {
 setStatus(`Max ${MAX_PANES} panes`)
 return prev
 }
 const edge = letter === 'x' ? 'bottom' : 'right'
 // Split relative to the pane that currently holds the tab
 const next = placeSession(prev, moveId, edge, home?.id || prev.focusedGroupId)
 const n = countLeaves(next)
 setStatus(
 n >= PANE_WARN_THRESHOLD
 ? `${n} panes (heavy - consider fewer agents)`
 : edge === 'right'
 ? `${n} panes · split vertical (Ctrl+D)`
 : `${n} panes · split horizontal (Ctrl+X)`
 )
 splitNext = next
 return next
 })
 if (splitNext) {
 ctx.persistLayoutSnapshot(splitNext)
 // Keep focus on the tab that moved into the new pane
 setActiveSession(moveId)
 }
 return
 }

 if ((letter === 'd' || letter === 'x') && raw.alt) {
 if (!once(`merge:${letter}`)) return
 raw.claim?.()
 let mergeNext: PaneLayout | null = null
 setPaneLayout((prev) => {
 mergeNext = mergeAllGroups(prev)
 return mergeNext
 })
 if (mergeNext) ctx.persistLayoutSnapshot(mergeNext)
 setStatus('One pane')
 return
 }

 if (letter === 'n' && !raw.shift && !raw.alt) {
 if (!once('n')) return
 raw.claim?.()
 ctx.launchAgentFn?.('shell')
 return
 }

 // Terminal font zoom (not Chromium page zoom).
 // Ctrl+= and Ctrl++ both zoom in (US keyboards: + is Shift+=).
 // Ctrl+- zooms out. Ctrl+0 resets to default 13px.
 {
 const kLow = key.length === 1 ? key.toLowerCase() : key.toLowerCase()
 const zoomIn =
 kLow === '=' ||
 kLow === '+' ||
 kLow === 'equal' ||
 kLow === 'numpadadd' ||
 kLow === 'add'
 const zoomOut =
 kLow === '-' ||
 kLow === '_' ||
 kLow === 'minus' ||
 kLow === 'numpadsubtract' ||
 kLow === 'subtract'
 const zoomReset = kLow === '0' || kLow === 'digit0' || kLow === 'numpad0'
 if ((zoomIn || zoomOut || zoomReset) && !raw.alt) {
 if (!once(`zoom:${zoomIn ? 'in' : zoomOut ? 'out' : 'reset'}`)) return
 raw.claim?.()
 const cur = fontSizeRef.current || 13
 const next = zoomReset
 ? 13
 : Math.min(20, Math.max(11, cur + (zoomIn ? 1 : -1)))
 if (next === cur && !zoomReset) {
 setStatus(`Font already ${cur}px`)
 return
 }
 fontSizeRef.current = next
 setFontSize(next)
 setStatus(`Font ${next}px`)
 void window.truedeck
 .getSettings()
 .then((s) => window.truedeck.setSettings({ ...s, fontSize: next }))
 .then((saved) => applySettings(saved))
 .catch(() => {
 /* ignore */
 })
 return
 }
 }

 if (!raw.shift && !raw.alt && key >= '1' && key <= '9') {
 if (!once(`num:${key}`)) return
 raw.claim?.()
 const s = ctx.projectSessions[Number(key) - 1]
 if (s) {
 const next = layoutFocusSession(normalizeLayout(paneLayoutRef.current), s.id)
 paneLayoutRef.current = next
 setPaneLayout(next)
 setActiveSession(s.id)
 }
 }
 } catch (err) {
 console.warn('[shortcut]', err)
 }
 }

 const onKey = (e: KeyboardEvent): void => {
 if (e.key === 'Escape') {
 setSettingsOpen(false)
 setPaletteOpen(false)
 return
 }

 const ctrl = e.ctrlKey || e.metaKey
 if (!ctrl) return

 const fromCode =
 typeof e.code === 'string' && e.code.startsWith('Key')
 ? e.code.slice(3).toLowerCase()
 : ''
 const arrowFromCode =
 e.code === 'ArrowLeft' ||
 e.code === 'ArrowRight' ||
 e.code === 'ArrowUp' ||
 e.code === 'ArrowDown'
 ? e.code
 : ''
 const arrowFromKey =
 e.key === 'ArrowLeft' ||
 e.key === 'ArrowRight' ||
 e.key === 'ArrowUp' ||
 e.key === 'ArrowDown'
 ? e.key
 : e.key === 'Left' || e.key === 'Right' || e.key === 'Up' || e.key === 'Down'
 ? `Arrow${e.key}`
 : ''
 const arrow = arrowFromKey || arrowFromCode

 // Font zoom keys (code is stable; key varies by shift / layout)
 const zoomFromCode =
 e.code === 'Equal' || e.code === 'NumpadAdd'
 ? e.key === '+' || e.shiftKey || e.code === 'NumpadAdd'
 ? '+'
 : '='
 : e.code === 'Minus' || e.code === 'NumpadSubtract'
 ? '-'
 : e.code === 'Digit0' || e.code === 'Numpad0'
 ? '0'
 : ''

 const letter =
 (e.key.length === 1 ? e.key.toLowerCase() : '') || fromCode
 const key =
 arrow ||
 (e.key === 'Tab' || e.code === 'Tab' ? 'Tab' : '') ||
 zoomFromCode ||
 letter

 if (!key) return

 const t = e.target as HTMLElement | null
 const tag = t?.tagName?.toLowerCase()
 const inTerminal = Boolean(
 t?.closest?.('.xterm, .terminal-pane, .xterm-helper-textarea')
 )
 const typing =
 !inTerminal &&
 (tag === 'input' || tag === 'textarea' || Boolean(t?.isContentEditable))
 const alwaysToggle = letter === 's' || letter === 't'
 const isZoomKey =
 key === '+' ||
 key === '=' ||
 key === '-' ||
 key === '_' ||
 key === '0'
 if (typing && !alwaysToggle && !arrow && key !== 'Tab' && !isZoomKey) return

 handleShortcut({
 key,
 shift: e.shiftKey,
 alt: e.altKey,
 ctrl: true,
 fromDom: true,
 claim: () => {
 e.preventDefault()
 e.stopPropagation()
 e.stopImmediatePropagation()
 }
 })
 }

 // Primary path: main-process before-input-event (works when xterm has focus)
 const offShortcut =
 typeof window.truedeck.onAppShortcut === 'function'
 ? window.truedeck.onAppShortcut((payload) => {
 handleShortcut({
 key: payload.key,
 shift: payload.shift,
 alt: payload.alt,
 ctrl: payload.ctrl !== false,
 repeat: Boolean(payload.repeat)
 })
 })
 : undefined

 if (!offShortcut) {
 console.warn(
 '[truedeck] onAppShortcut missing - Ctrl+Arrow relies on DOM only (restart app after preload changes)'
 )
 }

 // Fallback path: capture-phase DOM (covers cases before-input does not fire)
 window.addEventListener('keydown', onKey, true)
 return () => {
 window.removeEventListener('keydown', onKey, true)
 offShortcut?.()
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [setActiveSession, setStatus])

 const addProject = async (): Promise<void> => {
 const p = await window.truedeck.addProject()
 if (!p) return
 await refreshProjects()
 setActiveProject(p.id)
 setOnOpenProject(p)
 setStatus(`Project ${p.name}`)
 }
 shortcutCtxRef.current.addProjectFn = () => {
 void addProject()
 }

 const openProject = async (p: ProjectConfig): Promise<void> => {
 // setActiveProject also moves focus onto a tab in this folder (or clears it)
 setActiveProject(p.id)
 setTerminalLoadMsg(`Opening ${p.name}…`)
 setStatus(`Opening ${p.name}…`)
 try {
 const res = await window.truedeck.openProject(p.id)
 const n = res.sessionIds?.length || 0
 if (n > 0) {
 setTerminalLoadMsg(
 n === 1 ? 'Starting terminal…' : `Starting ${n} terminals…`
 )
 }
 for (const id of res.sessionIds) {
 const all = await window.truedeck.listSessions()
 const found = all.find((s) => s.id === id)
 if (found) addSession(found, { focus: true })
 }
 // Reused on-open tabs: ensure we land on something in this project
 const st = useDeck.getState()
 const cur = st.sessions.find((s) => s.id === st.activeSessionId)
 if (!cur || !sameProjectRoot(cur.projectRoot, p.root)) {
 const inProj = st.sessions.filter(
 (s) => s.status === 'running' && sameProjectRoot(s.projectRoot, p.root)
 )
 if (inProj.length) setActiveSession(inProj[inProj.length - 1].id)
 }
 setStatus(`${p.name} ready`)
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 } finally {
 setTerminalLoadMsg('')
 }
 }

 const importReposFromFolder = async (): Promise<void> => {
 setTerminalLoadMsg('Scanning for git repos…')
 setStatus('Importing repositories…')
 try {
 const res = await window.truedeck.importRepos()
 await refreshProjects()
 const n = res.imported?.length || 0
 if (n === 0) {
 setStatus(
 res.parent
 ? 'No git repos found in that folder (need .git in children)'
 : 'Import cancelled'
 )
 } else {
 setStatus(
 n === 1
 ? `Imported ${res.imported[0].name}`
 : `Imported ${n} repositories` +
 (res.skipped?.length ? ` · skipped ${res.skipped.length}` : '')
 )
 const last = res.imported[res.imported.length - 1]
 if (last) await openProject(last)
 }
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 } finally {
 setTerminalLoadMsg('')
 }
 }

 const removeProjectFromList = async (p: ProjectConfig): Promise<void> => {
 try {
 await window.truedeck.removeProject(p.id)
 await refreshProjects()
 if (activeProjectId === p.id) {
 const rest = useDeck.getState().projects
 if (rest[0]) setActiveProject(rest[0].id)
 else setActiveProject(null)
 }
 setStatus(`Removed ${p.name} from list`)
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 }
 }

 const refreshAgentProbes = useCallback(async (): Promise<void> => {
 try {
 const list = await window.truedeck.probeAgents()
 const map: Record<string, AgentProbe> = {}
 for (const p of list) map[p.id] = p
 setAgentProbes(map)
 } catch {
 // ignore
 }
 }, [])

 useEffect(() => {
 if (!paletteOpen) return
 void refreshAgentProbes()
 }, [paletteOpen, refreshAgentProbes])

 const launchAgent = async (agentId: string): Promise<void> => {
 if (!activeProject) {
 setStatus('Pick a project first (Ctrl+O)')
 setPaletteOpen(false)
 return
 }
 const probe = agentProbes[agentId]
 if (probe && !probe.available && agentId !== 'shell') {
 setStatus(`${agentId} CLI not installed - use Install in the palette`)
 return
 }
 try {
 const root = activeProject.root
 const agentLabel =
 agents.find((a) => a.id === agentId)?.name || agentId
 setTerminalLoadMsg(`Launching ${agentLabel}…`)
 setStatus(`Launching ${agentLabel}…`)
 // Measure stage so Grok/Codex boot with real COLUMNS/LINES (not 120×30 defaults)
 const stage = stageRef.current
 const approxCols = stage
 ? Math.max(60, Math.min(220, Math.floor(stage.clientWidth / 7.2)))
 : 120
 const approxRows = stage
 ? Math.max(16, Math.min(80, Math.floor(stage.clientHeight / 15)))
 : 36
 const spawnPromise = window.truedeck.spawnSession({
 projectRoot: root,
 agentId,
 cols: approxCols,
 rows: approxRows
 })
 // Wire MCP + memory into every synced CLI under the hood
 void window.truedeck
 .injectMemoryForAgent({ allSynced: true, projectRoot: root })
 .catch(() => {
 // non-fatal
 })
 const info = await spawnPromise
 addSession(info)
 setPaletteOpen(false)
 const leaves = countLeaves(paneLayout) + 1
 setStatus(
 leaves >= PANE_WARN_THRESHOLD
 ? `→ ${info.agentName} · ${leaves} panes (heavy)`
 : `→ ${info.agentName}`
 )
 } catch (e) {
 const msg = e instanceof Error ? e.message : String(e)
 setStatus(msg)
 void refreshAgentProbes()
 } finally {
 setTerminalLoadMsg('')
 }
 }
 shortcutCtxRef.current.launchAgentFn = (id: string) => {
 void launchAgent(id)
 }

 const installAgentCli = async (agentId: string): Promise<void> => {
 if (!activeProject) {
 setStatus('Pick a project first (Ctrl+O)')
 return
 }
 try {
 const res = await window.truedeck.installAgentHelp({
 projectRoot: activeProject.root,
 agentId
 })
 if (res.alreadyInstalled) {
 setStatus(`Already installed: ${res.path || agentId}`)
 void refreshAgentProbes()
 return
 }
 if (res.session) {
 addSession(res.session)
 setPaletteOpen(false)
 setStatus(`Install help · ${agentId} - type y in the tab to run`)
 }
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 }
 }

 const shortPath = (p: string): string => {
 const home = (window as unknown as { __home?: string }).__home
 if (home && p.startsWith(home)) return '~' + p.slice(home.length)
 return p.length > 52 ? '...' + p.slice(-50) : p
 }

 // Window + title-bar: stable agent/task label only (never OSC thrash).
 const activeSession = useMemo(
 () => sessions.find((s) => s.id === activeSessionId) || null,
 [sessions, activeSessionId]
 )
 const windowSessionLabel = useMemo(() => {
 if (!activeSession) return null
 return sessionTabLabel(activeSession, 56)
 }, [
 activeSession?.id,
 activeSession?.agentName,
 activeSession?.agentId,
 activeSession?.taskId,
 activeSession?.focusTitle,
 activeSession?.focusIdea,
 activeSession?.kind,
 activeSession?.commandLine,
 activeSession?.status
 ])

 useEffect(() => {
 const base = version ? `TrueDeck ${version}` : 'TrueDeck'
 const title = windowSessionLabel ? `${windowSessionLabel} - TrueDeck` : base
 document.title = title
 if (typeof window.truedeck.setWindowTitle === 'function') {
 void window.truedeck.setWindowTitle(title).catch(() => {
 // ignore
 })
 }
 }, [windowSessionLabel, version])

 const paletteSelect = (agent: AgentPreset): void => {
 const probe = agentProbes[agent.id]
 // Never auto-run installers (some open browsers/IDEs). Only launch installed CLIs.
 if (probe && !probe.available && agent.id !== 'shell') {
 setStatus(`${agent.name} not installed - click Install`)
 return
 }
 void launchAgent(agent.id)
 }

 return (
 <div className="studio">
 {/* Custom window bar (frameless) */}
 <header
 className="titlebar"
 onDoubleClick={() => void window.truedeck.windowMaximize()}
 >
 <span className="titlebar-icon no-drag" aria-hidden>
 <img
 src={appIconUrl}
 width={18}
 height={18}
 alt=""
 draggable={false}
 style={{ display: 'block', borderRadius: 4 }}
 />
 </span>
 <span
 className="logo"
 title={windowSessionLabel || (version ? `TrueDeck ${version}` : 'TrueDeck')}
 >
 {windowSessionLabel ? (
 <>
 <span className="logo-mark">TRUEDECK</span>
 <span className="logo-session">{windowSessionLabel}</span>
 </>
 ) : (
 <>TRUEDECK{version ? ` ${version}` : ''}</>
 )}
 </span>
 <ProjectMenu
 projects={projects}
 activeProject={activeProject}
 shortPath={shortPath}
 onOpenProject={(p) => void openProject(p)}
 onAddProject={() => void addProject()}
 onImportGit={() => setImportGitOpen(true)}
 onImportReposFolder={() => void importReposFromFolder()}
 onRemoveProject={(p) => void removeProjectFromList(p)}
 />
 <div className="spacer" />
 {updateInfo?.updateAvailable && (
 <button
 type="button"
 className="no-drag update-btn"
 title={
 updateInfo.latestVersion
 ? `v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`
 : 'New release available'
 }
 onClick={() => {
 const url =
 updateInfo.downloadUrl ||
 updateInfo.releaseUrl ||
 'https://github.com/WutIsHummus/TrueDeck/releases/latest'
 void window.truedeck.openExternal(url)
 }}
 >
 Update{updateInfo.latestVersion ? ` v${updateInfo.latestVersion}` : ''}
 </button>
 )}
 <button
 type="button"
 className="no-drag settings-gear"
 title="Settings (Ctrl+S)"
 aria-label="Settings"
 onClick={() => setSettingsOpen(true)}
 >
 ⚙
 </button>
 <button
 type="button"
 className="no-drag settings-gear"
 title="Replay onboarding"
 aria-label="Help"
 onClick={() => setOnboardingOpen(true)}
 >
 ?
 </button>
 <WindowControls />
 </header>

 <main
 ref={stageRef}
 className={`stage ${countLeaves(displayLayout) > 1 ? 'split' : ''} ${tabDragging ? 'can-drop-split' : ''}`}
 >
 {!sessionHydrated ? (
 <LoadingCard
 title={terminalLoadMsg || 'Loading terminals…'}
 hint="Spawning PTYs from your last session - this can take a few seconds"
 />
 ) : projectSessions.length === 0 ? (
 <div className="stage-empty">
 {terminalLoadMsg ? (
 <LoadingCard title={terminalLoadMsg} compact />
 ) : (
 <div className="stage-empty-frame">
 <h2>truedeck</h2>
 <p>
 Terminal-first agent deck - between Codex and a plain CLI.
 <br />
 <kbd>Ctrl+O</kbd> project · <kbd>Ctrl+T</kbd> new agent ·{' '}
 <kbd>Ctrl+W</kbd> close tab
 </p>
 <div className="row" style={{ justifyContent: 'center' }}>
 <button type="button" className="primary" onClick={() => void addProject()}>
 Open project
 </button>
 <button
 type="button"
 onClick={() => setPaletteOpen(true)}
 disabled={!activeProject}
 >
 Launch agent
 </button>
 </div>
 {projects.length > 0 && (
 <div className="stage-empty-recent">
 <div className="muted stage-empty-recent-label">recent</div>
 {projects.slice(0, 5).map((p) => (
 <button
 key={p.id}
 type="button"
 className="stage-empty-recent-item"
 onClick={() => void openProject(p)}
 >
 {p.name}{' '}
 <span
 className="muted"
 style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
 >
 {shortPath(p.root)}
 </span>
 </button>
 ))}
 </div>
 )}
 </div>
 )}
 </div>
 ) : (
 <>
 <PaneWorkspace
 layout={displayLayout}
 sessions={projectSessions}
 fontSize={fontSize}
 dropTarget={dropTarget}
 tabDragging={tabDragging}
 onFocusSession={focusTab}
 onCloseSession={(id) => void closeSession(id)}
 onReorderInGroup={(groupId, sessionId, toIndex) => {
 setPaneLayout((prev) => reorderInGroup(prev, groupId, sessionId, toIndex))
 if (activeProject) {
 moveSessionInProject(sessionId, toIndex, activeProject.root)
 }
 }}
 onCloseGroup={(groupId) => {
 let closed: PaneLayout | null = null
 setPaneLayout((prev) => {
 closed = closeGroup(prev, groupId)
 return closed
 })
 if (closed) persistLayoutSnapshot(closed)
 setStatus('Pane closed')
 }}
 onDragActiveChange={setTabDragging}
 onNewInGroup={(groupId) => {
 setPaneLayout((prev) => ({ ...prev, focusedGroupId: groupId }))
 setPaletteOpen(true)
 }}
 onGutterDown={(e, splitId, direction) => {
 e.preventDefault()
 e.stopPropagation()
 const host = (e.currentTarget as HTMLElement).parentElement
 const rect = host?.getBoundingClientRect()
 if (!rect) return
 splitDragRef.current = {
 splitId,
 axis: direction === 'column' ? 'y' : 'x',
 rect
 }
 document.body.classList.add('is-resizing-split')
 }}
 />
 {terminalLoadMsg ? (
 <div className="stage-loading-overlay" role="status" aria-live="polite">
 <LoadingCard title={terminalLoadMsg} compact />
 </div>
 ) : null}
 </>
 )}
 </main>

 <footer className="statusbar">
 <div className="hint" title="Hold Ctrl, then press a letter">
 <span title="Ctrl+T - new agent">
 <kbd>Ctrl+T</kbd> new agent
 </span>
 <span title="Ctrl+O - open project">
 <kbd>Ctrl+O</kbd> project
 </span>
 <span title="Ctrl+W - close tab">
 <kbd>Ctrl+W</kbd> close
 </span>
 <span title="Ctrl+S - settings">
 <kbd>Ctrl+S</kbd> settings
 </span>
 <span title="Ctrl+D vertical · Ctrl+X horizontal">
 <kbd>Ctrl+D</kbd> v-split · <kbd>Ctrl+X</kbd> h-split
 </span>
 <span title="Ctrl+Arrow - move focus between panes (or tabs)">
 <kbd>Ctrl+←↑↓→</kbd> panes
 </span>
 </div>
 <div className="status-text">{status || 'Ready'}</div>
 </footer>

 {/* Agent palette */}
 {paletteOpen && (
 <div
 className="palette-backdrop"
 onClick={() => setPaletteOpen(false)}
 onKeyDown={(e) => {
 if (e.key === 'Escape') setPaletteOpen(false)
 }}
 >
 <div className="palette" onClick={(e) => e.stopPropagation()}>
 <input
 className="palette-search"
 autoFocus
 placeholder="Type to filter agents... (or click one below)"
 value={paletteQuery}
 onChange={(e) => {
 setPaletteQuery(e.target.value)
 setPaletteIndex(0)
 }}
 onKeyDown={(e) => {
 if (e.key === 'Escape') {
 setPaletteOpen(false)
 return
 }
 if (e.key === 'ArrowDown') {
 e.preventDefault()
 setPaletteIndex((i) => Math.min(i + 1, filteredAgents.length - 1))
 }
 if (e.key === 'ArrowUp') {
 e.preventDefault()
 setPaletteIndex((i) => Math.max(i - 1, 0))
 }
 if (e.key === 'Enter') {
 e.preventDefault()
 const a = filteredAgents[paletteIndex]
 if (a) paletteSelect(a)
 }
 }}
 />
 <div className="palette-list">
 {filteredAgents.map((a, i) => {
 const probe = agentProbes[a.id]
 const missing = probe ? !probe.available && a.id !== 'shell' : false
 return (
 <div
 key={a.id}
 className={`palette-item-row ${i === paletteIndex ? 'active' : ''} ${missing ? 'missing' : ''}`}
 onMouseEnter={() => setPaletteIndex(i)}
 >
 <button
 type="button"
 className="palette-item"
 disabled={missing}
 title={
 missing
 ? `${a.name} CLI not found. Install first.`
 : probe?.resolvedCommand || a.command
 }
 onClick={() => {
 if (missing) return
 void launchAgent(a.id)
 }}
 >
 <AgentIcon
 agentId={a.id}
 size={16}
 color={missing ? '#555' : a.color}
 />
 <span className="name">{a.name}</span>
 <span className="sub">
 {missing ? 'not installed' : a.command}
 </span>
 </button>
 {missing && (
 <button
 type="button"
 className="palette-install"
 title={probe?.installCommand || a.installCommand || 'Install CLI'}
 onClick={(e) => {
 e.stopPropagation()
 void installAgentCli(a.id)
 }}
 >
 Install
 </button>
 )}
 </div>
 )
 })}
 {filteredAgents.length === 0 && (
 <div className="palette-item muted">No agents match</div>
 )}
 </div>
 <div className="palette-footer">
 Only real CLIs · missing tools show Install · Esc closes
 </div>
 </div>
 </div>
 )}

 {onOpenProject && (
 <OnOpenModal
 project={onOpenProject}
 onClose={() => setOnOpenProject(null)}
 onSaved={(p) => {
 void refreshProjects()
 setStatus(`On-open saved · ${p.name}`)
 }}
 />
 )}

 <SettingsMenu
 open={settingsOpen}
 onClose={() => setSettingsOpen(false)}
 version={version}
 activeProject={activeProject}
 updateInfo={updateInfo}
 checkingUpdate={checkingUpdate}
 onCheckUpdate={() => {
 void (async () => {
 setCheckingUpdate(true)
 try {
 const u = await window.truedeck.checkUpdates(true)
 setUpdateInfo({
 updateAvailable: u.updateAvailable,
 latestVersion: u.latestVersion,
 releaseUrl: u.releaseUrl,
 downloadUrl: u.downloadUrl,
 currentVersion: u.currentVersion
 })
 if (u.updateAvailable && u.latestVersion) {
 setStatus(`Update available: v${u.latestVersion}`)
 } else if (u.error) {
 setStatus(`Update check failed: ${u.error}`)
 } else {
 setStatus(`You're on the latest (v${u.currentVersion})`)
 }
 } finally {
 setCheckingUpdate(false)
 }
 })()
 }}
 onOpenUpdate={() => {
 const url =
 updateInfo?.downloadUrl ||
 updateInfo?.releaseUrl ||
 'https://github.com/WutIsHummus/TrueDeck/releases/latest'
 void window.truedeck.openExternal(url)
 }}
 onSettingsChange={applySettings}
 onOpenOnOpen={() => {
 if (activeProject) {
 setSettingsOpen(false)
 setOnOpenProject(activeProject)
 }
 }}
 onResetAgents={() => {
 void window.truedeck.resetAgents().then(() => refreshAgents())
 }}
 onStatus={setStatus}
 onReplayOnboarding={() => {
 setSettingsOpen(false)
 setOnboardingOpen(true)
 }}
 />

 {importGitOpen && (
 <CloneRepoInput
 onClose={() => setImportGitOpen(false)}
 onStatus={setStatus}
 onCloned={(root) => {
 void (async () => {
 await refreshProjects()
 const list = await window.truedeck.listProjects()
 const p = list.find((x) => sameProjectRoot(x.root, root)) || list[0]
 if (p) await openProject(p)
 setStatus(`Opened ${p?.name || root}`)
 })()
 }}
 />
 )}

 <Onboarding
 open={onboardingOpen}
 projects={projects}
 hasActiveProject={Boolean(activeProject)}
 activeProjectRoot={activeProject?.root}
 preferredAgentId={preferredAgentId}
 shortPath={shortPath}
 onAddProject={async () => {
 await addProject()
 }}
 onOpenProject={async (p) => {
 await openProject(p)
 }}
 onLaunchAgent={async (id) => {
 await launchAgent(id)
 }}
 onSetPreferredAgent={async (id) => {
 setPreferredAgentId(id)
 const s = await window.truedeck.getSettings()
 const saved = await window.truedeck.setSettings({ ...s, preferredAgentId: id })
 applySettings(saved)
 }}
 onSetPalacePath={async (path) => {
 const s = await window.truedeck.setPalacePath(path)
 applySettings(s)
 }}
 onInjectMemory={async (agentId, projectRoot, palacePath, agentIds) => {
 const r = await window.truedeck.injectMemoryForAgent({
 agentId: agentIds?.length ? 'all' : agentId,
 agentIds,
 allSynced: !agentIds?.length && agentId === 'all',
 projectRoot,
 palacePath
 })
 return r.message
 }}
 onSetSyncedAgents={async (ids) => {
 const s = await window.truedeck.getSettings()
 const saved = await window.truedeck.setSettings({
 ...s,
 syncedAgentIds: ids
 })
 applySettings(saved)
 }}
 onComplete={(skipped) => {
 void window.truedeck.completeOnboarding(skipped)
 setOnboardingOpen(false)
 if (!skipped) setStatus('Ready')
 }}
 />
 </div>
 )
}
