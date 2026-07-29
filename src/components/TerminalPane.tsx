import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useDeck } from '../store'
import { sanitizeSessionTitle } from '../lib/session-label'
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
 fontSize = 13
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

 const pushSize = (term: Terminal, force = false): void => {
 const cols = Math.max(20, term.cols || 80)
 const rows = Math.max(8, term.rows || 24)
 const prev = lastSizeRef.current
 if (!force && prev.cols === cols && prev.rows === rows) return
 lastSizeRef.current = { cols, rows }
 void window.truedeck.resizeSession(sessionId, cols, rows, force)
 }

 const fitAndResize = (force = false): void => {
 const term = termRef.current
 const fit = fitRef.current
 const host = hostRef.current
 if (!term || !fit || !host) return
 // Skip fit when host has no box yet (still mounting)
 if (host.clientWidth < 8 || host.clientHeight < 8) return
 try {
 fit.fit()
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
 const kickAgentTui = (reason: 'mount' | 'first-byte' | 'blank' | 'manual' = 'manual'): void => {
 const term = termRef.current
 const host = hostRef.current
 if (!term) return
 // Host still collapsing (connecting overlay / split) - wait for a real box
 if (host && (host.clientWidth < 8 || host.clientHeight < 8)) return
 const now = Date.now()
 // Tab switches used to re-kick every time → Grok flicker. Cooldown unless blank.
 if (reason !== 'blank' && reason !== 'first-byte' && now - lastKickAtRef.current < 2500) {
 try {
 fitRef.current?.fit()
 } catch {
 /* ignore */
 }
 pushSize(term, false)
 forceRefresh()
 return
 }
 lastKickAtRef.current = now
 try {
 fitRef.current?.fit()
 } catch {
 /* ignore */
 }
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
 // Cursor TUI often needs a second paint
 requestAnimationFrame(() => forceRefresh())
 }, 50)
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
 background: '#05070a',
 foreground: '#e2e8f0',
 cursor: '#22d3ee',
 selectionBackground: '#22d3ee44',
 black: '#0f172a',
 red: '#f87171',
 green: '#34d399',
 yellow: '#fbbf24',
 blue: '#60a5fa',
 magenta: '#c084fc',
 cyan: '#22d3ee',
 white: '#e2e8f0'
 },
 allowProposedApi: true,
 scrollback: 5000,
 // Agent TUIs speak full VT; windowsMode (legacy console) causes cut/glitch on redraw
 convertEol: false,
 windowsMode: false,
 // Draw all rows each paint - less partial-frame sticky garbage on ConPTY redraws
 drawBoldTextInBrightColors: true
 })
 const fit = new FitAddon()
 term.loadAddon(fit)
 term.loadAddon(new WebLinksAddon())
 // Only ever open into the dedicated empty host - never the shell with React kids
 term.open(host)
 termRef.current = term
 fitRef.current = fit
 // Immediate fit + staged WINCH kicks only on mount (Cursor Agent is slow on ConPTY).
 // Later tab switches use soft fit/refresh only — see visible/focused effects.
 requestAnimationFrame(() => {
 fitAndResize(true)
 forceRefresh()
 kickAgentTui('mount')
 })
 const kickTimers = [80, 200, 400, 800, 1400, 2200, 3500].map((ms) =>
 window.setTimeout(() => {
 if (!termRef.current) return
 // Soft fit after first kick; only re-kick early in mount window
 if (ms <= 400) kickAgentTui('mount')
 else {
 fitAndResize(false)
 forceRefresh()
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

 // Never let xterm eat TrueDeck app shortcuts.
 // Ctrl+A left for the terminal (select-all / agent TUI).
 // Ctrl+D = vertical split · Ctrl+X = horizontal split · Ctrl+Arrow = move between panes.
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

 term.attachCustomKeyEventHandler((ev) => {
 if (ev.type !== 'keydown') return true
 const ctrl = ev.ctrlKey || ev.metaKey

 // Ctrl+Arrow → never send to PTY (main before-input + App shortcuts own this)
 if (ctrl && isArrowKey(ev)) {
 return blockEvent(ev)
 }
 // Also block when only meta (mac) - same as ctrl above already covers metaKey
 if (ctrl && (ev.key === 'Tab' || ev.code === 'Tab')) {
 return blockEvent(ev)
 }

 // ── Scrollback keys (no Ctrl - Ctrl+Arrow is pane focus) ────────────
 if (!ctrl && !ev.altKey) {
 if (ev.key === 'PageUp' || ev.code === 'PageUp') {
 term.scrollPages(-1)
 forceRefresh()
 return blockEvent(ev)
 }
 if (ev.key === 'PageDown' || ev.code === 'PageDown') {
 term.scrollPages(1)
 forceRefresh()
 return blockEvent(ev)
 }
 // Shift+↑/↓ always scroll; bare ↑/↓ scroll only while in history so
 // agents/shells still get arrows when you're at the live prompt.
 if (
 (ev.key === 'ArrowUp' || ev.code === 'ArrowUp') &&
 (ev.shiftKey || isScrolledUp())
 ) {
 term.scrollLines(ev.shiftKey ? -5 : -1)
 forceRefresh()
 return blockEvent(ev)
 }
 if (
 (ev.key === 'ArrowDown' || ev.code === 'ArrowDown') &&
 (ev.shiftKey || isScrolledUp())
 ) {
 term.scrollLines(ev.shiftKey ? 5 : 1)
 forceRefresh()
 return blockEvent(ev)
 }
 if ((ev.key === 'Home' || ev.code === 'Home') && ev.shiftKey) {
 term.scrollToTop()
 forceRefresh()
 return blockEvent(ev)
 }
 if ((ev.key === 'End' || ev.code === 'End') && ev.shiftKey) {
 term.scrollToBottom()
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
 // Font zoom: Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 — never send to PTY
 const zoomCode =
 ev.code === 'Equal' ||
 ev.code === 'Minus' ||
 ev.code === 'NumpadAdd' ||
 ev.code === 'NumpadSubtract' ||
 ev.code === 'Digit0' ||
 ev.code === 'Numpad0'
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
 // Split: Ctrl+D vertical · Ctrl+X horizontal · Ctrl+Alt+D/X merge
 if (k === 'd' || k === 'x') return blockEvent(ev)
 if (ev.altKey || ev.shiftKey) {
 // Ctrl+Shift+= still zoom-in on some layouts; already blocked above via code
 return true
 }
 if (['o', 'w', 's', 't', 'n', 'b'].includes(k)) return blockEvent(ev)
 if (k >= '1' && k <= '9') return blockEvent(ev)
 return true
 })

 // Capture first user prompt line as session title when CLI never sets OSC title.
 // Never promote paths or secret-looking strings (e.g. Cursor API keys) into the header.
 let lineBuf = ''
 let capturedFirstLine = false
 const onData = term.onData((data) => {
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
 // If more arrived while the parser was busy, schedule another flush
 if (writeBuf && rafId == null) {
 rafId = requestAnimationFrame(flushWrites)
 }
 })
 }

 const scheduleIdleRefresh = (): void => {
 if (idleRefreshTimer != null) window.clearTimeout(idleRefreshTimer)
 idleRefreshTimer = window.setTimeout(() => {
 idleRefreshTimer = null
 // Only refresh when quiet - mid-stream refresh can fight the agent
 if (!writeBuf && !writing && rafId == null) {
 forceRefresh()
 }
 }, 48)
 }

 const offPty = window.truedeck.onPtyData(({ id, data }) => {
 if (id !== sessionId) return
 if (data) {
 setAwaitingOutput(false)
 // First paint: Grok/Cursor alt-screen often lands before canvas has size
 scheduleIdleRefresh()
 if (!firstByteKicked) {
 firstByteKicked = true
 // Post-first-byte WINCH - Cursor TUI frequently stays blank until this
 window.setTimeout(() => {
 fitAndResize(true)
 kickAgentTui('first-byte')
 forceRefresh()
 }, 40)
 window.setTimeout(() => {
 fitAndResize(false)
 forceRefresh()
 }, 200)
 window.setTimeout(() => {
 forceRefresh()
 }, 600)
 }
 }
 writeBuf += data
 if (rafId == null) rafId = requestAnimationFrame(flushWrites)
 scheduleIdleRefresh()
 })
 // Don't leave the spinner forever if the CLI is quiet (shell prompt, etc.)
 const connectTimeout = window.setTimeout(() => {
 setAwaitingOutput(false)
 fitAndResize(true)
 // Quiet shell / stuck spinner - one gentle kick if still empty-looking
 kickAgentTui('blank')
 forceRefresh()
 }, 2200)

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

 const isAgentCliSession = (): boolean => {
 try {
 const s = useDeck.getState().sessions.find((x) => x.id === sessionId)
 if (!s) return false
 if (s.kind === 'agent') return true
 const id = (s.agentId || '').toLowerCase()
 return ['grok', 'claude', 'codex', 'cursor', 'gemini', 'aider'].includes(id)
 } catch {
 return false
 }
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
 coreMouseService?: { areMouseEventsActive?: boolean }
 }
 }
 )._core
 const active = core?.coreMouseService?.areMouseEventsActive
 if (typeof active === 'function' ? active.call(core.coreMouseService) : active) {
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

 /**
 * Deliver wheel to the TUI using xterm's negotiated mouse encoding when
 * possible (correct for Grok), else raw SGR 64/65 to the PTY.
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

 let reported = 0
 const cms = core?.coreMouseService
 if (cms && typeof cms.triggerMouseEvent === 'function') {
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

 // Always also push SGR when core mouse did not accept (protocol none /
 // detection lag). Grok's custom scroll listens for these.
 if (reported === 0) {
 const button = lines < 0 ? 64 : 65
 const seq = `\x1b[<${button};${col + 1};${row + 1}M`
 void window.truedeck.writeSession(sessionId, seq.repeat(notches))
 }
 }

 const markTuiWheelOwner = (owns: boolean): void => {
 if (agentTuiMouseRef.current === owns) return
 agentTuiMouseRef.current = owns
 setAgentTuiMouse(owns)
 }

 const onWheel = (e: WheelEvent): void => {
 if (!e.deltaY) return
 const el = hostRef.current || shellRef.current
 if (!el) return

 const mouseOn = isMouseTrackingOn()
 const isAlt = isAltScreen()
 const isAgent = isAgentCliSession()
 // Grok / agent TUIs: app owns the wheel (built-in TUI scroll)
 const tuiOwns = mouseOn || isAlt || isAgent
 markTuiWheelOwner(tuiOwns)

 const lines = wheelLines(e, el)
 if (!lines) return

 // Shift = host scrollback only (xterm buffer), never feed the app
 if (e.shiftKey) {
 e.preventDefault()
 e.stopPropagation()
 try {
 term.scrollLines(lines)
 forceRefresh()
 } catch {
 /* disposed */
 }
 return
 }

 if (tuiOwns) {
 // Kill native scrollbar / browser scroll so Grok mouse reporting works
 e.preventDefault()
 e.stopPropagation()
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
 } catch {
 /* disposed */
 }
 }

 // xterm 5.3 has no attachCustomWheelEventHandler (added in later forks).
 // Calling a missing method threw mid-mount → no fit/WINCH cleanup → blank
 // panes after restore. Our capture-phase onWheel already owns the event.

 const onViewportScroll = (): void => {
 forceRefresh()
 }

 /** Mark when the bar can actually move (buffer taller than the screen). */
 const syncScrollableClass = (): void => {
 const vp = hostRef.current?.querySelector('.xterm-viewport') as HTMLElement | null
 if (!vp) return
 try {
 const b = term.buffer.active
 const mouseOn = isMouseTrackingOn()
 const isAlt = b.type === 'alternate'
 const isAgent = isAgentCliSession()
 const tuiOwns = mouseOn || isAlt || isAgent
 // Never show native scroll thumb for agent TUI (Grok) - it steals the wheel
 const canScroll =
 !tuiOwns &&
 b.type === 'normal' &&
 (b.baseY > 0 || b.length > term.rows)
 vp.classList.toggle('xterm-viewport-scrollable', canScroll)
 markTuiWheelOwner(tuiOwns)
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
 const offScrollable = term.onRender(() => syncScrollableClass())
 const offScrollPos = term.onScroll(() => syncScrollableClass())
 // Agent CLIs start as TUI owners immediately (don't wait for first CSI)
 if (isAgentCliSession()) markTuiWheelOwner(true)
 syncScrollableClass()
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

 // Debounce fit - thrashing resizeSession makes agent TUIs clear/redraw and "cut" text
 let resizeTimer: number | null = null
 const ro = new ResizeObserver(() => {
 if (resizeTimer != null) window.clearTimeout(resizeTimer)
 resizeTimer = window.setTimeout(() => {
 resizeTimer = null
 fitAndResize()
 // After size settle, repaint so the agent frame isn't half-cleared
 forceRefresh()
 }, 140)
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
 ro.disconnect()
 term.dispose()
 termRef.current = null
 fitRef.current = null
 lastSizeRef.current = { cols: 0, rows: 0 }
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [sessionId])

 // Soft restore when this tab becomes visible again.
 // Never kickAgentTui here — WINCH thrash made Grok flicker on every switch.
 useEffect(() => {
 if (!visible) return
 const soft = (): void => {
 fitAndResize(false)
 forceRefresh()
 }
 requestAnimationFrame(soft)
 // One delayed canvas repaint (Chromium sometimes freezes hidden layers)
 const t1 = window.setTimeout(soft, 48)
 return () => {
 window.clearTimeout(t1)
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [visible, sessionId])

 // Move DOM focus when this terminal becomes the app's focused pane.
 // Without this, Ctrl+Arrow / click-to-switch-pane updates layout state but
 // keystrokes keep going to the previous xterm textarea.
 useEffect(() => {
 const term = termRef.current
 if (!term) return
 if (isFocused) {
 const run = (): void => {
 termRef.current?.focus()
 // Size usually unchanged when switching panes — avoid force WINCH
 fitAndResize(false)
 forceRefresh()
 }
 requestAnimationFrame(run)
 const t = window.setTimeout(run, 40)
 return () => {
 window.clearTimeout(t)
 }
 }
 term.blur()
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [isFocused, sessionId])

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
 // Focus immediately on press so keys go here even before React re-renders
 // after the parent marks this group focused.
 termRef.current?.focus()
 }}
 onClick={() => termRef.current?.focus()}
 >
 {/* Dedicated host: React never mutates children here (keeps xterm canvas alive). */}
 <div className="terminal-xterm-host" ref={hostRef} />
 {awaitingOutput && visible ? (
 <div className="terminal-connecting" role="status" aria-live="polite">
 <div className="terminal-connecting-card">
 <span className="stage-loading-spinner" aria-hidden />
 <span>Connecting terminal…</span>
 <div className="stage-loading-rule" aria-hidden />
 </div>
 </div>
 ) : null}
 </div>
 )
}
