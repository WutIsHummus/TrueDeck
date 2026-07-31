import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import type { ILink, ILinkProvider } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useDeck } from '../store'
import { sanitizeSessionTitle } from '../lib/session-label'
import {
 findPathAtColumn,
 findPathMatchesInLine,
 isHttpUrl,
 matchToCellRange,
 readTerminalLineCells,
 resolvePathCandidate
} from '../lib/path-links'
import { PixelBlast } from './PixelBlast'
import 'xterm/css/xterm.css'

interface Props {
 sessionId: string
 visible: boolean
 /**
 * When true, this terminal owns keyboard input (DOM focus).
 * Distinct from `visible`: in multi-pane layouts every group's active tab is
 * visible, but only the focused group's terminal should receive keys.
 * Defaults to `visible` for single-stack / tabs-only hosts.
 */
 focused?: boolean
 fontSize?: number
 /**
 * Click a path in CLI output → open Document view (local file) or OS handler.
 * Controlled by Settings → MCP → openCliPathsInDocument.
 */
 onOpenPath?: (path: string) => void
 /** When false, path underlines are disabled (default true). */
 openPathsEnabled?: boolean
 /** Skip open-intro PixelBlast (e.g. during pane split). */
 suppressIntroBlast?: boolean
 /** Palette/settings open — never steal focus or keystrokes. */
 inputLocked?: boolean
 /**
 * Pane is sliding (split enter). Paint canvas every frame without WINCH.
 * Do NOT use for close — continuous refresh makes Grok flicker.
 */
 layoutAnimating?: boolean
 /** Tab/pane is exiting — freeze fit/focus/WINCH so Grok doesn't redraw mid-fade. */
 closing?: boolean
}

/**
 * xterm view of a PTY session.
 * Hidden panes stay laid out (not display:none) so FitAddon can measure and
 * agent TUIs receive correct cols/rows on show.
 *
 * Rendering reliability notes (agent full-screen TUIs):
 * - Never thrash WINCH (debounce fit + skip no-op sizes).
 * - Coalesce PTY writes per animation frame so mid-redraw CSI batches land together.
 * - Force a full buffer refresh after idle writes and when becoming visible - 
 * Chromium often leaves a partial canvas until the next write otherwise
 * ("old text cut off until new output arrives").
 */
