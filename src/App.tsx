import {
 useCallback,
 useEffect,
 useMemo,
 useRef,
 useState,
 type MouseEvent as ReactMouseEvent
} from 'react'
import { flushSync } from 'react-dom'
import { useDeck } from './store'
import { OnOpenModal } from './components/OnOpenModal'
import { SettingsMenu } from './components/SettingsMenu'
import { Onboarding } from './components/Onboarding'
import { WindowControls } from './components/WindowControls'
import { ProjectMenu } from './components/ProjectMenu'
import { CloneRepoInput } from './components/CloneRepoInput'
import { PaneWorkspace, type SplitAnim } from './components/PaneWorkspace'
import { ProjectExplorer } from './components/ProjectExplorer'
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
 findSessionSplitExit,
 reorderInGroup,
 setPrimaryRatio,
 setSplitRatio,
 syncSessions,
 normalizeLayout,
 serializePaneTree,
 deserializePaneTree,
 filterLayoutToSessionIds,
 allSessionIds,
 collapseLeavesWithoutExpanded,
 layoutHasExpandedSession,
 type DropEdge,
 type DropTarget,
 type NavDir,
 type PaneLayout
} from './lib/pane-layout'
import type {
 AgentPreset,
 AgentProbe,
 AppSettings,
 ProjectConfig,
 ProjectSetupStatus,
 SessionInfo
} from '../electron/shared/types'
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
 /** Expand “Add your own CLI” form in the agent palette */
 const [customCliOpen, setCustomCliOpen] = useState(false)
 const [paletteMenuOpen, setPaletteMenuOpen] = useState(false)
 const [customCliName, setCustomCliName] = useState('')
 const [customCliCmd, setCustomCliCmd] = useState('')
 const [customCliArgs, setCustomCliArgs] = useState('')
 const [customCliBusy, setCustomCliBusy] = useState(false)
 const [installAllBusy, setInstallAllBusy] = useState(false)
 const paletteMenuRef = useRef<HTMLDivElement | null>(null)
 /** Always take keyboard from xterm when opening a new-agent tab */
 const paletteSearchRef = useRef<HTMLInputElement | null>(null)
 const paletteFocusTimerRef = useRef(0)
 /** Live palette state for capture-phase key re-route (effect deps only open). */
 const paletteLiveRef = useRef({
 filtered: [] as AgentPreset[],
 index: 0,
 select: (_a: AgentPreset) => {}
 })
 const [agentProbes, setAgentProbes] = useState<Record<string, AgentProbe>>({})
 const [onOpenProject, setOnOpenProject] = useState<ProjectConfig | null>(null)
 const [settingsOpen, setSettingsOpen] = useState(false)
 const [paneLayout, setPaneLayout] = useState<PaneLayout>(() => createLayout())
 const [version, setVersion] = useState('')
 const [fontSize, setFontSize] = useState(13)
 /** Live font size for Ctrl+/- zoom (shortcut handler must not read stale state). */
 const fontSizeRef = useRef(13)
 fontSizeRef.current = fontSize
 /** Settings → MCP: click paths in CLI output → Document tab */
 const [openCliPathsInDocument, setOpenCliPathsInDocument] = useState(true)
 /** Monaco Document editor Vim mode */
 const [editorVimMode, setEditorVimMode] = useState(false)
 /** VS Code-style project file tree */
 const [explorerOpen, setExplorerOpen] = useState(true)
 const [explorerWidth, setExplorerWidth] = useState(240)
 const explorerDragRef = useRef<{ startX: number; startW: number } | null>(null)
 /** Slide animation after Ctrl+D / Ctrl+X / dock drop */
 const [splitAnim, setSplitAnim] = useState<SplitAnim | null>(null)
 /** Reverse slide when closing a sole pane half (exits the way it entered). */
 const [closeSplitAnim, setCloseSplitAnim] = useState<SplitAnim | null>(null)
 const splitAnimClearRef = useRef(0)
 /** sessionId → edge it last entered a split from (for reverse close). */
 const sessionEnterEdgeRef = useRef<Map<string, SplitAnim['edge']>>(new Map())
 /** Layout snapshots before dock/split/unsplit — Ctrl+Z restores last. */
 const layoutUndoStackRef = useRef<PaneLayout[]>([])
 const pushLayoutUndo = useCallback((layout: PaneLayout) => {
  try {
   const snap = structuredClone(normalizeLayout(layout)) as PaneLayout
   const stack = layoutUndoStackRef.current
   stack.push(snap)
   if (stack.length > 40) stack.splice(0, stack.length - 40)
  } catch {
   /* ignore */
  }
 }, [])
 const triggerSplitAnimRef = useRef<
 (sessionId: string, edge: SplitAnim['edge']) => void
 >(() => {})

 /**
 * Split open/close motion is CSS transform only — never live-animate the grid
 * ratio. Continuous ratio changes resize both hosts every frame; agent TUIs
 * (Grok) reflow cols/rows and look jagged. Freeze char grid → slide → one WINCH.
 */
 const markPaneAnimating = useCallback((on: boolean) => {
  try {
   document.body.classList.toggle('is-pane-animating', on)
  } catch {
   /* ignore */
  }
 }, [])

 const triggerSplitAnim = useCallback(
 (sessionId: string, edge: SplitAnim['edge']) => {
  sessionEnterEdgeRef.current.set(sessionId, edge)
  const token = Date.now()
  const dur = 400
  // Final 50/50 immediately; cell-enter-* CSS does the slide
  markPaneAnimating(true)
  setSplitAnim({ sessionId, edge, token, ratio: 0.5 })
  window.clearTimeout(splitAnimClearRef.current)
  splitAnimClearRef.current = window.setTimeout(() => {
   setSplitAnim((cur) => (cur?.token === token ? null : cur))
   markPaneAnimating(false)
   // Single clean fit after motion — not per-frame during it
   window.dispatchEvent(new CustomEvent('truedeck:pane-anim-end'))
  }, dur)
 },
 [markPaneAnimating]
 )
 triggerSplitAnimRef.current = triggerSplitAnim

 /** Reverse of enter: CSS slides the half out; ratio stays put until remove. */
 const playCloseSplitAnim = useCallback(
 (
  sessionId: string,
  edge: SplitAnim['edge'],
  startRatio: number,
  _exitSide: 'first' | 'second'
 ) => {
  const token = Date.now()
  const from = Math.max(0.08, Math.min(0.92, startRatio))
  const dur = 380
  markPaneAnimating(true)
  setCloseSplitAnim({ sessionId, edge, token, ratio: from })
  return new Promise<void>((resolve) => {
   window.setTimeout(() => {
    setCloseSplitAnim((cur) => (cur?.token === token ? null : cur))
    markPaneAnimating(false)
    resolve()
   }, dur)
  })
 },
 [markPaneAnimating]
 )
 /** Sessions currently shown in detached windows (excluded from main layout). */
 const [detachedIds, setDetachedIds] = useState<Set<string>>(() => new Set())
 const detachedIdsRef = useRef(detachedIds)
 detachedIdsRef.current = detachedIds
 /**
 * Pop-out pane window identity.
 * Prefer preload argv (`--td-detached=`) over URL query — file:// query is flaky.
 */
 const [detachedBoot, setDetachedBoot] = useState(() => {
 try {
  if (typeof window.truedeck?.getDetachedBoot === 'function') {
   return window.truedeck.getDetachedBoot()
  }
 } catch {
  /* ignore */
 }
 try {
  const q = new URLSearchParams(window.location.search)
  const session = (q.get('session') || '').trim()
  if (q.get('detached') === '1' && session) {
   return { detached: true, sessionId: session as string | null }
  }
 } catch {
  /* ignore */
 }
 return { detached: false, sessionId: null as string | null }
 })
 const isDetachedWindow = detachedBoot.detached
 const detachedSessionId = detachedBoot.sessionId

 // Late boot message from main if argv/query was missed
 useEffect(() => {
  if (typeof window.truedeck?.onDetachedBoot !== 'function') return
  return window.truedeck.onDetachedBoot(({ sessionId }) => {
   if (!sessionId) return
   setDetachedBoot({ detached: true, sessionId })
  })
 }, [])
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
 /** Title-bar project setup chip (memory / MCP / inject). */
 const [projectSetup, setProjectSetup] = useState<ProjectSetupStatus | null>(null)
 const [projectSetupBusy, setProjectSetupBusy] = useState(false)
 const setupInFlightRef = useRef<string | null>(null)
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
 const title =
 s.title && s.title.trim().toLowerCase() !== (s.agentName || '').toLowerCase()
 ? s.title.trim()
 : undefined
 return {
 agentId: s.agentId,
 agentName: s.agentName,
 projectRoot: s.projectRoot,
 color: s.color,
 kind: (s.kind === 'document' || s.documentPath
 ? 'document'
 : s.kind === 'command' || s.commandLine
 ? 'command'
 : 'agent') as 'agent' | 'command' | 'document',
 commandLine: s.commandLine,
 ...(s.documentPath ? { documentPath: s.documentPath } : {}),
 ...(title ? { title } : {}),
 ...(s.resumeToken ? { resumeToken: s.resumeToken } : {})
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

 const openAgentIdsForProject = useCallback((projectRoot: string): string[] => {
 const ids = new Set<string>()
 for (const s of useDeck.getState().sessions) {
 if (s.status !== 'running') continue
 if (!sameProjectRoot(s.projectRoot, projectRoot)) continue
 if (s.kind === 'document' || s.kind === 'command') continue
 if (!s.agentId || s.agentId === 'shell' || s.agentId === 'document') continue
 ids.add(s.agentId)
 }
 return Array.from(ids)
 }, [])

 const refreshProjectSetup = useCallback(
 async (projectRoot?: string | null) => {
 const root =
 projectRoot ||
 useDeck.getState().projects.find((p) => p.id === useDeck.getState().activeProjectId)
 ?.root
 if (!root) {
 setProjectSetup(null)
 return null
 }
 try {
 const openAgentIds = openAgentIdsForProject(root)
 const st = await window.truedeck.projectSetupStatus(root, openAgentIds)
 setProjectSetup(st)
 return st
 } catch {
 setProjectSetup(null)
 return null
 }
 },
 [openAgentIdsForProject]
 )

 /**
  * Automatic backend context for a project (memory + MCP + inject).
  * Silent by default — no memory dashboards or setup wizards.
  */
 const runProjectSetup = useCallback(
 async (projectRoot: string, opts?: { silent?: boolean }) => {
 if (!projectRoot) return
 if (setupInFlightRef.current === projectRoot) return
 setupInFlightRef.current = projectRoot
 const silent = opts?.silent !== false
 setProjectSetupBusy(true)
 if (!silent) setStatus('Preparing project context…')
 const uiTimer = window.setTimeout(() => {
 if (setupInFlightRef.current === projectRoot) {
 setupInFlightRef.current = null
 setProjectSetupBusy(false)
 void refreshProjectSetup(projectRoot)
 }
 }, 20000)
 try {
 const openAgentIds = openAgentIdsForProject(projectRoot)
 const pre = await window.truedeck.projectSetupStatus(projectRoot, openAgentIds)
 if (pre.ready) {
 setProjectSetup(pre)
 return
 }
 const res = await window.truedeck.setupProject({ projectRoot, openAgentIds })
 const st =
 (await window.truedeck.projectSetupStatus(projectRoot, openAgentIds)) || res.status
 setProjectSetup(st)
 if (!silent && st.ready) {
 setStatus(
 st.warming ? 'Context ready · memory warming in background' : 'Context ready'
 )
 }
 } catch (e) {
 if (!silent) setStatus(e instanceof Error ? e.message : String(e))
 await refreshProjectSetup(projectRoot)
 } finally {
 window.clearTimeout(uiTimer)
 if (setupInFlightRef.current === projectRoot) {
 setupInFlightRef.current = null
 }
 setProjectSetupBusy(false)
 }
 },
 [openAgentIdsForProject, refreshProjectSetup, setStatus]
 )

 // Open folder → automatic memory/MCP/context (silent). Re-run when open agents change.
 const projectOpenAgentsKey = useMemo(() => {
 if (!activeProject?.root) return ''
 return openAgentIdsForProject(activeProject.root).slice().sort().join(',')
 }, [activeProject?.root, sessions, openAgentIdsForProject])

 useEffect(() => {
 if (!activeProject?.root) {
 setProjectSetup(null)
 return
 }
 let cancelled = false
 let pollTimer: number | undefined
 const tick = async (allowSetup: boolean) => {
 try {
 const openAgentIds = openAgentIdsForProject(activeProject.root)
 const st = await window.truedeck.projectSetupStatus(activeProject.root, openAgentIds)
 if (cancelled) return
 setProjectSetup(st)
 // Only run heavy setup when not ready — never on every new agent tab
 if (allowSetup && !st.ready) {
 await runProjectSetup(activeProject.root, { silent: true })
 } else if (
 allowSetup &&
 st.ready &&
 st.pendingOpenAgents &&
 st.pendingOpenAgents.length > 0
 ) {
 // Light stamp refresh for new CLI ids only
 await runProjectSetup(activeProject.root, { silent: true })
 }
 // While memory is still indexing, re-poll so the chip clears when stamp lands
 if (st.ready && st.warming && !cancelled) {
 pollTimer = window.setTimeout(() => {
 void tick(false)
 }, 8000)
 }
 } catch {
 if (!cancelled) setProjectSetup(null)
 }
 }
 void tick(true)
 return () => {
 cancelled = true
 if (pollTimer) window.clearTimeout(pollTimer)
 }
 }, [activeProject?.root, projectOpenAgentsKey, openAgentIdsForProject, runProjectSetup])

 const projectSessions = useMemo(
 () =>
 sessions.filter((s) =>
 activeProject ? sameProjectRoot(s.projectRoot, activeProject.root) : true
 ),
 [sessions, activeProject]
 )

 const filteredAgents = useMemo(() => {
 const q = paletteQuery.trim().toLowerCase()
 // Only show installed CLIs in the list (shell always available).
 // Missing ones are installable from the ☰ menu — not cluttering the launcher.
 const installed = agents.filter((a) => {
 if (a.id === 'shell') return true
 const p = agentProbes[a.id]
 // Before probe results land, keep the row (avoid empty flash); after probe, require available
 if (!p) return true
 return p.available
 })
 // Built-ins keep DEFAULT order (Kiro high); customs last
 const sorted = [...installed].sort((a, b) => {
 const ac = a.custom || a.id.startsWith('custom-') ? 1 : 0
 const bc = b.custom || b.id.startsWith('custom-') ? 1 : 0
 if (ac !== bc) return ac - bc
 return 0
 })
 if (!q) return sorted
 return sorted.filter(
 (a) =>
 a.name.toLowerCase().includes(q) ||
 a.id.toLowerCase().includes(q) ||
 a.command.toLowerCase().includes(q) ||
 (a.description || '').toLowerCase().includes(q)
 )
 }, [agents, paletteQuery, agentProbes])

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
 // Detached windows own those sessions — keep them out of the main tree
 const detached = detachedIdsRef.current
 const ids = sessions.map((s) => s.id).filter((id) => !detached.has(id))
 const prefer = useDeck.getState().activeSessionId
 // Expanded = still showing content (not minimized)
 const expanded = new Set(
 sessions
 .filter(
 (s) =>
 s.status === 'running' &&
 !s.uiMinimized &&
 !s.uiHidden &&
 !detached.has(s.id)
 )
 .map((s) => s.id)
 )
 setPaneLayout((prev) => {
 const base = prev?.root ? prev : normalizeLayout(prev)
 // Membership + collapse empty minimized-only leaves so restore gets stage space
 let next = syncSessions(base, ids, prefer)
 next = collapseLeavesWithoutExpanded(next, expanded)
 // If active tab is expanded, keep layout focus on it (un-minimize path)
 if (prefer && expanded.has(prefer) && findGroup(next, prefer)) {
 next = layoutFocusSession(next, prefer)
 }
 return next
 })
 // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: not activeSessionId
 }, [sessionHydrated, sessions, detachedIds])

 const expandedSessionIds = useMemo(
 () =>
 new Set(
 projectSessions
 .filter(
 (s) =>
 s.status === 'running' &&
 !s.uiMinimized &&
 !s.uiHidden &&
 !detachedIds.has(s.id)
 )
 .map((s) => s.id)
 ),
 [projectSessions, detachedIds]
 )

 const minimizedSessions = useMemo(
 () =>
 projectSessions.filter(
 (s) =>
 s.status === 'running' &&
 (s.uiMinimized || s.uiHidden) &&
 !detachedIds.has(s.id)
 ),
 [projectSessions, detachedIds]
 )

 /**
 * Pop the focused (or given) session into its own OS window.
 * Removes it from the main deck layout until the pop-out closes.
 * Optimistic: hide from main deck *before* await so the tab can't stick around.
 */
 const detachSessionToWindow = useCallback(
 async (
 sessionId: string,
 opts?: { x?: number; y?: number; skipRemove?: boolean }
 ) => {
 if (!sessionId || isDetachedWindow) return
 if (detachedIdsRef.current.has(sessionId)) {
  // Already popped — just focus existing window
  try {
   await window.truedeck.openDetachedPane({
    sessionId,
    title: useDeck.getState().sessions.find((x) => x.id === sessionId)?.title,
    x: opts?.x,
    y: opts?.y
   })
  } catch {
   /* ignore */
  }
  return
 }
 const s = useDeck.getState().sessions.find((x) => x.id === sessionId)
 if (!s) {
 setStatus('No tab to pop out')
 return
 }
 if (typeof window.truedeck.openDetachedPane !== 'function') {
 setStatus('Pop-out windows unavailable')
 return
 }
 // Hide from main deck immediately (before IPC / window create)
 setDetachedIds((prev) => {
  const next = new Set(prev)
  next.add(sessionId)
  return next
 })
 if (!opts?.skipRemove) {
  setPaneLayout((prev) => {
   const next = removeSessionFromLayout(prev, sessionId)
   persistLayoutSnapshot(next)
   return next
  })
  // Move focus to a remaining tab so chrome doesn't go blank
  const remaining = useDeck
   .getState()
   .sessions.filter((x) => x.id !== sessionId && x.status === 'running')
  if (useDeck.getState().activeSessionId === sessionId) {
   setActiveSession(remaining[remaining.length - 1]?.id || null)
  }
 }
 try {
  await window.truedeck.openDetachedPane({
   sessionId,
   title: s.title || s.agentName || 'TrueDeck',
   x: opts?.x,
   y: opts?.y
  })
  setStatus(`Popped out ${s.agentName || s.title || 'tab'}`)
 } catch (e) {
  // Roll back hide so the tab returns on failure
  setDetachedIds((prev) => {
   const next = new Set(prev)
   next.delete(sessionId)
   return next
  })
  setStatus(e instanceof Error ? e.message : String(e))
 }
 },
 [isDetachedWindow, persistLayoutSnapshot, setStatus, setActiveSession]
 )

 // Re-dock when a pop-out window closes
 useEffect(() => {
 if (isDetachedWindow) return
 if (typeof window.truedeck.onDetachedClosed !== 'function') return
 return window.truedeck.onDetachedClosed(({ sessionId }) => {
 if (!sessionId) return
 setDetachedIds((prev) => {
 if (!prev.has(sessionId)) return prev
 const next = new Set(prev)
 next.delete(sessionId)
 return next
 })
 // Session re-enters layout via syncSessions effect
 setStatus('Pane returned to deck')
 })
 }, [isDetachedWindow, setStatus])

 // Detached window: focus its session and set title
 useEffect(() => {
 if (!isDetachedWindow || !detachedSessionId) return
 setActiveSession(detachedSessionId)
 const s = useDeck.getState().sessions.find((x) => x.id === detachedSessionId)
 const label = s?.title || s?.agentName || 'TrueDeck'
 void window.truedeck.setWindowTitle(label)
 }, [isDetachedWindow, detachedSessionId, sessions, setActiveSession])

 /** Per-project view: collapse minimized-only leaves so they take no stage space. */
 const displayLayout = useMemo(() => {
 let view = paneLayout
 if (activeProject) {
 const keep = new Set(
 projectSessions.filter((s) => !detachedIds.has(s.id)).map((s) => s.id)
 )
 const all = allSessionIds(paneLayout)
 if (!(all.length === keep.size && all.every((id) => keep.has(id)))) {
 view = filterLayoutToSessionIds(paneLayout, keep)
 }
 }
 view = collapseLeavesWithoutExpanded(view, expandedSessionIds)
 return view
 }, [paneLayout, projectSessions, activeProject, expandedSessionIds, detachedIds])

 /** Layout actually painted (detached windows show only their session). */
 const stageLayout = useMemo(() => {
 if (isDetachedWindow && detachedSessionId) {
 return createLayout([detachedSessionId], detachedSessionId)
 }
 return displayLayout
 }, [isDetachedWindow, detachedSessionId, displayLayout])

 const stageSessions = useMemo(() => {
 if (isDetachedWindow && detachedSessionId) {
 return sessions.filter((s) => s.id === detachedSessionId)
 }
 return projectSessions.filter((s) => !detachedIds.has(s.id))
 }, [isDetachedWindow, detachedSessionId, sessions, projectSessions, detachedIds])

 const stageHasExpanded = useMemo(
 () => layoutHasExpandedSession(stageLayout, expandedSessionIds),
 [stageLayout, expandedSessionIds]
 )

 const focusTab = useCallback(
 (id: string) => {
 setPaneLayout((prev) => layoutFocusSession(prev, id))
 setActiveSession(id)
 },
 [setActiveSession]
 )

 /**
 * Restore a minimized tab. Must clear uiMinimized, focus layout, and force
 * the session into the tree - a separate onSelect alone raced an effect that
 * bounced focus away while the flag still looked minimized.
 */
 const restoreMinimizedSession = useCallback(
 (id: string) => {
 if (!id) return
 const victim = useDeck.getState().sessions.find((s) => s.id === id)
 if (!victim) {
 setStatus('Cannot restore - session gone')
 return
 }
 // Switch workspace if the tab lives in another project
 if (victim.projectRoot) {
 const proj = useDeck
 .getState()
 .projects.find((p) => sameProjectRoot(p.root, victim.projectRoot))
 if (proj) setActiveProject(proj.id)
 }

 // Flush store before layout so membership/expanded effects see expanded flags
 flushSync(() => {
 useDeck.getState().patchSession(id, { uiMinimized: false, uiHidden: false })
 useDeck.getState().setActiveSession(id)
 })

 const all = useDeck.getState().sessions
 const ids = all.map((s) => s.id)
 const expanded = new Set(
 all
 .filter((s) => s.status === 'running' && !s.uiMinimized && !s.uiHidden)
 .map((s) => s.id)
 )
 if (!expanded.has(id)) expanded.add(id)

 setPaneLayout((prev) => {
 let next = normalizeLayout(prev)
 // Put every live id into the tree (orphans land on focused leaf)
 next = syncSessions(next, ids, id)
 // Drop empty minimized-only leaves so the restored tab gets stage space
 next = collapseLeavesWithoutExpanded(next, expanded)
 // Force active + focus even if findGroup failed once
 next = layoutFocusSession(next, id)
 // If still missing (tree filtered), rebuild a simple layout with this tab
 if (!findGroup(next, id)) {
 next = createLayout(ids, id)
 next = layoutFocusSession(next, id)
 }
 return next
 })

 const label = victim.agentName || victim.title || 'tab'
 setStatus(`Restored ${label}`)
 },
 [setActiveSession, setActiveProject, setStatus]
 )

 /** In-flight closes - never cascade kill more than one id per click/shortcut. */
 const closingIdsRef = useRef<Set<string>>(new Set())
 /** Tabs playing exit animation before remove (Ctrl+W / X). */
 const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set())

 const closeSession = useCallback(
 async (id: string) => {
 if (!id || typeof id !== 'string') return
 if (closingIdsRef.current.has(id)) return
 closingIdsRef.current.add(id)

 flushSync(() => {
  setClosingTabIds((prev) => {
   const next = new Set(prev)
   next.add(id)
   return next
  })
 })

 // If this tab is alone in one half of a split, reverse-slide it out
 // the edge it came from (Ctrl+D right → exit right, Ctrl+X bottom → exit bottom).
 const remembered = sessionEnterEdgeRef.current.get(id) || null
 const exitInfo = findSessionSplitExit(paneLayoutRef.current, id, remembered)
 if (exitInfo) {
  try {
   document
    .querySelectorAll(`[data-session-id="${CSS.escape(id)}"]`)
    .forEach((el) => el.classList.add('closing'))
  } catch {
   /* ignore */
  }
  await playCloseSplitAnim(id, exitInfo.edge, exitInfo.ratio, exitInfo.exitSide)
 } else {
  // Tab among siblings in same pane — chip slides down (tab-exit), short wait
  try {
   document
    .querySelectorAll(`[data-session-id="${CSS.escape(id)}"]`)
    .forEach((el) => {
     el.classList.add('closing')
     el.closest('.pane-group')?.classList.add('pane-closing')
    })
  } catch {
   /* ignore */
  }
  await new Promise<void>((r) =>
   window.requestAnimationFrame(() => window.requestAnimationFrame(() => r()))
  )
  await new Promise<void>((r) => window.setTimeout(r, 220))
 }

 try {
  const victim = useDeck.getState().sessions.find((s) => s.id === id)
  sessionEnterEdgeRef.current.delete(id)
  removeSession(id)
  setPaneLayout((prev) => {
   const next = removeSessionFromLayout(prev, id)
   persistLayoutSnapshot(next)
   return next
  })
  setDetachedIds((prev) => {
   if (!prev.has(id)) return prev
   const next = new Set(prev)
   next.delete(id)
   return next
  })
  setStatus('Tab closed')
  if (victim?.kind === 'document' || victim?.documentPath) return
  try {
   await window.truedeck.killSession(id)
  } catch {
   /* ignore */
  }
 } finally {
  closingIdsRef.current.delete(id)
  setClosingTabIds((prev) => {
   if (!prev.has(id)) return prev
   const next = new Set(prev)
   next.delete(id)
   return next
  })
  setCloseSplitAnim(null)
 }
 },
 [removeSession, setStatus, persistLayoutSnapshot, playCloseSplitAnim]
 )

 /** Close every session in a pane group (kill agents — do not relocate). */
 const closeGroupSessions = useCallback(
 async (groupId: string) => {
  const g = listGroups(paneLayoutRef.current).find((x) => x.id === groupId)
  if (!g?.sessionIds?.length) {
   // Empty pane leaf — just collapse layout
   setPaneLayout((prev) => {
    const next = closeGroup(prev, groupId)
    persistLayoutSnapshot(next)
    return next
   })
   setStatus('Pane closed')
   return
  }
  const ids = [...g.sessionIds]
  for (const id of ids) {
   void closeSession(id)
  }
  setStatus(ids.length > 1 ? `Closing ${ids.length} tabs…` : 'Tab closed')
 },
 [closeSession, persistLayoutSnapshot]
 )

 /** Open a readable document tab (markdown / plans / source). */
 /**
 * Open a file in a Document tab.
 * - Pass a string path → open that file (never shows OS file picker).
 * - Pass nothing / call with `{ pick: true }` → OS file picker (Ctrl+Shift+O).
 * Guard: non-string args are ignored (avoids accidental picker from click events).
 */
 const openDocumentTab = useCallback(
 async (
 filePath?: string | null,
 opts?: { pick?: boolean }
 ) => {
 const project =
 useDeck.getState().projects.find((p) => p.id === useDeck.getState().activeProjectId) ||
 activeProject

 // Never coerce MouseEvent / other junk into a path
 if (filePath != null && typeof filePath !== 'string') {
 setStatus('Open file: invalid path')
 return
 }

 let path = (filePath || '').trim()

 // OS picker only when explicitly requested (or Ctrl+Shift+O with no path)
 if (!path) {
 if (!opts?.pick) {
 setStatus('No file path to open')
 return
 }
 path =
 (await window.truedeck.pickProjectFile({
 projectRoot: project?.root,
 title: 'Open file to read (plans, markdown, code)'
 })) || ''
 }
 if (!path) return

 // HTTP(S) from CLI / MCP — open in OS browser, not Document tab
 if (/^https?:\/\//i.test(path)) {
 try {
 await window.truedeck.openPathInOs(path)
 setStatus(`Opened ${path}`)
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 }
 return
 }

 // Normalize + verify local file exists (CLI may print relative paths)
 path = path.replace(/^['"`]+|['"`]+$/g, '').replace(/\//g, '\\')
 try {
 const exists = async (p: string) =>
 typeof window.truedeck.pathExists === 'function'
 ? await window.truedeck.pathExists(p)
 : true
 let ok = await exists(path)
 if (!ok && project?.root) {
 const root = project.root.replace(/[\\/]+$/, '')
 const rel = path.replace(/^\.\\/, '').replace(/^\\+/, '')
 const candidates = [
 `${root}\\${rel}`,
 rel.includes('\\') ? `${root}\\${rel.split('\\').slice(1).join('\\')}` : ''
 ].filter(Boolean)
 for (const c of candidates) {
 if (c === path) continue
 if (await exists(c)) {
 path = c
 ok = true
 break
 }
 }
 }
 if (!ok) {
 setStatus(`File not found: ${path}`)
 return
 }
 } catch {
 /* open optimistically if exists check fails */
 }

 // Focus existing tab for the same file
 const existing = useDeck
 .getState()
 .sessions.find(
 (s) =>
 (s.kind === 'document' || s.documentPath) &&
 (s.documentPath || '').toLowerCase() === path.toLowerCase()
 )
 if (existing) {
 focusTab(existing.id)
 setStatus(`Already open: ${existing.title || path}`)
 return
 }

 const name = path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'File'
 const root = project?.root || path.replace(/[\\/][^\\/]+$/, '') || path
 const info: SessionInfo = {
 id: `doc-${crypto.randomUUID()}`,
 agentId: 'document',
 agentName: 'Doc',
 color: '#a78bfa',
 projectRoot: root,
 status: 'running',
 createdAt: Date.now(),
 title: name,
 kind: 'document',
 documentPath: path
 }
 addSession(info, { focus: true })
 setPaneLayout((prev) => {
 const base = normalizeLayout(prev)
 const idSet = new Set(allSessionIds(base))
 idSet.add(info.id)
 for (const s of useDeck.getState().sessions) idSet.add(s.id)
 const liveIds = Array.from(idSet)
 const synced = syncSessions(base, liveIds, info.id)
 return layoutFocusSession(synced, info.id)
 })
 setStatus(`Opened ${name}`)
 },
 [activeProject, addSession, focusTab, setStatus]
 )

 const applyDrop = useCallback(
 (sessionId: string, edge: DropEdge, targetGroupId?: string): boolean => {
 if (!sessionId) {
 setStatus('Drop failed - try again')
 return false
 }
 let nextLayout: PaneLayout | null = null
 setPaneLayout((prev) => {
 pushLayoutUndo(prev)
 const next = placeSession(prev, sessionId, edge, targetGroupId)
 nextLayout = next
 const a = activeSessionOf(next)
 if (a) setActiveSession(a)
 return next
 })
 if (edge !== 'center') {
 triggerSplitAnim(sessionId, edge)
 }
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
 [setActiveSession, setStatus, persistLayoutSnapshot, triggerSplitAnim, pushLayoutUndo]
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
 // Drop outside the stage → pop out to a new window
 if (!overStage(e.clientX, e.clientY)) {
 const id =
 e.dataTransfer?.getData('application/x-truedeck-tab') ||
 e.dataTransfer?.getData('text/plain') ||
 getDraggingTabId() ||
 ''
 setDraggingTabId(null)
 setTabDragging(false)
 setDropTarget(null)
 if (id && !isDetachedWindow) {
 e.preventDefault()
 void detachSessionToWindow(id, { x: e.screenX, y: e.screenY })
 }
 return
 }
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

 const onDragEnd = (e: DragEvent) => {
 const id = getDraggingTabId()
 setTabDragging(false)
 setDropTarget(null)
 // If released outside the app window, pop out
 if (id && !isDetachedWindow && !overStage(e.clientX, e.clientY)) {
 void detachSessionToWindow(id, { x: e.screenX, y: e.screenY })
 }
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
 }, [tabDragging, applyDrop, detachSessionToWindow, isDetachedWindow])

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
 // One clean TUI fit after gutter drag (no per-frame WINCH during drag)
 window.dispatchEvent(new CustomEvent('truedeck:pane-anim-end'))
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
 setOpenCliPathsInDocument(s.openCliPathsInDocument !== false)
 setEditorVimMode(Boolean(s.editorVimMode))
 setExplorerOpen(s.showProjectExplorer !== false)
 try {
 const w = Number(localStorage.getItem('truedeck.explorerWidth') || '')
 if (w >= 160 && w <= 420) setExplorerWidth(w)
 } catch {
 /* ignore */
 }
 }, [])

 useEffect(() => {
 let cancelled = false
 // Avoid treating restore spawns as user-created (active jumps / double-save).
 let restoring = true

 const offSpawn = window.truedeck.onPtySpawned((info) => {
 if (restoring) return
 // Document tabs from MCP truedeck_show / restore: dedupe by path and focus
 if (info.kind === 'document' || info.documentPath) {
 const path = (info.documentPath || '').toLowerCase()
 if (path) {
 const existing = useDeck
 .getState()
 .sessions.find(
 (s) =>
 (s.kind === 'document' || s.documentPath) &&
 (s.documentPath || '').toLowerCase() === path
 )
 if (existing) {
 setPaneLayout((prev) => layoutFocusSession(normalizeLayout(prev), existing.id))
 setActiveSession(existing.id)
 setStatus(`Already open: ${existing.title || path}`)
 return
 }
 }
 addSession(info, { focus: true })
 setStatus(`Opened ${info.title || 'document'}`)
 return
 }
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
 // Parallel boot probes — sequential listProjects/agents/settings added ~100-300ms
 const [settingsSettled, versionSettled] = await Promise.all([
 window.truedeck.getSettings().catch(() => null),
 window.truedeck.version().catch(() => ''),
 refreshProjects(),
 refreshAgents()
 ])
 if (!cancelled && versionSettled) setVersion(versionSettled)

 let shouldRestore = true
 if (settingsSettled) {
 if (!cancelled) {
 applySettings(settingsSettled)
 if (settingsSettled.preferredAgentId) {
 setPreferredAgentId(settingsSettled.preferredAgentId)
 }
 }
 shouldRestore = settingsSettled.reopenLastProject !== false
 }

 // firstRun is rare — do not block restore on it
 void window.truedeck
 .firstRun()
 .then(async (result) => {
 if (result.firstRun && result.seeded.length) {
 if (!cancelled) {
 setStatus(`Ready · seeded ${result.seeded.map((p) => p.name).join(', ')}`)
 }
 await refreshProjects()
 }
 })
 .catch(() => {
 /* ignore */
 })

 // Detached pop-out: hydrate the one session from the backend, skip full restore
 if (isDetachedWindow && detachedSessionId && !cancelled) {
 try {
 setTerminalLoadMsg('Opening pane…')
 // Session may already be live; poll briefly if list is empty/racy
 let found = false
 for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
  const all = await window.truedeck.listSessions()
  for (const s of all) addSession(s)
  if (all.some((s) => s.id === detachedSessionId)) {
   found = true
   break
  }
  await new Promise((r) => window.setTimeout(r, 80 + attempt * 40))
 }
 setActiveSession(detachedSessionId)
 setPaneLayout(createLayout([detachedSessionId], detachedSessionId))
 setSessionHydrated(true)
 setTerminalLoadMsg('')
 setStatus(found ? 'Pop-out pane' : 'Pop-out pane (waiting for PTY…)')
 const s = useDeck.getState().sessions.find((x) => x.id === detachedSessionId)
 void window.truedeck.setWindowTitle(s?.title || s?.agentName || 'TrueDeck')
 return
 } catch (e) {
 if (!cancelled) {
 setStatus(e instanceof Error ? e.message : String(e))
 setSessionHydrated(true)
 }
 return
 }
 }

 // Restore open agent tabs from last run (respawn PTYs).
 // Hard timeout: never leave a black "Starting…" screen if backend stalls.
 if (shouldRestore && !cancelled) {
 try {
 if (!cancelled) {
 setTerminalLoadMsg('Restoring terminals…')
 setStatus('Restoring terminals…')
 }
 const restorePromise = window.truedeck.restoreSessions()
 const timeoutPromise = new Promise<never>((_, rej) => {
 window.setTimeout(() => rej(new Error('restore timeout')), 20000)
 })
 const { layout, sessions: restored, restored: count } = await Promise.race([
 restorePromise,
 timeoutPromise
 ])
 if (!cancelled && count > 0) {
 setTerminalLoadMsg(
 count === 1
 ? 'Connecting terminal…'
 : `Connecting ${count} terminals…`
 )
 for (const info of restored) addSession(info, { focus: false })
 const projects = await window.truedeck.listProjects()
 const root = layout.activeProjectRoot
 const findByRoot = (r: string | null | undefined): ProjectConfig | null =>
 r
 ? projects.find((p) => sameProjectRoot(p.root, r)) || null
 : null
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
 const active =
 (want &&
 (!proj || sameProjectRoot(want.projectRoot, proj.root)) &&
 want) ||
 inProj[inProj.length - 1] ||
 null
 if (active) setActiveSession(active.id)
 else setActiveSession(null)
 // Pane tree remap can throw on partial restore — never blank the app
 let pl: PaneLayout
 try {
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
 pl = syncSessions(pl, ids, active?.id || null)
 if (active?.id) pl = layoutFocusSession(pl, active.id)
 } catch (layoutErr) {
 console.warn('[truedeck] layout restore failed, using simple grid', layoutErr)
 pl = createLayout(ids, active?.id || null)
 }
 setPaneLayout(pl)
 setStatus(
 count === 1
 ? 'Restored 1 terminal session'
 : `Restored ${count} terminal sessions` +
 (layout.paneTree?.type === 'split' ? ' · multi-pane' : '')
 )
 } else if (!cancelled) {
 // No PTYs restored (stability mode) — still open last workspace
 const list = await window.truedeck.listProjects()
 const root = layout?.activeProjectRoot
 const proj =
 (root && list.find((p) => sameProjectRoot(p.root, root))) || list[0] || null
 if (proj) setActiveProject(proj.id)
 setStatus(proj ? `Opened ${proj.name} — launch an agent (Ctrl+T)` : 'Ready')
 }
 } catch (restoreErr) {
 console.warn('[truedeck] restore failed/timeout', restoreErr)
 try {
 const list = await window.truedeck.listProjects()
 if (!cancelled && list[0]) setActiveProject(list[0].id)
 if (!cancelled) setStatus('Started without restoring previous tabs')
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
 // setPaneLayout is useState and stable
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
 // Explicit tab metadata so disk does not depend only on ptyManager list order.
 // title / resumeToken let the next launch reattach the real conversation.
 const tabs = orderFinal.map((id) => {
 const s = running.find((x) => x.id === id)!
 const title =
 s.title && s.title.trim().toLowerCase() !== (s.agentName || '').toLowerCase()
 ? s.title.trim()
 : undefined
 return {
 agentId: s.agentId,
 agentName: s.agentName,
 projectRoot: s.projectRoot,
 color: s.color,
 kind: (s.kind === 'document' || s.documentPath
 ? 'document'
 : s.kind === 'command' || s.commandLine
 ? 'command'
 : 'agent') as 'agent' | 'command' | 'document',
 commandLine: s.commandLine,
 ...(s.documentPath ? { documentPath: s.documentPath } : {}),
 ...(title ? { title } : {}),
 ...(s.resumeToken ? { resumeToken: s.resumeToken } : {})
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
 * App shortcuts (single owner for these chords).
 * Primary path: main before-input-event → app:shortcut IPC (works under agent TUI focus).
 * Fallback: capture-phase DOM keydown (Escape, and if main path is missing).
 * Terminal owns Ctrl+C/V (copy/paste) in TerminalPane - not handled here.
 *
 * Ctrl+O project · Ctrl+W close · Ctrl+S settings · Ctrl+T new agent
 * Ctrl+Tab next · Ctrl+D split vertical · Ctrl+X horizontal · Ctrl+Z undo move
 * Ctrl+N pop pane to new window · Ctrl+Shift+N shell
 * Ctrl+1-9 jump · Ctrl+←/→/↑/↓ panes · Ctrl+=/+/- /0 font zoom
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
 * Per-key dedupe: main IPC + DOM keydown can both arrive for one physical key.
 * Map-based so Left/Right don't block each other.
 */
 const lastAt = new Map<string, number>()
 const once = (sig: string, ms = 50): boolean => {
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
 // Dedupe IPC+DOM double-fires. Held arrows need a gentler gate for repeat.
 if (!once(`arrow:${key}`, raw.repeat ? 90 : 40)) return

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

 // Ctrl+Z → undo last pane move (split / dock / unsplit)
 if (letter === 'z' && !raw.shift && !raw.alt) {
 if (!once('z')) return
 raw.claim?.()
 const prev = layoutUndoStackRef.current.pop()
 if (!prev) {
 setStatus('Nothing to undo')
 return
 }
 paneLayoutRef.current = prev
 setPaneLayout(prev)
 ctx.persistLayoutSnapshot(prev)
 setStatus('Undid pane move (Ctrl+Z)')
 window.dispatchEvent(new CustomEvent('truedeck:pane-anim-end'))
 return
 }

 // Ctrl+Alt+D / Ctrl+Alt+X → unsplit / merge all panes into one
 if ((letter === 'd' || letter === 'x') && raw.alt && !raw.shift) {
 if (!once('merge')) return
 raw.claim?.()
 if (countLeaves(ctx.paneLayout) < 2) {
 setStatus('Already one pane')
 return
 }
 let mergeNext: PaneLayout | null = null
 setPaneLayout((prev) => {
 pushLayoutUndo(prev)
 mergeNext = mergeAllGroups(prev)
 return mergeNext
 })
 if (mergeNext) ctx.persistLayoutSnapshot(mergeNext)
 setStatus('Unsplit · one pane (Ctrl+Alt+X)')
 window.dispatchEvent(new CustomEvent('truedeck:pane-anim-end'))
 return
 }

 // Ctrl+D → vertical split · Ctrl+X → horizontal split
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
 let splitOk = false
 const moveId = ctx.activeSessionId
 const edge: 'right' | 'bottom' = letter === 'x' ? 'bottom' : 'right'
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
 pushLayoutUndo(prev)
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
 splitOk = true
 return next
 })
 if (splitOk && splitNext && moveId) {
 ctx.persistLayoutSnapshot(splitNext)
 // Keep focus on the tab that moved into the new pane
 setActiveSession(moveId)
 // Same sliding divider as drag-dock (must run with layout update)
 triggerSplitAnimRef.current(moveId, edge)
 }
 return
 }

 // Ctrl+N → pop focused pane into a new window
 if (letter === 'n' && !raw.shift && !raw.alt) {
 if (!once('n')) return
 raw.claim?.()
 if (isDetachedWindow) {
 setStatus('Already a pop-out window')
 return
 }
 const id = ctx.activeSessionId
 if (!id) {
 setStatus('No tab to pop out')
 return
 }
 void detachSessionToWindow(id)
 return
 }
 // Ctrl+Shift+N → new shell (was Ctrl+N)
 if (letter === 'n' && raw.shift && !raw.alt) {
 if (!once('shift-n')) return
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

 // Ctrl+Shift+O → open readable file tab via OS picker
 if (e.shiftKey && (e.key === 'O' || e.key === 'o' || e.code === 'KeyO')) {
 e.preventDefault()
 e.stopPropagation()
 void openDocumentTab(null, { pick: true })
 return
 }
 // Ctrl+B → toggle project explorer (VS Code-style)
 if (!e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B' || e.code === 'KeyB')) {
 e.preventDefault()
 e.stopPropagation()
 setExplorerOpen((v) => {
 const next = !v
 void window.truedeck.getSettings().then(async (s) => {
 const saved = await window.truedeck.setSettings({
 ...s,
 showProjectExplorer: next
 })
 window.dispatchEvent(new CustomEvent('truedeck:settings', { detail: saved }))
 })
 return next
 })
 return
 }

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
 const inDocument = Boolean(
 t?.closest?.('.document-pane, .document-editor, .document-monaco, .monaco-editor')
 )
 // Document tabs own Ctrl+S (save). Don't open Settings over the editor.
 if (inDocument && letter === 's' && !e.shiftKey) return
 const typing =
 !inTerminal &&
 !inDocument &&
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
 // Automatic backend context (silent)
 void runProjectSetup(p.root, { silent: true })
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
 // Automatic memory/MCP/context after open (silent — no setup wizard)
 try {
 const openAgentIds = openAgentIdsForProject(p.root)
 const st = await window.truedeck.projectSetupStatus(p.root, openAgentIds)
 setProjectSetup(st)
 if (!st.ready) {
 await runProjectSetup(p.root, { silent: true })
 }
 setStatus(`${p.name}`)
 } catch {
 setStatus(`${p.name}`)
 }
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

 /**
 * Ctrl+T / new-agent palette must own the keyboard.
 * Critical: never re-select() after open — that replaces typed chars when
 * xterm re-steals focus and we reclaim (select + next key = overwrite).
 */
 useEffect(() => {
 if (!paletteOpen) {
 window.clearInterval(paletteFocusTimerRef.current)
 document.body.classList.remove('palette-owns-keyboard')
 return
 }

 document.body.classList.add('palette-owns-keyboard')
 let selectedOnce = false

 const inPaletteUi = (el: Element | null): boolean =>
 Boolean(el?.closest?.('.palette, .palette-backdrop'))

 const blurTerminals = (): void => {
 try {
 const active = document.activeElement as HTMLElement | null
 if (
 active?.classList?.contains('xterm-helper-textarea') ||
 active?.closest?.('.terminal-pane, .xterm')
 ) {
 active.blur()
 }
 document.querySelectorAll('textarea.xterm-helper-textarea').forEach((node) => {
 try {
 const ta = node as HTMLTextAreaElement
 ta.blur()
 ta.setAttribute('tabindex', '-1')
 // Hard block: disabled helper cannot steal keys from the filter
 ta.disabled = true
 } catch {
 /* ignore */
 }
 })
 } catch {
 /* ignore */
 }
 }

 /** Focus search only when needed. Select once on first successful open. */
 const focusSearch = (opts?: { forceSelect?: boolean }): boolean => {
 const el =
 paletteSearchRef.current ||
 (document.querySelector('.palette-search') as HTMLInputElement | null)
 if (!el) return false
 // Already typing in the filter (or another palette control) — leave alone
 if (document.activeElement === el) return true
 if (inPaletteUi(document.activeElement) && document.activeElement !== el) {
 // e.g. custom-CLI form field — don't yank focus back to search
 return true
 }
 blurTerminals()
 try {
 el.focus({ preventScroll: true })
 if (document.activeElement === el) {
 if ((opts?.forceSelect || !selectedOnce) && !el.value) {
 el.select()
 selectedOnce = true
 }
 return true
 }
 } catch {
 /* ignore */
 }
 return false
 }

 // Capture-phase: if a key would land outside the palette, yank focus first
 // so printable chars go into the filter instead of a locked xterm.
 const onKeyDownCapture = (e: KeyboardEvent): void => {
 if (e.ctrlKey || e.metaKey || e.altKey) return
 if (inPaletteUi(e.target as Element | null)) return
 // Esc / arrows / typing while focus is stuck in a terminal
 focusSearch()
 // Do not preventDefault — after focus, browser delivers to the input.
 // For the *current* event already targeted at xterm, re-route printable keys.
 const el = paletteSearchRef.current
 if (!el || document.activeElement !== el) return
 if (e.key === 'Escape') {
 e.preventDefault()
 e.stopPropagation()
 setPaletteOpen(false)
 setCustomCliOpen(false)
 setPaletteMenuOpen(false)
 return
 }
 if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
 // Event already targeted outside palette — apply nav/select with live state.
 e.preventDefault()
 e.stopPropagation()
 e.stopImmediatePropagation()
 const live = paletteLiveRef.current
 if (e.key === 'ArrowDown') {
 setPaletteIndex((i) => Math.min(i + 1, Math.max(0, live.filtered.length - 1)))
 } else if (e.key === 'ArrowUp') {
 setPaletteIndex((i) => Math.max(i - 1, 0))
 } else if (e.key === 'Enter') {
 const a = live.filtered[live.index]
 if (a) live.select(a)
 }
 return
 }
 if (e.key === 'Backspace') {
 e.preventDefault()
 e.stopPropagation()
 e.stopImmediatePropagation()
 setPaletteQuery((q) => q.slice(0, -1))
 return
 }
 if (e.key.length === 1 && !e.isComposing) {
 e.preventDefault()
 e.stopPropagation()
 e.stopImmediatePropagation()
 setPaletteQuery((q) => q + e.key)
 setPaletteIndex(0)
 }
 }

 focusSearch({ forceSelect: true })
 window.requestAnimationFrame(() => {
 focusSearch()
 window.requestAnimationFrame(() => focusSearch())
 })
 const delays = [16, 32, 50, 80, 120, 200, 350, 500]
 const timeouts = delays.map((ms) => window.setTimeout(() => focusSearch(), ms))

 // Reclaim for the whole time the palette is open — but only when focus
 // left the palette UI (never select/replace while the user is typing).
 window.clearInterval(paletteFocusTimerRef.current)
 paletteFocusTimerRef.current = window.setInterval(() => {
 if (!inPaletteUi(document.activeElement)) focusSearch()
 }, 80)

 window.addEventListener('keydown', onKeyDownCapture, true)

 return () => {
 window.clearInterval(paletteFocusTimerRef.current)
 for (const t of timeouts) window.clearTimeout(t)
 window.removeEventListener('keydown', onKeyDownCapture, true)
 document.body.classList.remove('palette-owns-keyboard')
 try {
 document.querySelectorAll('textarea.xterm-helper-textarea').forEach((node) => {
 const ta = node as HTMLTextAreaElement
 ta.disabled = false
 ta.setAttribute('tabindex', '0')
 })
 } catch {
 /* ignore */
 }
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open; live state via refs
 }, [paletteOpen])

 // Settings → MCP path buttons + any UI that wants Document view for a path
 useEffect(() => {
 const onOpen = (ev: Event): void => {
 const path = (ev as CustomEvent<{ path?: string }>).detail?.path
 if (typeof path === 'string' && path.trim()) void openDocumentTab(path.trim())
 }
 window.addEventListener('truedeck:open-path', onOpen)
 return () => window.removeEventListener('truedeck:open-path', onOpen)
 }, [openDocumentTab])

 // Live settings from Document Vim button / explorer toggle
 useEffect(() => {
 const onSettings = (ev: Event): void => {
 const s = (ev as CustomEvent<AppSettings>).detail
 if (s) applySettings(s)
 }
 window.addEventListener('truedeck:settings', onSettings)
 return () => window.removeEventListener('truedeck:settings', onSettings)
 }, [applySettings])

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
 // Close palette immediately so selection feels instant (spawn is async)
 setPaletteOpen(false)
 try {
 const root = activeProject.root
 const agentLabel =
 agents.find((a) => a.id === agentId)?.name || agentId
 // Status bar only — never a full-stage loading veil (blocks every other pane)
 setStatus(`Launching ${agentLabel}…`)
 // Measure stage so Grok/Codex boot with real COLUMNS/LINES (not 120×30 defaults)
 const stage = stageRef.current
 const approxCols = stage
 ? Math.max(60, Math.min(220, Math.floor(stage.clientWidth / 7.2)))
 : 120
 const approxRows = stage
 ? Math.max(16, Math.min(80, Math.floor(stage.clientHeight / 15)))
 : 36
 const info = await window.truedeck.spawnSession({
 projectRoot: root,
 agentId,
 cols: approxCols,
 rows: approxRows
 })
 addSession(info)
 // Inject/setup only if project not already ready — never compete with spawn
 // on the main process for every palette pick.
 const setup = projectSetup
 if (root && (!setup?.ready || setup.projectRoot !== root)) {
 void window.truedeck
 .injectMemoryForAgent({ allSynced: true, projectRoot: root })
 .catch(() => {
 /* non-fatal */
 })
 void runProjectSetup(root, { silent: true }).catch(() => {
 /* non-fatal */
 })
 } else if (root && setup?.ready && setup.pendingOpenAgents?.includes(agentId)) {
 // Only refresh stamp for this newly opened CLI id (light)
 void runProjectSetup(root, { silent: true }).catch(() => {
 /* non-fatal */
 })
 }
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
 }
 }
 shortcutCtxRef.current.launchAgentFn = (id: string) => {
 void launchAgent(id)
 }

 const missingAgents = useMemo(() => {
 return agents.filter((a) => {
 if (a.id === 'shell') return false
 const p = agentProbes[a.id]
 return p ? !p.available : false
 })
 }, [agents, agentProbes])

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
 setPaletteMenuOpen(false)
 setStatus(`Install help · ${agentId} - type y in the tab to run`)
 }
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 }
 }

 /** Open install-help tabs for every missing CLI (one after another). */
 const installAllMissing = async (): Promise<void> => {
 if (!activeProject) {
 setStatus('Pick a project first (Ctrl+O)')
 return
 }
 const missing = missingAgents
 if (!missing.length) {
 setStatus('All listed CLIs are installed')
 setPaletteMenuOpen(false)
 return
 }
 setInstallAllBusy(true)
 setPaletteMenuOpen(false)
 try {
 let opened = 0
 for (const a of missing) {
 try {
 const res = await window.truedeck.installAgentHelp({
 projectRoot: activeProject.root,
 agentId: a.id
 })
 if (res.alreadyInstalled) continue
 if (res.session) {
 addSession(res.session)
 opened++
 }
 } catch {
 /* continue others */
 }
 }
 setStatus(
 opened > 0
 ? `Install tabs opened for ${opened} missing CLI(s) · type y in each tab`
 : 'No install tabs needed'
 )
 void refreshAgentProbes()
 } finally {
 setInstallAllBusy(false)
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
 paletteLiveRef.current = {
 filtered: filteredAgents,
 index: paletteIndex,
 select: paletteSelect
 }

 const addCustomCli = async (): Promise<void> => {
 const command = customCliCmd.trim()
 if (!command) {
 setStatus('Enter a CLI command (e.g. my-agent)')
 return
 }
 setCustomCliBusy(true)
 try {
 const args = customCliArgs
 .trim()
 .split(/\s+/)
 .map((s) => s.trim())
 .filter(Boolean)
 const res = await window.truedeck.addCustomAgent({
 name: customCliName.trim() || command,
 command,
 args
 })
 await refreshAgents()
 void refreshAgentProbes()
 setCustomCliName('')
 setCustomCliCmd('')
 setCustomCliArgs('')
 setCustomCliOpen(false)
 setStatus(`Added custom CLI · ${res.preset.name}`)
 // Select the new agent in the list
 const idx = res.agents.findIndex((a) => a.id === res.preset.id)
 if (idx >= 0) setPaletteIndex(idx)
 } catch (e) {
 setStatus(e instanceof Error ? e.message : String(e))
 } finally {
 setCustomCliBusy(false)
 }
 }

 const removeCustomCli = async (agentId: string, e: ReactMouseEvent): Promise<void> => {
 e.preventDefault()
 e.stopPropagation()
 try {
 await window.truedeck.removeCustomAgent(agentId)
 await refreshAgents()
 void refreshAgentProbes()
 setStatus('Removed custom CLI')
 } catch (err) {
 setStatus(err instanceof Error ? err.message : String(err))
 }
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
 {activeProject && (
 <button
 type="button"
 className={`no-drag titlebar-explorer-btn${explorerOpen ? ' active' : ''}`}
 title="Project explorer (Ctrl+B)"
 aria-label="Toggle project explorer"
 aria-pressed={explorerOpen}
 onClick={(e) => {
 e.stopPropagation()
 setExplorerOpen((v) => {
 const next = !v
 void window.truedeck.getSettings().then(async (s) => {
 const saved = await window.truedeck.setSettings({
 ...s,
 showProjectExplorer: next
 })
 window.dispatchEvent(
 new CustomEvent('truedeck:settings', { detail: saved })
 )
 })
 return next
 })
 }}
 >
 <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
 <path
 fill="currentColor"
 d="M1.5 2.5A1.5 1.5 0 0 1 3 1h3.879a1.5 1.5 0 0 1 1.06.44L9 2.5H13A1.5 1.5 0 0 1 14.5 4v8A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V2.5zm1 1v8.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V4.5a.5.5 0 0 0-.5-.5H8.621a.5.5 0 0 1-.354-.146L7.207 2.793A.5.5 0 0 0 6.854 2.65H3.5a.5.5 0 0 0-.5.5v.35z"
 />
 </svg>
 </button>
 )}
 <div className="spacer" />
 {/* Soft automatic status only — no memory dashboard / setup wizard */}
 {activeProject && projectSetupBusy && !projectSetup?.ready && (
 <span
 className="no-drag project-setup-chip busy"
 title="Memory, MCP, and project context are automatic"
 >
 Preparing context…
 </span>
 )}
 {activeProject &&
 !projectSetupBusy &&
 projectSetup &&
 !projectSetup.ready &&
 projectSetup.label && (
 <button
 type="button"
 className="no-drag project-setup-chip needs"
 title={projectSetup.detail}
 onClick={() => {
 if (activeProject?.root) void runProjectSetup(activeProject.root, { silent: false })
 }}
 >
 {projectSetup.label}
 </button>
 )}
 {activeProject && projectSetup?.ready && projectSetup.warming && (
 <span
 className="no-drag project-setup-chip warming"
 title={projectSetup.detail}
 >
 Memory warming…
 </span>
 )}
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
 className={`stage ${countLeaves(stageLayout) > 1 ? 'split' : ''} ${tabDragging ? 'can-drop-split' : ''} ${activeProject && explorerOpen && !isDetachedWindow ? 'has-explorer' : ''}${isDetachedWindow ? ' detached-stage' : ''}`}
 >
 {/* Project explorer — always mounted when project open so width can animate */}
 {activeProject && !isDetachedWindow && (
 <div
 className={`stage-side${explorerOpen ? ' open' : ' closed'}`}
 style={{
 width: explorerOpen ? explorerWidth : 0,
 ['--explorer-w' as string]: `${explorerWidth}px`
 }}
 >
 <div className="stage-side-inner" style={{ width: explorerWidth }}>
 <ProjectExplorer
 projectRoot={activeProject.root}
 projectName={activeProject.name}
 width={explorerWidth}
 activeFilePath={
 projectSessions.find(
 (s) =>
 (s.kind === 'document' || s.documentPath) &&
 s.id === activeSessionId
 )?.documentPath || null
 }
 onOpenFile={(p) => {
 void openDocumentTab(p)
 }}
 onClose={() => {
 setExplorerOpen(false)
 void window.truedeck.getSettings().then(async (s) => {
 const saved = await window.truedeck.setSettings({
 ...s,
 showProjectExplorer: false
 })
 window.dispatchEvent(new CustomEvent('truedeck:settings', { detail: saved }))
 })
 }}
 />
 <div
 className="explorer-resize-handle"
 title="Drag to resize explorer"
 onMouseDown={(e) => {
 e.preventDefault()
 e.stopPropagation()
 explorerDragRef.current = { startX: e.clientX, startW: explorerWidth }
 document.body.classList.add('is-resizing-explorer')
 let lastW = explorerWidth
 const onMove = (ev: MouseEvent): void => {
 const d = explorerDragRef.current
 if (!d) return
 lastW = Math.max(160, Math.min(420, d.startW + (ev.clientX - d.startX)))
 setExplorerWidth(lastW)
 }
 const onUp = (): void => {
 explorerDragRef.current = null
 document.body.classList.remove('is-resizing-explorer')
 window.removeEventListener('mousemove', onMove)
 window.removeEventListener('mouseup', onUp)
 try {
 localStorage.setItem('truedeck.explorerWidth', String(lastW))
 } catch {
 /* ignore */
 }
 }
 window.addEventListener('mousemove', onMove)
 window.addEventListener('mouseup', onUp)
 }}
 />
 </div>
 </div>
 )}
 <div className="stage-main">
 {!sessionHydrated ? (
 <LoadingCard
 title={terminalLoadMsg || 'Restoring…'}
 hint="Opening last workspace"
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
 <kbd>Ctrl+O</kbd> project · <kbd>Ctrl+T</kbd> agent ·{' '}
 <kbd>Ctrl+B</kbd> explorer · <kbd>Ctrl+Shift+O</kbd> open file ·{' '}
 <kbd>Ctrl+W</kbd> close
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
 layout={stageLayout}
 sessions={stageSessions}
 fontSize={fontSize}
 dropTarget={isDetachedWindow ? null : dropTarget}
 tabDragging={tabDragging}
 onFocusSession={focusTab}
 onRestoreSession={restoreMinimizedSession}
 onCloseSession={(id) => void closeSession(id)}
 closingTabIds={closingTabIds}
 onReorderInGroup={(groupId, sessionId, toIndex) => {
 setPaneLayout((prev) => reorderInGroup(prev, groupId, sessionId, toIndex))
 if (activeProject) {
 moveSessionInProject(sessionId, toIndex, activeProject.root)
 }
 }}
 onCloseGroup={(groupId) => {
 // Kill tabs in the pane — never just relocate them to a neighbor
 void closeGroupSessions(groupId)
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
 onOpenPath={(path) => {
 if (typeof path === 'string' && path.trim()) {
 void openDocumentTab(path.trim())
 } else {
 setStatus('No file path under cursor')
 }
 }}
 openCliPathsInDocument={openCliPathsInDocument}
 editorVimMode={editorVimMode}
 splitAnim={splitAnim}
 closeSplitAnim={closeSplitAnim}
 inputLocked={paletteOpen || settingsOpen}
 />
 {/* Never full-stage loading while panes are open — status bar carries launch text */}
 </>
 )}
 </div>
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
 <span title="Ctrl+D vertical · Ctrl+X horizontal · Ctrl+Z undo move · Ctrl+Alt+X unsplit">
 <kbd>Ctrl+D</kbd>/<kbd>X</kbd> split · <kbd>Ctrl+Z</kbd> undo
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
 onClick={() => {
 setPaletteOpen(false)
 setCustomCliOpen(false)
 setPaletteMenuOpen(false)
 }}
 onKeyDown={(e) => {
 if (e.key === 'Escape') {
 setPaletteOpen(false)
 setCustomCliOpen(false)
 setPaletteMenuOpen(false)
 }
 }}
 >
 <div className="palette" onClick={(e) => e.stopPropagation()}>
 <div className="palette-header">
 <input
 ref={paletteSearchRef}
 className="palette-search"
 autoFocus
 tabIndex={0}
 placeholder="Type to filter agents... (or click one below)"
 value={paletteQuery}
 onChange={(e) => {
 setPaletteQuery(e.target.value)
 setPaletteIndex(0)
 }}
 onMouseDown={(e) => {
 e.stopPropagation()
 // Ensure click always reclaims from terminal
 e.currentTarget.focus()
 }}
 onFocus={(e) => {
 // Blur any terminal that snuck focus
 try {
 document.querySelectorAll('textarea.xterm-helper-textarea').forEach((ta) => {
 if (ta !== e.currentTarget) (ta as HTMLTextAreaElement).blur()
 })
 } catch {
 /* ignore */
 }
 }}
 onKeyDown={(e) => {
 e.stopPropagation()
 if (e.key === 'Escape') {
 if (paletteMenuOpen) {
 setPaletteMenuOpen(false)
 return
 }
 if (customCliOpen) {
 setCustomCliOpen(false)
 return
 }
 setPaletteOpen(false)
 return
 }
 if (customCliOpen) return
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
 <div className="palette-menu-wrap" ref={paletteMenuRef}>
 <button
 type="button"
 className={`palette-menu-btn${paletteMenuOpen ? ' open' : ''}`}
 title="Manage CLIs"
 aria-label="Manage CLIs"
 aria-expanded={paletteMenuOpen}
 aria-haspopup="menu"
 onClick={(e) => {
 e.stopPropagation()
 setPaletteMenuOpen((v) => !v)
 setCustomCliOpen(false)
 }}
 >
 <span className="palette-hamburger" aria-hidden>
 <span />
 <span />
 <span />
 </span>
 </button>
 {paletteMenuOpen && (
 <div
 className="palette-menu"
 role="menu"
 onMouseDown={(e) => e.stopPropagation()}
 onClick={(e) => e.stopPropagation()}
 >
 <button
 type="button"
 role="menuitem"
 className="palette-menu-item"
 onClick={() => {
 setPaletteMenuOpen(false)
 setCustomCliOpen(true)
 }}
 >
 <span className="palette-menu-item-title">Add your own CLI</span>
 <span className="palette-menu-item-sub">
 Custom command · path or PATH name
 </span>
 </button>
 <button
 type="button"
 role="menuitem"
 className="palette-menu-item"
 disabled={installAllBusy || missingAgents.length === 0}
 onClick={() => void installAllMissing()}
 >
 <span className="palette-menu-item-title">
 {installAllBusy
 ? 'Opening install tabs…'
 : missingAgents.length
 ? `Install missing (${missingAgents.length})`
 : 'All CLIs installed'}
 </span>
 <span className="palette-menu-item-sub">
 {missingAgents.length
 ? missingAgents.map((a) => a.name).join(', ')
 : 'Nothing to install'}
 </span>
 </button>
 {missingAgents.length > 0 && (
 <div className="palette-menu-section">
 <div className="palette-menu-section-label">Install one</div>
 {missingAgents.map((a) => (
 <button
 key={a.id}
 type="button"
 role="menuitem"
 className="palette-menu-item palette-menu-item-compact"
 onClick={() => {
 setPaletteMenuOpen(false)
 void installAgentCli(a.id)
 }}
 >
 <AgentIcon agentId={a.id} size={14} color={a.color} />
 <span className="palette-menu-item-title">{a.name}</span>
 </button>
 ))}
 </div>
 )}
 </div>
 )}
 </div>
 </div>

 <div className="palette-list">
 {filteredAgents.map((a, i) => {
 const probe = agentProbes[a.id]
 const isCustom = Boolean(a.custom || a.id.startsWith('custom-'))
 return (
 <div
 key={a.id}
 className={`palette-item-row ${i === paletteIndex ? 'active' : ''}`}
 onMouseEnter={() => setPaletteIndex(i)}
 >
 <button
 type="button"
 className="palette-item"
 title={probe?.resolvedCommand || a.command}
 onClick={() => {
 void launchAgent(a.id)
 }}
 >
 <AgentIcon agentId={a.id} size={16} color={a.color} />
 <span className="name">
 {a.name}
 {isCustom ? <span className="palette-custom-badge">custom</span> : null}
 </span>
 <span className="sub">{a.command}</span>
 </button>
 {isCustom && (
 <button
 type="button"
 className="palette-remove-custom"
 title={`Remove ${a.name}`}
 onClick={(e) => void removeCustomCli(a.id, e)}
 >
 ×
 </button>
 )}
 </div>
 )
 })}
 {filteredAgents.length === 0 && !customCliOpen && (
 <div className="palette-item muted">
 {missingAgents.length
 ? 'No installed agents match · use ☰ to install missing CLIs'
 : 'No agents match'}
 </div>
 )}
 </div>

 {customCliOpen && (
 <div className="palette-custom-form">
 <div className="palette-custom-title">Add your own CLI</div>
 <label className="palette-custom-field">
 <span>Name</span>
 <input
 value={customCliName}
 onChange={(e) => setCustomCliName(e.target.value)}
 placeholder="My Agent"
 autoFocus
 />
 </label>
 <label className="palette-custom-field">
 <span>Command</span>
 <input
 value={customCliCmd}
 onChange={(e) => setCustomCliCmd(e.target.value)}
 placeholder="my-agent or C:\path\to\cli.exe"
 />
 </label>
 <label className="palette-custom-field">
 <span>Args</span>
 <input
 value={customCliArgs}
 onChange={(e) => setCustomCliArgs(e.target.value)}
 placeholder="optional flags (space-separated)"
 onKeyDown={(e) => {
 if (e.key === 'Enter') {
 e.preventDefault()
 void addCustomCli()
 }
 }}
 />
 </label>
 <div className="palette-custom-actions">
 <button
 type="button"
 className="palette-custom-cancel"
 onClick={() => setCustomCliOpen(false)}
 >
 Cancel
 </button>
 <button
 type="button"
 className="palette-custom-save"
 disabled={customCliBusy || !customCliCmd.trim()}
 onClick={() => void addCustomCli()}
 >
 {customCliBusy ? 'Adding…' : 'Add CLI'}
 </button>
 </div>
 </div>
 )}
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