export function TerminalPane({
 sessionId,
 visible,
 focused,
 fontSize = 13,
 onOpenPath,
 openPathsEnabled = true,
 suppressIntroBlast = false,
 inputLocked = false,
 layoutAnimating = false,
 closing = false
}: Props): JSX.Element {
 /** Outer chrome (overlay, clicks) - never pass this to term.open(). */
 const shellRef = useRef<HTMLDivElement>(null)
 /**
 * Empty host owned only by xterm. React must not put siblings/children here - 
 * reconciling a connecting overlay on the same node used to wipe the canvas
 * (black Grok/Claude panes after "Connecting…" ends).
 */
 const hostRef = useRef<HTMLDivElement>(null)
 const termRef = useRef<Terminal | null>(null)
 const fitRef = useRef<FitAddon | null>(null)
 /** Keep latest open handler — terminal effect mounts once per session. */
 const onOpenPathRef = useRef(onOpenPath)
 onOpenPathRef.current = onOpenPath
 const openPathsEnabledRef = useRef(openPathsEnabled)
 openPathsEnabledRef.current = openPathsEnabled
 const inputLockedRef = useRef(inputLocked)
 inputLockedRef.current = inputLocked
 const layoutAnimatingRef = useRef(layoutAnimating)
 layoutAnimatingRef.current = layoutAnimating
 const closingRef = useRef(closing)
 closingRef.current = closing
 /** Grok / agent TUI mouse reporting — hide native scrollbar so wheel reaches custom scroll. */
 const [agentTuiMouse, setAgentTuiMouse] = useState(false)
 const agentTuiMouseRef = useRef(false)
 // Last PTY size we actually sent - skip no-op WINCH (agent TUIs clear+redraw on every resize)
 const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 })
 const visibleRef = useRef(visible)
 visibleRef.current = visible
 // Multi-pane: only the focused group's active tab should steal keyboard focus.
 const isFocused = focused ?? visible
 /** Show "Connecting…" until the first PTY bytes (or a short timeout). */
 const [awaitingOutput, setAwaitingOutput] = useState(true)
 /** Full-terminal flicker intro once per session (not on split remounts). */
 const [introBlast, setIntroBlast] = useState(false)
 const sessionColor =
 useDeck((st) => st.sessions.find((s) => s.id === sessionId)?.color) || '#22d3ee'

 useEffect(() => {
 if (suppressIntroBlast) {
 setIntroBlast(false)
 return
 }
 // Only the first time this session id is shown in this renderer
 const key = `td-intro:${sessionId}`
 try {
 if (sessionStorage.getItem(key)) {
 setIntroBlast(false)
 return
 }
 sessionStorage.setItem(key, '1')
 } catch {
 /* ignore */
 }
 setIntroBlast(true)
 const t = window.setTimeout(() => setIntroBlast(false), 1800)
 return () => window.clearTimeout(t)
 }, [sessionId, suppressIntroBlast])

 /** True while pane is sliding or user is dragging a split gutter. */
 const isLayoutFrozen = (): boolean => {
  if (closingRef.current || layoutAnimatingRef.current) return true
  try {
   return (
    document.body.classList.contains('is-pane-animating') ||
    document.body.classList.contains('is-resizing-split')
   )
  } catch {
   return false
  }
 }

 const pushSize = (term: Terminal, force = false): void => {
 // Never WINCH mid-animation / gutter-drag — agent TUIs clear+redraw every size
 // event and look jagged. One resize after motion ends is enough.
 if (!force && isLayoutFrozen()) return
 if (closingRef.current && !force) return
 const cols = Math.max(20, term.cols || 80)
 const rows = Math.max(8, term.rows || 24)
 const prev = lastSizeRef.current
 if (!force && prev.cols === cols && prev.rows === rows) return
 lastSizeRef.current = { cols, rows }
 void window.truedeck.resizeSession(sessionId, cols, rows, force)
 }

 /**
 * Fit cols/rows to the host box.
 *
 * Stock FitAddon always subtracts scrollBarWidth when scrollback > 0, even if
 * CSS hides the bar → permanent black strip. We measure the host ourselves.
 *
 * When host scrollback is active (`.xterm-viewport-scrollable`), reserve the
 * real 8px bar width so text ends at the bar and the bar sits flush on the
 * pane edge (no gap between thumb and side).
 */
 const fitAndResize = (force = false): void => {
 const term = termRef.current
 const fit = fitRef.current
 const host = hostRef.current
 if (!term || !host) return
 // Skip fit when host has no box yet (still mounting)
 if (host.clientWidth < 8 || host.clientHeight < 8) return
 // Freeze character grid while pane geometry is animating (smooth CSS motion)
 if (!force && isLayoutFrozen()) return
 try {
 const core = (
 term as unknown as {
 _core?: {
 viewport?: { scrollBarWidth?: number; element?: HTMLElement }
 _renderService?: {
 dimensions?: {
 css?: { cell?: { width?: number; height?: number } }
 }
 }
 }
 }
 )._core
 const vpEl =
 (core?.viewport?.element as HTMLElement | undefined) ||
 (host.querySelector('.xterm-viewport') as HTMLElement | null)
 // Match CSS: 8px only when host scrollback bar is shown
 const showHostBar = Boolean(
 vpEl?.classList.contains('xterm-viewport-scrollable') &&
 !host.closest('.terminal-pane')?.classList.contains('agent-tui-mouse')
 )
 const barW = showHostBar ? 8 : 0
 if (core?.viewport && typeof core.viewport.scrollBarWidth === 'number') {
 core.viewport.scrollBarWidth = barW
 }
 const cellW = core?._renderService?.dimensions?.css?.cell?.width || 0
 const cellH = core?._renderService?.dimensions?.css?.cell?.height || 0
 if (cellW > 0 && cellH > 0) {
 const availW = Math.max(8, host.clientWidth - barW)
 const cols = Math.max(20, Math.floor(availW / cellW))
 const rows = Math.max(8, Math.floor(host.clientHeight / cellH))
 if (term.cols !== cols || term.rows !== rows) {
 term.resize(cols, rows)
 }
 } else if (fit) {
 fit.fit()
 if (core?.viewport && typeof core.viewport.scrollBarWidth === 'number') {
 core.viewport.scrollBarWidth = barW
 }
 }
 pushSize(term, force)
 } catch {
 // ignore measure races
 }
 }

 /**
 * Full-screen agent CLIs (Grok Build) often paint black until they get a real
 * WINCH matching the xterm viewport. Nudge size once after attach so they redraw.
 *
 * Do NOT call this on every tab switch — the rows-1 → rows thrash makes Grok
 * clear and repaint (visible flicker). Reserve for mount / first bytes / blank.
 */
 const lastKickAtRef = useRef(0)
 const isCursorAgent = (): boolean => {
 try {
 return (
 useDeck.getState().sessions.find((s) => s.id === sessionId)?.agentId || ''
 ).toLowerCase() === 'cursor'
 } catch {
 return false
 }
 }
 const kickAgentTui = (reason: 'mount' | 'first-byte' | 'blank' | 'manual' = 'manual'): void => {
 const term = termRef.current
 const host = hostRef.current
 if (!term) return
 if (closingRef.current) return
 // Host still collapsing (connecting overlay / split) - wait for a real box
 if (host && (host.clientWidth < 8 || host.clientHeight < 8)) return
 const now = Date.now()
 const cursor = isCursorAgent()
 // Tab switches used to re-kick every time → Grok flicker. Cooldown unless blank.
 // Cursor: shorter cooldown — it often needs repeated WINCH to first paint.
 const cooldown = cursor ? 400 : 2500
 if (
 reason !== 'blank' &&
 reason !== 'first-byte' &&
 now - lastKickAtRef.current < cooldown
 ) {
 fitAndResize(false)
 forceRefresh()
 try {
 term.focus()
 } catch {
 /* ignore */
 }
 return
 }
 lastKickAtRef.current = now
 fitAndResize(true)
 const cols = Math.max(20, term.cols || 80)
 const rows = Math.max(8, term.rows || 24)
 // Slightly different size forces a change event on ConPTY
 void window.truedeck.resizeSession(sessionId, cols, Math.max(8, rows - 1), true)
 window.setTimeout(() => {
 if (!termRef.current) return
 lastSizeRef.current = { cols: 0, rows: 0 }
 void window.truedeck.resizeSession(sessionId, cols, rows, true)
 lastSizeRef.current = { cols, rows }
 forceRefresh()
 // Cursor TUI often needs a second paint + focus before anything appears
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 requestAnimationFrame(() => {
 forceRefresh()
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 })
 }, cursor ? 30 : 50)
 // Cursor: third WINCH pass — blank until keystroke without this on some ConPTY builds
 if (cursor) {
 window.setTimeout(() => {
 if (!termRef.current) return
 lastSizeRef.current = { cols: 0, rows: 0 }
 const t = termRef.current
 const c = Math.max(20, t.cols || 80)
 const r = Math.max(8, t.rows || 24)
 void window.truedeck.resizeSession(sessionId, c, r, true)
 lastSizeRef.current = { cols: c, rows: r }
 forceRefresh()
 try {
 t.focus()
 } catch {
 /* ignore */
 }
 }, 120)
 }
 }

 /** Full viewport repaint - fixes partial canvas frames that stick until next write. */
 const forceRefresh = (): void => {
 const term = termRef.current
 if (!term) return
 try {
 const rows = Math.max(1, term.rows || 1)
 term.refresh(0, rows - 1)
 } catch {
 // ignore if disposed mid-frame
 }
 }

 useEffect(() => {
 const host = hostRef.current
 if (!host) return
 lastSizeRef.current = { cols: 0, rows: 0 }
 setAwaitingOutput(true)

 const term = new Terminal({
 cursorBlink: true,
 fontSize,
 fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
 theme: {
 // Full 16-color palette so agent TUIs (Claude/Codex/Grok/Cursor) match
 // their native CLI colors instead of falling back to washed defaults.
 background: '#05070a',
 foreground: '#e2e8f0',
 cursor: '#22d3ee',
 cursorAccent: '#05070a',
 selectionBackground: '#f0a05066',
 selectionForeground: '#f8fafc',
 black: '#0f172a',
 red: '#f87171',
 green: '#34d399',
 yellow: '#fbbf24',
 blue: '#60a5fa',
 magenta: '#c084fc',
 cyan: '#22d3ee',
 white: '#e2e8f0',
 brightBlack: '#64748b',
 brightRed: '#fca5a5',
 brightGreen: '#6ee7b7',
 brightYellow: '#fde68a',
 brightBlue: '#93c5fd',
 brightMagenta: '#d8b4fe',
 brightCyan: '#67e8f9',
 brightWhite: '#f8fafc'
 },
 allowProposedApi: true,
 scrollback: 5000,
 // Draw all rows each paint - less partial-frame sticky garbage on ConPTY redraws
 convertEol: false,
 windowsMode: false,
 rightClickSelectsWord: true,
 drawBoldTextInBrightColors: true
 })
 const fit = new FitAddon()
 term.loadAddon(fit)
 // HTTP(S) links (non-local) — open externally
 term.loadAddon(
 new WebLinksAddon((_event, uri) => {
 void window.truedeck.openPathInOs(uri).catch(() => {
 try {
 window.open(uri, '_blank', 'noopener,noreferrer')
 } catch {
 /* ignore */
 }
 })
 })
 )

 /** Resolve session project root for relative CLI paths. */
 const sessionProjectRoot = (): string | null => {
 const s = useDeck.getState().sessions.find((x) => x.id === sessionId)
 return s?.projectRoot || useDeck.getState().projects.find((p) => p.id === useDeck.getState().activeProjectId)?.root || null
 }

 /** Open a matched path string (relative or absolute) in Document view. */
 const openMatchedPath = (raw: string): void => {
 if (!raw || !openPathsEnabledRef.current) return
 if (isHttpUrl(raw)) {
 void window.truedeck.openPathInOs(raw).catch(() => {
 /* ignore */
 })
 return
 }
 const resolved = resolvePathCandidate(raw, sessionProjectRoot())
 const open = onOpenPathRef.current
 if (open) {
 useDeck.getState().setStatus(`Opening ${raw}…`)
 open(resolved || raw)
 } else {
 useDeck.getState().setStatus('Path open unavailable')
 }
 }

 /** Path under a mouse event (viewport cell → buffer line). */
 const pathUnderMouseEvent = (ev: MouseEvent): string | null => {
 try {
 const core = (
 term as unknown as {
 _core?: {
 _mouseService?: {
 getMouseReportCoords?: (
 e: MouseEvent,
 el: HTMLElement
 ) => { col: number; row: number } | undefined
 }
 _renderService?: {
 dimensions?: {
 css?: { cell?: { width?: number; height?: number } }
 }
 }
 screenElement?: HTMLElement
 }
 }
 )._core
 let col = -1
 let row = -1
 const coords = core?._mouseService?.getMouseReportCoords?.(
 ev,
 core.screenElement || term.element!
 )
 if (coords && Number.isFinite(coords.col) && Number.isFinite(coords.row)) {
 col = coords.col
 row = coords.row
 } else {
 // Fallback: map client coords via cell CSS size
 const el = core?.screenElement || term.element
 if (!el) return null
 const rect = el.getBoundingClientRect()
 const cellW = core?._renderService?.dimensions?.css?.cell?.width || 0
 const cellH = core?._renderService?.dimensions?.css?.cell?.height || 0
 if (cellW < 1 || cellH < 1) return null
 col = Math.floor((ev.clientX - rect.left) / cellW)
 row = Math.floor((ev.clientY - rect.top) / cellH)
 }
 if (col < 0 || row < 0) return null
 col = Math.max(0, Math.min((term.cols || 1) - 1, col))
 row = Math.max(0, Math.min((term.rows || 1) - 1, row))
 const buf = term.buffer.active
 const lineIdx = buf.viewportY + row
 const lineObj = buf.getLine(lineIdx)
 if (!lineObj) return null
 const { text, strToCell } = readTerminalLineCells(
 (c) => lineObj.getCell(c)?.getChars() || '',
 lineObj.length
 )
 return findPathAtColumn(text, col, strToCell)
 } catch {
 return null
 }
 }

 // File paths (local / project-relative) → Document view when enabled
 // Underlines via link provider; clicks also handled below (agent mouse mode
 // otherwise swallows plain clicks so activate never fires).
 let pathLinkDispose: { dispose: () => void } | null = null
 if (openPathsEnabled) {
 const provider: ILinkProvider = {
 provideLinks: (y, callback) => {
 try {
 if (!openPathsEnabledRef.current) {
 callback(undefined)
 return
 }
 const lineObj = term.buffer.active.getLine(y - 1)
 if (!lineObj) {
 callback(undefined)
 return
 }
 const { text, strToCell } = readTerminalLineCells(
 (c) => lineObj.getCell(c)?.getChars() || '',
 lineObj.length
 )
 const matches = findPathMatchesInLine(text)
 if (!matches.length) {
 callback(undefined)
 return
 }
 const links: ILink[] = []
 for (const m of matches) {
 const range = matchToCellRange(m, strToCell)
 if (!range) continue
 links.push({
 text: m.text,
 range: {
 start: { x: range.startCol + 1, y },
 end: { x: range.endCol + 1, y }
 },
 activate: (_event, _text) => {
 openMatchedPath(m.text)
 },
 hover: (event) => {
 const el = event.target as HTMLElement | undefined
 if (el?.style) {
 el.style.cursor = 'pointer'
 el.title = agentTuiMouseRef.current
 ? `Open ${m.text} (click · or Ctrl+click)`
 : `Open ${m.text}`
 }
 }
 })
 }
 callback(links.length ? links : undefined)
 } catch {
 callback(undefined)
 }
 }
 }
 pathLinkDispose = term.registerLinkProvider(provider)
 }
 // Only ever open into the dedicated empty host - never the shell with React kids
 term.open(host)
 // FitAddon still reads this even when CSS hides the bar; zero it so cols
 // span the full pane (otherwise a black strip sits past the last column).
 try {
 const vp = (
 term as unknown as { _core?: { viewport?: { scrollBarWidth?: number } } }
 )._core?.viewport
 if (vp && typeof vp.scrollBarWidth === 'number') vp.scrollBarWidth = 0
 } catch {
 /* ignore */
 }
 termRef.current = term
 fitRef.current = fit
 // Immediate fit + staged WINCH kicks only on mount (Cursor Agent is slow on ConPTY).
 // Later tab switches use soft fit/refresh only — see visible/focused effects.
 const cursorLaunch = isCursorAgent()
 requestAnimationFrame(() => {
 fitAndResize(true)
 forceRefresh()
 try {
 term.focus()
 } catch {
 /* ignore */
 }
 kickAgentTui('mount')
 })
 // Detached pop-out / Cursor: denser late kicks — blank until WINCH redraw
 let isDetachedRenderer = false
 try {
  isDetachedRenderer = Boolean(
   window.truedeck?.getDetachedBoot?.()?.detached ||
    new URLSearchParams(window.location.search).get('detached') === '1'
  )
 } catch {
  /* ignore */
 }
 const kickSchedule =
  cursorLaunch || isDetachedRenderer
   ? [60, 150, 300, 500, 800, 1200, 1800, 2600, 4000, 5500]
   : [80, 200, 400, 800, 1400, 2200, 3500]
 // Detached: clear "Connecting…" if PTY is idle (no new bytes) so window isn't stuck empty
 if (isDetachedRenderer) {
  window.setTimeout(() => setAwaitingOutput(false), 600)
 }
 const kickTimers = kickSchedule.map((ms) =>
 window.setTimeout(() => {
 if (!termRef.current) return
 // Soft fit after first kick; Cursor re-kicks longer (blank-until-type)
 if (ms <= (cursorLaunch ? 1200 : 400)) kickAgentTui('mount')
 else {
 fitAndResize(cursorLaunch)
 forceRefresh()
 if (cursorLaunch) {
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 }
 }
 }, ms)
 )
 let firstByteKicked = false

 /** True when the viewport is not at the live bottom (user is in scrollback). */
 const isScrolledUp = (): boolean => {
 try {
 const b = term.buffer.active
 return b.viewportY < b.baseY
 } catch {
 return false
 }
 }

 /**
 * Follow live output (LLM stream) on the *normal* buffer unless the user
 * scrolled into history. Never call scrollToBottom on the alternate screen —
 * Codex/Grok redraw the full TUI there; forcing host scroll fights each frame
 * and looks like the UI bouncing up and down on open/stream.
 */
 let stickToBottom = true
 const syncStickFromViewport = (): void => {
 try {
 if (term.buffer.active.type === 'alternate') return
 stickToBottom = !isScrolledUp()
 } catch {
 /* disposed */
 }
 }
 const scrollLiveIfFollowing = (): void => {
 if (!stickToBottom) return
 try {
 // Alt-screen TUI owns its viewport via CSI redraws — do not host-scroll.
 if (term.buffer.active.type === 'alternate') return
 if (isScrolledUp()) term.scrollToBottom()
 } catch {
 /* disposed */
 }
 }

 /** Session agent id (e.g. grok, codex) — used for TUI scroll ownership. */
 const sessionAgentId = (): string => {
 try {
 return (
 useDeck.getState().sessions.find((s) => s.id === sessionId)?.agentId || ''
 ).toLowerCase()
 } catch {
 return ''
 }
 }

 /**
 * Agents that *always* need wheel → PTY mouse reports (custom in-app scroll).
 * Grok is the main case. Codex uses alt-screen + mouse when active — handled
 * via isMouseTrackingOn / isAltScreen in tuiOwnsWheel(), not forced here.
 * Forcing Codex from frame 0 caused scrollbar/fit thrash on first open.
 *
 * https://docs.x.ai/build/cli/terminal-support
 */
 const isCustomScrollTuiAgent = (): boolean => {
 const id = sessionAgentId()
 return id === 'grok' || id === 'gemini' || id === 'kiro'
 }

 /** True when the app (Grok) has requested mouse tracking. */
 const isMouseTrackingOn = (): boolean => {
 try {
 if (term.element?.classList.contains('enable-mouse-events')) return true
 } catch {
 /* ignore */
 }
 try {
 const mode = String(
 (term.modes as { mouseTrackingMode?: string } | undefined)?.mouseTrackingMode ||
 'none'
 )
 if (mode !== 'none' && mode !== '0') return true
 } catch {
 /* ignore */
 }
 try {
 const core = (
 term as unknown as {
 _core?: {
 coreService?: { decPrivateModes?: { mouseTrackingMode?: unknown } }
 coreMouseService?: {
 areMouseEventsActive?: boolean | (() => boolean)
 activeProtocol?: string
 }
 }
 }
 )._core
 const active = core?.coreMouseService?.areMouseEventsActive
 if (typeof active === 'function' ? active.call(core.coreMouseService) : active) {
 return true
 }
 const proto = core?.coreMouseService?.activeProtocol
 if (proto && String(proto) !== 'NONE' && String(proto) !== 'none' && String(proto) !== '0') {
 return true
 }
 const m = core?.coreService?.decPrivateModes?.mouseTrackingMode
 if (m != null && String(m) !== '0' && String(m) !== 'none' && String(m) !== 'NONE') {
 return true
 }
 } catch {
 /* ignore */
 }
 return false
 }

 const isAltScreen = (): boolean => {
 try {
 return term.buffer.active.type === 'alternate'
 } catch {
 return false
 }
 }

 /** Full-screen TUI (Codex/Grok/…) — host forceRefresh/fit fights each paint. */
 const isStreamingTui = (): boolean => {
 try {
 return term.buffer.active.type === 'alternate' || isMouseTrackingOn()
 } catch {
 return false
 }
 }

 /**
 * Does this pane need wheel → PTY mouse reports (not host scrollback)?
 * Grok always: even if mouse/alt detection lags after redraw.
 */
 const tuiOwnsWheel = (): boolean =>
 isCustomScrollTuiAgent() || isMouseTrackingOn() || isAltScreen()

 // Never let xterm eat TrueDeck app shortcuts.
 // Ctrl+A left for the terminal (select-all / agent TUI).
 // Ctrl+D = v-split · Ctrl+X = h-split · Ctrl+Z = undo move · Ctrl+Arrow = panes.
 // PageUp/Down + arrows scroll history (arrows only while scrolled up, or with Shift).
 const blockEvent = (ev: KeyboardEvent): false => {
 try {
 ev.preventDefault()
 ev.stopPropagation()
 // stopImmediatePropagation exists on DOM KeyboardEvent
 ev.stopImmediatePropagation?.()
 } catch {
 // ignore
 }
 return false
 }

 const isArrowKey = (ev: KeyboardEvent): boolean => {
 const c = ev.code || ''
 const k = ev.key || ''
 return (
 c === 'ArrowLeft' ||
 c === 'ArrowRight' ||
 c === 'ArrowUp' ||
 c === 'ArrowDown' ||
 k === 'ArrowLeft' ||
 k === 'ArrowRight' ||
 k === 'ArrowUp' ||
 k === 'ArrowDown' ||
 k === 'Left' ||
 k === 'Right' ||
 k === 'Up' ||
 k === 'Down'
 )
 }

 /** Debounce so keydown paste + DOM paste event never double-insert. */
 let lastPasteAt = 0
 const PASTE_DEBOUNCE_MS = 100

 const isWindowsHost = (): boolean => {
 try {
 return (
 (typeof process !== 'undefined' && process.platform === 'win32') ||
 navigator.userAgent.includes('Windows')
 )
 } catch {
 return navigator.userAgent.includes('Windows')
 }
 }

 const copySelection = (): boolean => {
 try {
 if (!term.hasSelection()) return false
 const text = term.getSelection()
 if (!text) return false
 void window.truedeck.writeClipboard(text)
 // Clear so the next bare Ctrl+C is SIGINT, not another copy.
 try {
 term.clearSelection()
 } catch {
 /* ignore */
 }
 return true
 } catch {
 return false
 }
 }

 /**
 * Paste into the PTY via xterm.paste (bracketed paste) → onData → writeSession.
 * Only stamps the debounce after a non-empty paste so empty clipboard
 * events cannot block a real Ctrl+V.
 */
 const pasteIntoTerm = (raw: string): boolean => {
 if (!raw) return false
 const now = Date.now()
 if (now - lastPasteAt < PASTE_DEBOUNCE_MS) return false
 lastPasteAt = now
 const payload = isWindowsHost() ? raw.replace(/\r?\n/g, '\r') : raw
 try {
 // Prefer xterm.paste so agents get bracketed-paste sequences when enabled.
 if (typeof term.paste === 'function') {
 term.paste(payload)
 } else {
 void window.truedeck.writeSession(sessionId, payload)
 }
 return true
 } catch {
 try {
 void window.truedeck.writeSession(sessionId, payload)
 return true
 } catch {
 return false
 }
 }
 }

 const pasteClipboard = (text?: string): void => {
 if (typeof text === 'string' && text.length > 0) {
 pasteIntoTerm(text)
 return
 }
 const tryNav = (): void => {
 if (!navigator.clipboard?.readText) return
 void navigator.clipboard
 .readText()
 .then((t) => {
 if (t) pasteIntoTerm(t)
 })
 .catch(() => {
 /* permission / focus */
 })
 }
 if (typeof window.truedeck?.readClipboard === 'function') {
 void window.truedeck
 .readClipboard()
 .then((t) => {
 if (t) pasteIntoTerm(t)
 else tryNav()
 })
 .catch(() => tryNav())
 return
 }
 tryNav()
 }

 term.attachCustomKeyEventHandler((ev) => {
 // Palette / settings own the keyboard — never feed PTY
 if (inputLockedRef.current) {
 return blockEvent(ev)
 }
 if (ev.type !== 'keydown') return true
 const ctrl = ev.ctrlKey || ev.metaKey

 // Ctrl+Arrow / Ctrl+Tab → App owns (main before-input + App shortcuts)
 if (ctrl && isArrowKey(ev)) {
 return blockEvent(ev)
 }
 if (ctrl && (ev.key === 'Tab' || ev.code === 'Tab')) {
 return blockEvent(ev)
 }

 // ── Scrollback keys (no Ctrl - Ctrl+Arrow is pane focus) ────────────
 if (!ctrl && !ev.altKey) {
 // Grok / full-screen TUIs: PageUp/Down must go to the app (alt buffer has
 // no host scrollback). Shell normal buffer still uses xterm history.
 const tuiScrollKeys = tuiOwnsWheel()
 if (ev.key === 'PageUp' || ev.code === 'PageUp') {
 if (tuiScrollKeys && !ev.shiftKey) {
 stickToBottom = false
 void window.truedeck.writeSession(sessionId, '\x1b[5~')
 return blockEvent(ev)
 }
 term.scrollPages(-1)
 syncStickFromViewport()
 forceRefresh()
 return blockEvent(ev)
 }
 if (ev.key === 'PageDown' || ev.code === 'PageDown') {
 if (tuiScrollKeys && !ev.shiftKey) {
 void window.truedeck.writeSession(sessionId, '\x1b[6~')
 // PageDown toward live edge — re-sync after TUI moves
 window.setTimeout(() => syncStickFromViewport(), 0)
 return blockEvent(ev)
 }
 term.scrollPages(1)
 syncStickFromViewport()
 forceRefresh()
 return blockEvent(ev)
 }
 // Shift+↑/↓ always host-scroll; bare ↑/↓ only while in host history.
 // On Grok alt-screen, bare arrows must reach the TUI (return true).
 if (
 (ev.key === 'ArrowUp' || ev.code === 'ArrowUp') &&
 (ev.shiftKey || (isScrolledUp() && !tuiScrollKeys))
 ) {
 term.scrollLines(ev.shiftKey ? -5 : -1)
 syncStickFromViewport()
 forceRefresh()
 return blockEvent(ev)
 }
 if (
 (ev.key === 'ArrowDown' || ev.code === 'ArrowDown') &&
 (ev.shiftKey || (isScrolledUp() && !tuiScrollKeys))
 ) {
 term.scrollLines(ev.shiftKey ? 5 : 1)
 syncStickFromViewport()
 forceRefresh()
 return blockEvent(ev)
 }
 if ((ev.key === 'Home' || ev.code === 'Home') && ev.shiftKey) {
 term.scrollToTop()
 stickToBottom = false
 forceRefresh()
 return blockEvent(ev)
 }
 if ((ev.key === 'End' || ev.code === 'End') && ev.shiftKey) {
 term.scrollToBottom()
 stickToBottom = true
 forceRefresh()
 return blockEvent(ev)
 }
 }

 if (!ctrl) return true
 const fromCode =
 typeof ev.code === 'string' && ev.code.startsWith('Key')
 ? ev.code.slice(3).toLowerCase()
 : ''
 const k =
 (ev.key.length === 1 ? ev.key.toLowerCase() : '') || fromCode
 const code = ev.code || ''

 // ── Terminal owns C/V (main does not claim these) ───────────────────
 // Ctrl+Shift+C → copy. Ctrl+C with selection → copy then clear.
 // Bare Ctrl+C with no selection → SIGINT to PTY.
 if ((k === 'c' || code === 'KeyC') && !ev.altKey) {
 if (ev.shiftKey) {
 copySelection()
 return blockEvent(ev)
 }
 if (term.hasSelection() && copySelection()) {
 return blockEvent(ev)
 }
 return true
 }
 // Ctrl+V / Ctrl+Shift+V → paste.
 // Do NOT preventDefault here: that cancels the browser paste event and
 // leaves us dependent on async IPC only (often empty/racey on Windows).
 // Return false so xterm does not emit Ctrl+V (\x16) to the PTY; the
 // native paste event (or a short IPC backup) does the insert.
 if ((k === 'v' || code === 'KeyV') && !ev.altKey) {
 try {
 ev.stopPropagation()
 } catch {
 /* ignore */
 }
 window.setTimeout(() => pasteClipboard(), 15)
 return false
 }
 // Ctrl+A → agent/shell. Ctrl+Shift+A → select all buffer for copy.
 if ((k === 'a' || code === 'KeyA') && !ev.altKey && !ev.shiftKey) {
 return true
 }
 if ((k === 'a' || code === 'KeyA') && ev.shiftKey && !ev.altKey) {
 try {
 term.selectAll()
 } catch {
 /* ignore */
 }
 return blockEvent(ev)
 }

 // Font zoom: never send to PTY (App owns via main IPC)
 const zoomCode =
 code === 'Equal' ||
 code === 'Minus' ||
 code === 'NumpadAdd' ||
 code === 'NumpadSubtract' ||
 code === 'Digit0' ||
 code === 'Numpad0'
 if (
 zoomCode ||
 k === '=' ||
 k === '+' ||
 k === '-' ||
 k === '_' ||
 k === '0'
 ) {
 return blockEvent(ev)
 }

 // App chords only with the exact modifiers App handles.
 // Ctrl+D / Ctrl+X split · Ctrl+Z undo move · Ctrl+Alt+D/X unsplit
 if ((k === 'd' || k === 'x') && !ev.shiftKey) {
 return blockEvent(ev)
 }
 // Leave other Ctrl+Alt / Ctrl+Shift chords for the agent
 if (ev.altKey || ev.shiftKey) return true

 // Plain Ctrl+letter / digit app shortcuts
 if (['o', 'w', 's', 't', 'n'].includes(k)) return blockEvent(ev)
 if (k >= '1' && k <= '9') return blockEvent(ev)
 return true
 })

 // Browser copy/paste (Edit menu, Ctrl+V when key handler did not run)
 const hostElForClip = host
 const onDomCopy = (e: ClipboardEvent): void => {
 if (!term.hasSelection()) return
 const text = term.getSelection()
 if (!text) return
 e.preventDefault()
 e.clipboardData?.setData('text/plain', text)
 void window.truedeck.writeClipboard(text)
 try {
 term.clearSelection()
 } catch {
 /* ignore */
 }
 }
 const onDomPaste = (e: ClipboardEvent): void => {
 // Always claim the event so the helper textarea does not double-insert.
 e.preventDefault()
 e.stopPropagation()
 const fromEvent = e.clipboardData?.getData('text/plain') || ''
 if (fromEvent) {
 pasteIntoTerm(fromEvent)
 return
 }
 // Some Electron builds leave clipboardData empty - fall back to IPC.
 pasteClipboard()
 }
 // Middle-click paste (Linux-style; handy on Windows too)
 const onMouseUp = (e: MouseEvent): void => {
 if (e.button === 1) {
 e.preventDefault()
 pasteClipboard()
 return
 }
 // Left release: if host has a selection (Shift-drag under mouse tracking),
 // copy to OS clipboard so Grok copy matches shell/codex behavior.
 if (e.button === 0) {
 window.requestAnimationFrame(() => {
 try {
 if (!term.hasSelection()) return
 const text = term.getSelection()
 if (!text) return
 void window.truedeck.writeClipboard(text)
 } catch {
 /* ignore */
 }
 })
 }
 }

 /**
 * Click a file path in CLI output → Document tab.
 * Agent TUIs enable mouse tracking, which makes xterm skip link activate
 * unless a modifier is held — so we open paths ourselves on left-click.
 */
 const onPathClickCapture = (e: MouseEvent): void => {
 if (e.button !== 0) return
 if (!openPathsEnabledRef.current || !onOpenPathRef.current) return
 // Don't steal multi-select / shift-drag selection
 if (e.shiftKey) return
 // Ignore if user is dragging a selection (has non-collapsed selection after drag)
 try {
 if (term.hasSelection() && (term.getSelection() || '').length > 1) return
 } catch {
 /* ignore */
 }
 const raw = pathUnderMouseEvent(e)
 if (!raw) return
 e.preventDefault()
 e.stopPropagation()
 openMatchedPath(raw)
 }
 // Capture on host + textarea so paste is not missed under agent TUIs.
 hostElForClip.addEventListener('copy', onDomCopy)
 hostElForClip.addEventListener('paste', onDomPaste, true)
 hostElForClip.addEventListener('mouseup', onMouseUp)
 // Capture-phase click beats xterm mouse reporting for path opens
 hostElForClip.addEventListener('click', onPathClickCapture, true)
 const helperTa = hostElForClip.querySelector(
 'textarea.xterm-helper-textarea'
 ) as HTMLTextAreaElement | null
 if (helperTa) {
 helperTa.addEventListener('paste', onDomPaste, true)
 }
 // Capture first user prompt line as session title when CLI never sets OSC title.
 // Never promote paths or secret-looking strings (e.g. Cursor API keys) into the header.
 let lineBuf = ''
 let capturedFirstLine = false
 const onData = term.onData((data) => {
 // Typing / sending a prompt resumes live follow (chat-style stick-to-bottom)
 stickToBottom = true
 scrollLiveIfFollowing()
 void window.truedeck.writeSession(sessionId, data)
 if (capturedFirstLine) return
 for (const ch of data) {
 if (ch === '\r' || ch === '\n') {
 const line = sanitizeSessionTitle(lineBuf)
 lineBuf = ''
 if (line.length >= 3) {
 const cur = useDeck.getState().sessions.find((s) => s.id === sessionId)
 const agent = (cur?.agentName || '').toLowerCase()
 // Don't steal board-assigned titles
 if (cur?.focusIdea || (cur?.focusTitle && cur.focusTitle.toLowerCase() !== agent)) {
 capturedFirstLine = true
 break
 }
 if (!cur?.title || cur.title.toLowerCase() === agent) {
 // title only - focusTitle is reserved for deck tasks / dispatch
 useDeck.getState().patchSession(sessionId, {
 title: line
 })
 }
 capturedFirstLine = true
 }
 break
 } else if (ch === '\u007f' || ch === '\b') {
 lineBuf = lineBuf.slice(0, -1)
 } else if (ch >= ' ' && lineBuf.length < 120) {
 lineBuf += ch
 }
 }
 })

 // OSC 0/2 title from the agent CLI - store as session.title only.
 // Never write focusTitle: Codex/shell thrash the window title (branch names,
 // cwd, etc.) and that remounted chrome / flickered "TrueDeck · master".
 const onTitle = term.onTitleChange((raw) => {
 const t = sanitizeSessionTitle(raw)
 if (!t) return
 capturedFirstLine = true
 const cur = useDeck.getState().sessions.find((s) => s.id === sessionId)
 // Skip no-op patches (Codex often re-sends the same title)
 if (cur?.title === t) return
 useDeck.getState().patchSession(sessionId, {
 title: t
 })
 })

 // ── Reliable write path ────────────────────────────────────────────────
 // Coalesce bursts into one rAF write so a full TUI frame (clear + paint)
 // lands in a single parser pass when the host delivers chunks mid-frame.
 // After idle, force a full refresh - fixes "cut off until next keystroke".
 let writeBuf = ''
 let rafId: number | null = null
 let idleRefreshTimer: number | null = null
 let writing = false

 const flushWrites = (): void => {
 rafId = null
 if (!writeBuf) return
 const chunk = writeBuf
 writeBuf = ''
 writing = true
 term.write(chunk, () => {
 writing = false
 // Normal buffer only — alt-screen scrollToBottom causes Codex stream jitter
 if (!isStreamingTui()) scrollLiveIfFollowing()
 // If more arrived while the parser was busy, schedule another flush
 if (writeBuf && rafId == null) {
 rafId = requestAnimationFrame(flushWrites)
 }
 })
 }

 const scheduleIdleRefresh = (): void => {
 if (idleRefreshTimer != null) window.clearTimeout(idleRefreshTimer)
 // Alt-screen TUIs repaint themselves; full-row forceRefresh mid-stream = jitter
 const delay = isStreamingTui() ? 280 : 48
 idleRefreshTimer = window.setTimeout(() => {
 idleRefreshTimer = null
 if (!writeBuf && !writing && rafId == null) {
 // Skip forced refresh while still on alt-screen — parser already painted
 if (isStreamingTui()) return
 forceRefresh()
 }
 }, delay)
 }

 const offPty = window.truedeck.onPtyData(({ id, data }) => {
 if (id !== sessionId) return
 if (data) {
 setAwaitingOutput(false)
 // First paint: Grok/Cursor alt-screen often lands before canvas has size
 scheduleIdleRefresh()
 if (!firstByteKicked) {
 firstByteKicked = true
 const cursor = isCursorAgent()
 // Post-first-byte WINCH - Cursor TUI frequently stays blank until this
 window.setTimeout(() => {
 fitAndResize(true)
 kickAgentTui('first-byte')
 forceRefresh()
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 }, 40)
 window.setTimeout(() => {
 fitAndResize(cursor)
 forceRefresh()
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 }, cursor ? 120 : 200)
 window.setTimeout(() => {
 forceRefresh()
 if (cursor) kickAgentTui('first-byte')
 }, cursor ? 350 : 600)
 if (cursor) {
 window.setTimeout(() => {
 fitAndResize(true)
 forceRefresh()
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 }, 900)
 }
 }
 }
 writeBuf += data
 if (rafId == null) rafId = requestAnimationFrame(flushWrites)
 scheduleIdleRefresh()
 })
 // Quiet CLI (shell / Cursor before first paint): drop awaiting flag soon and
 // kick once — no full-pane loading UI.
 const connectTimeout = window.setTimeout(() => {
 setAwaitingOutput(false)
 fitAndResize(true)
 kickAgentTui('blank')
 forceRefresh()
 try {
 term.focus()
 } catch {
 /* ignore */
 }
 if (isCursorAgent()) {
 ;[200, 600, 1400].forEach((ms) => {
 window.setTimeout(() => {
 if (!termRef.current) return
 kickAgentTui('blank')
 forceRefresh()
 try {
 termRef.current?.focus()
 } catch {
 /* ignore */
 }
 }, ms)
 })
 }
 }, isCursorAgent() ? 900 : 1200)

 /**
 * Wheel / scroll for agent TUIs (Grok Build model):
 * https://docs.x.ai/build/cli/terminal-support
 *
 * Grok owns scroll via mouse reporting. If the native scrollbar takes the
 * wheel, reporting effectively stops. We must:
 * 1) Hide/disable viewport scroll for agent TUIs
 * 2) Feed wheel to the app with the encoding it negotiated (via xterm core
 * mouse service → onData → PTY), with SGR fallback
 * 3) Never hand off to xterm scrollback for alt-screen / mouse modes
 */
 const wheelLines = (e: WheelEvent, el: HTMLElement): number => {
 const linePx =
 term.rows > 0 && el.clientHeight > 0 ? el.clientHeight / term.rows : 16
 if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
 return Math.trunc(e.deltaY) || Math.sign(e.deltaY)
 }
 if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
 return Math.trunc(e.deltaY * Math.max(1, term.rows)) || Math.sign(e.deltaY)
 }
 // Trackpads send small pixel deltas — still count as at least one notch
 const raw = e.deltaY / Math.max(4, linePx * 0.55)
 let lines = Math.round(raw)
 if (lines === 0 && Math.abs(e.deltaY) >= 1) lines = Math.sign(e.deltaY)
 return lines
 }

 /**
 * Deliver wheel to the TUI.
 * Grok: always write SGR wheel sequences to the PTY (custom scroll). Relying
 * only on xterm triggerMouseEvent was flaky — it can return true without the
 * app receiving usable reports after redraws.
 * Other mouse-mode apps: try core mouse first, SGR fallback if none sent.
 */
 const sendAppWheel = (e: WheelEvent, lines: number): void => {
 const notches = Math.min(8, Math.max(1, Math.abs(lines)))
 // CoreMouseAction: UP=0 DOWN=1; CoreMouseButton.WHEEL=4
 const action = lines < 0 ? 0 : 1
 let col = Math.max(0, Math.floor((term.cols || 80) / 2) - 1)
 let row = Math.max(0, Math.floor((term.rows || 24) / 2) - 1)

 const core = (
 term as unknown as {
 _core?: {
 coreMouseService?: {
 triggerMouseEvent: (ev: {
 col: number
 row: number
 x?: number
 y?: number
 button: number
 action: number
 ctrl?: boolean
 alt?: boolean
 shift?: boolean
 }) => boolean
 }
 _mouseService?: {
 getMouseReportCoords?: (
 ev: MouseEvent,
 el: HTMLElement
 ) => { col: number; row: number; x: number; y: number } | undefined
 }
 screenElement?: HTMLElement
 }
 }
 )._core

 try {
 const coords = core?._mouseService?.getMouseReportCoords?.(
 e,
 core.screenElement || term.element!
 )
 if (coords && Number.isFinite(coords.col) && Number.isFinite(coords.row)) {
 col = Math.max(0, Math.min((term.cols || 1) - 1, coords.col))
 row = Math.max(0, Math.min((term.rows || 1) - 1, coords.row))
 }
 } catch {
 /* ignore */
 }

 const directSgr = isCustomScrollTuiAgent()
 let reported = 0
 const cms = core?.coreMouseService
 // Grok: skip core mouse path (can swallow without useful PTY bytes)
 if (!directSgr && cms && typeof cms.triggerMouseEvent === 'function') {
 for (let i = 0; i < notches; i++) {
 try {
 if (
 cms.triggerMouseEvent({
 col,
 row,
 x: 0,
 y: 0,
 button: 4,
 action,
 ctrl: Boolean(e.ctrlKey),
 alt: Boolean(e.altKey),
 shift: false
 })
 ) {
 reported++
 }
 } catch {
 break
 }
 }
 }

 // SGR 1006 wheel: button 64 = up, 65 = down (Grok listens for these)
 if (reported === 0 || directSgr) {
 const button = lines < 0 ? 64 : 65
 const seq = `\x1b[<${button};${col + 1};${row + 1}M`
 void window.truedeck.writeSession(sessionId, seq.repeat(notches))
 }
 }

 // Debounce fit when TUI mouse ownership flips (Codex mode-set spam → jitter)
 let tuiOwnerFitTimer: number | null = null
 const markTuiWheelOwner = (owns: boolean): void => {
 if (agentTuiMouseRef.current === owns) return
 // Hysteresis: once the TUI owns the wheel, don't drop on one flaky mode probe
 // mid-stream (Codex toggles mouse/alt around redraws).
 if (!owns && agentTuiMouseRef.current && isStreamingTui()) return
 agentTuiMouseRef.current = owns
 setAgentTuiMouse(owns)
 // Hiding the classic scrollbar changes clientWidth; re-fit so cols use
 // the full pane (avoids a permanent black strip on the right).
 if (tuiOwnerFitTimer != null) window.clearTimeout(tuiOwnerFitTimer)
 tuiOwnerFitTimer = window.setTimeout(() => {
 tuiOwnerFitTimer = null
 if (closingRef.current) return
 fitAndResize(true)
 // Only one refresh after ownership settles — not every CSI
 if (!isStreamingTui()) forceRefresh()
 }, 100)
 }

 const onWheel = (e: WheelEvent): void => {
 if (!e.deltaY) return
 const el = hostRef.current || shellRef.current
 if (!el) return

 const tuiOwns = tuiOwnsWheel()
 markTuiWheelOwner(tuiOwns)

 const lines = wheelLines(e, el)
 if (!lines) return

 // Shift = host scrollback only (xterm buffer), never feed the app
 if (e.shiftKey) {
 e.preventDefault()
 e.stopPropagation()
 try {
 term.scrollLines(lines)
 syncStickFromViewport()
 forceRefresh()
 } catch {
 /* disposed */
 }
 return
 }

 if (tuiOwns) {
 // Kill native scrollbar / browser scroll so Grok/Codex mouse reporting works
 e.preventDefault()
 e.stopPropagation()
 // Manual TUI scroll pauses stick-to-bottom until user returns (or types)
 stickToBottom = false
 sendAppWheel(e, lines)
 return
 }

 // Normal shell buffer: xterm scrollback
 e.preventDefault()
 e.stopPropagation()
 try {
 const before = term.buffer.active.viewportY
 term.scrollLines(lines)
 if (term.buffer.active.viewportY !== before) forceRefresh()
 syncStickFromViewport()
 } catch {
 /* disposed */
 }
 }

 // xterm 5.3 has no attachCustomWheelEventHandler (added in later forks).
 // Calling a missing method threw mid-mount → no fit/WINCH cleanup → blank
 // panes after restore. Our capture-phase onWheel already owns the event.

 const onViewportScroll = (): void => {
 syncStickFromViewport()
 // Full refresh on every scroll event thrashes Codex mid-token paint
 if (!isStreamingTui()) forceRefresh()
 }

 /** Mark when the bar can actually move (buffer taller than the screen). */
 let lastScrollSyncAt = 0
 const syncScrollableClass = (fromRender = false): void => {
 // onRender fires every CSI paint — throttle so we don't flip classes/fit
 // on every streamed character (main Codex jitter source).
 if (fromRender) {
 const now = Date.now()
 if (now - lastScrollSyncAt < 120) return
 lastScrollSyncAt = now
 }
 const vp = hostRef.current?.querySelector('.xterm-viewport') as HTMLElement | null
 if (!vp) return
 try {
 const b = term.buffer.active
 const tuiOwns = tuiOwnsWheel()
 // Never show native scroll thumb when TUI owns mouse (steals the wheel)
 const canScroll =
 !tuiOwns &&
 b.type === 'normal' &&
 (b.baseY > 0 || b.length > term.rows)
 const was = vp.classList.contains('xterm-viewport-scrollable')
 vp.classList.toggle('xterm-viewport-scrollable', canScroll)
 markTuiWheelOwner(tuiOwns)
 // Bar shown/hidden changes available width - re-fit so no gap
 if (was !== canScroll) {
 if (tuiOwnerFitTimer != null) window.clearTimeout(tuiOwnerFitTimer)
 tuiOwnerFitTimer = window.setTimeout(() => {
 tuiOwnerFitTimer = null
 if (closingRef.current) return
 fitAndResize(true)
 if (!isStreamingTui()) forceRefresh()
 }, 100)
 }
 } catch {
 vp.classList.remove('xterm-viewport-scrollable')
 }
 }

 const hostEl = hostRef.current
 const wheelOpts: AddEventListenerOptions = { passive: false, capture: true }
 // Capture on host only (shell is parent — registering both double-fires)
 hostEl.addEventListener('wheel', onWheel, wheelOpts)
 const xtermEl = term.element
 const viewportEl = xtermEl?.querySelector('.xterm-viewport') as HTMLElement | null
 viewportEl?.addEventListener('scroll', onViewportScroll, { passive: true })
 const offScrollable = term.onRender(() => syncScrollableClass(true))
 const offScrollPos = term.onScroll(() => syncScrollableClass(false))
 // Only claim TUI wheel when mouse/alt actually active (syncScrollableClass updates this)
 syncScrollableClass(false)
 // Fit after layout settles (important when spawning into a new dock pane)
 const fitSoon = (): void => {
 requestAnimationFrame(() => {
 requestAnimationFrame(() => {
 fitAndResize()
 forceRefresh()
 })
 })
 }
 fitSoon()
 const t1 = window.setTimeout(fitSoon, 50)
 const t2 = window.setTimeout(fitSoon, 200)

 // Debounce fit — never thrash WINCH (Grok/Claude full redraw = jagged).
 // During pane anim / gutter drag: fully freeze (no fit, no refresh storm).
 let resizeTimer: number | null = null
 const ro = new ResizeObserver(() => {
 if (closingRef.current || isLayoutFrozen()) return
 if (resizeTimer != null) window.clearTimeout(resizeTimer)
 resizeTimer = window.setTimeout(() => {
 resizeTimer = null
 if (closingRef.current || isLayoutFrozen()) return
 fitAndResize()
 forceRefresh()
 }, 160)
 })
 ro.observe(hostRef.current)

 // Window focus / tab visibility - Electron sometimes freezes canvas layers
 const onWinFocus = (): void => {
 if (visibleRef.current) {
 fitAndResize()
 forceRefresh()
 }
 }
 const onDocVis = (): void => {
 if (document.visibilityState === 'visible' && visibleRef.current) {
 requestAnimationFrame(() => {
 fitAndResize()
 forceRefresh()
 })
 }
 }
 window.addEventListener('focus', onWinFocus)
 document.addEventListener('visibilitychange', onDocVis)

 return () => {
 window.clearTimeout(t1)
 window.clearTimeout(t2)
 if (resizeTimer != null) window.clearTimeout(resizeTimer)
 if (idleRefreshTimer != null) window.clearTimeout(idleRefreshTimer)
 if (tuiOwnerFitTimer != null) window.clearTimeout(tuiOwnerFitTimer)
 if (rafId != null) cancelAnimationFrame(rafId)
 // Flush any pending bytes before dispose so we don't drop the last frame
 if (writeBuf) {
 try {
 term.write(writeBuf)
 } catch {
 /* disposing */
 }
 writeBuf = ''
 }
 hostEl.removeEventListener('wheel', onWheel, wheelOpts)
 hostElForClip.removeEventListener('copy', onDomCopy)
 hostElForClip.removeEventListener('paste', onDomPaste, true)
 hostElForClip.removeEventListener('mouseup', onMouseUp)
 hostElForClip.removeEventListener('click', onPathClickCapture, true)
 if (helperTa) {
 helperTa.removeEventListener('paste', onDomPaste, true)
 }
 viewportEl?.removeEventListener('scroll', onViewportScroll)
 offScrollable.dispose()
 offScrollPos.dispose()
 window.removeEventListener('focus', onWinFocus)
 document.removeEventListener('visibilitychange', onDocVis)
 window.clearTimeout(connectTimeout)
 for (const t of kickTimers) window.clearTimeout(t)
 offPty()
 onData.dispose()
 onTitle.dispose()
 try {
 pathLinkDispose?.dispose()
 } catch {
 /* ignore */
 }
 ro.disconnect()
 term.dispose()
 termRef.current = null
 fitRef.current = null
 lastSizeRef.current = { cols: 0, rows: 0 }
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [sessionId, openPathsEnabled])

 // When a tab was hidden/minimized, Chromium freezes the canvas layer and the
 // host size often changed (split collapsed). Soft fit(false) skips WINCH if
 // cols/rows look unchanged → stale/blank agent TUIs. Force remeasure + repaint.
 const wasVisibleRef = useRef(visible)
 useEffect(() => {
 const becameVisible = visible && !wasVisibleRef.current
 wasVisibleRef.current = visible
 if (!visible) return

 const hard = becameVisible
 const restore = (): void => {
 if (hard) {
 // Ensure pushSize always sends WINCH after minimize/restore / pane collapse
 lastSizeRef.current = { cols: 0, rows: 0 }
 }
 fitAndResize(hard)
 forceRefresh()
 try {
 // Nudge xterm renderer after visibility:hidden
 const term = termRef.current
 const core = (
 term as unknown as {
 _core?: { _renderService?: { refreshRows?: (a: number, b: number) => void } }
 }
 )._core
 core?._renderService?.refreshRows?.(0, Math.max(0, (term?.rows || 1) - 1))
 } catch {
 /* ignore */
 }
 }

 requestAnimationFrame(() => {
 requestAnimationFrame(restore)
 })
 // Delayed passes: layout may still be settling after split collapse
 const t1 = window.setTimeout(restore, 50)
 const t2 = window.setTimeout(restore, 180)
 const t3 = window.setTimeout(() => {
 fitAndResize(true)
 forceRefresh()
 }, 400)
 return () => {
 window.clearTimeout(t1)
 window.clearTimeout(t2)
 window.clearTimeout(t3)
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [visible, sessionId])

 // Move DOM focus when this terminal becomes the app's focused pane.
 useEffect(() => {
 const term = termRef.current
 if (!term) return
 if (closing || inputLocked || !isFocused) {
 if (!closing) term.blur()
 return
 }
 const run = (): void => {
 if (closingRef.current || inputLockedRef.current) {
 if (!closingRef.current) termRef.current?.blur()
 return
 }
 termRef.current?.focus()
 fitAndResize(true)
 forceRefresh()
 }
 requestAnimationFrame(run)
 const t = window.setTimeout(run, 60)
 const t2 = window.setTimeout(() => {
 if (closingRef.current) return
 fitAndResize(true)
 forceRefresh()
 }, 200)
 return () => {
 window.clearTimeout(t)
 window.clearTimeout(t2)
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [isFocused, sessionId, inputLocked, closing])

 /**
 * After split/close/gutter motion: one hard fit + WINCH so the TUI lands clean
 * at the final size (instead of reflowing every animation frame).
 */
 useEffect(() => {
 if (!visible) return
 const settle = (): void => {
  if (closingRef.current || !termRef.current) return
  // Allow fit even if body class lags one frame
  lastSizeRef.current = { cols: 0, rows: 0 }
  fitAndResize(true)
  forceRefresh()
  try {
   kickAgentTui('manual')
  } catch {
   /* ignore */
  }
 }
 const onAnimEnd = (): void => {
  window.requestAnimationFrame(() => {
   window.requestAnimationFrame(settle)
  })
 }
 window.addEventListener('truedeck:pane-anim-end', onAnimEnd)
 return () => window.removeEventListener('truedeck:pane-anim-end', onAnimEnd)
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [visible, sessionId])

 // When palette/settings open, fully release keyboard from xterm (keep it released)
 useEffect(() => {
 if (!inputLocked) return
 const release = (): void => {
 try {
 termRef.current?.blur()
 const ta = hostRef.current?.querySelector(
 'textarea.xterm-helper-textarea'
 ) as HTMLTextAreaElement | null
 if (!ta) return
 ta.blur()
 ta.setAttribute('tabindex', '-1')
 // Disabled so browser focus / key delivery cannot land on the helper
 ta.disabled = true
 } catch {
 /* ignore */
 }
 }
 release()
 const timers = [0, 16, 50, 100, 200, 400].map((ms) => window.setTimeout(release, ms))
 return () => {
 for (const t of timers) window.clearTimeout(t)
 try {
 const ta = hostRef.current?.querySelector(
 'textarea.xterm-helper-textarea'
 ) as HTMLTextAreaElement | null
 if (ta) {
 ta.disabled = false
 ta.setAttribute('tabindex', '0')
 }
 } catch {
 /* ignore */
 }
 }
 }, [inputLocked])

 // Live font size updates from Settings without remounting the PTY
 useEffect(() => {
 const term = termRef.current
 if (!term) return
 term.options.fontSize = fontSize
 fitAndResize()
 forceRefresh()
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [fontSize, sessionId])

 return (
 <div
 className={`terminal-pane ${visible ? 'visible' : 'hidden'}${isFocused ? ' focused' : ''}${awaitingOutput ? ' connecting' : ''}${agentTuiMouse ? ' agent-tui-mouse' : ''}`}
 ref={shellRef}
 onMouseDown={() => {
 if (inputLockedRef.current) return
 // Focus immediately on press so keys go here even before React re-renders
 // after the parent marks this group focused.
 termRef.current?.focus()
 }}
 onClick={() => {
 if (inputLockedRef.current) return
 termRef.current?.focus()
 }}
 >
 {/* Dedicated host: React never mutates children here (keeps xterm canvas alive). */}
 <div className="terminal-xterm-host" ref={hostRef} />
 {/* No full-pane “Connecting…” veil — slow CLIs (Cursor) sat under a screen-sized
     overlay while Grok painted immediately. Status is only the empty xterm. */}
 {/* Full-pane open blast (not chrome) — covers the terminal on first open */}
 {introBlast && visible ? (
 <div className="terminal-intro-blast" aria-hidden>
 <PixelBlast
 color={sessionColor}
 opacity={0.65}
 active
 burstKey={sessionId}
 explosions={false}
 />
 </div>
 ) : null}
 </div>
 )
}
