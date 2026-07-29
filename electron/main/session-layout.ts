import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type {
 SavedPaneNode,
 SavedSessionTab,
 SessionInfo,
 SessionLayout
} from '../shared/types'
import { getSessionLayoutPath } from './paths'

/** Hard cap - never restore/persist more than this many tabs (prevents CLI storms). */
export const MAX_SAVED_TABS = 16

const EMPTY: SessionLayout = {
 version: 2,
 activeProjectRoot: null,
 activeIndex: 0,
 splitIndex: null,
 splitRatio: 0.5,
 tabs: [],
 paneTree: null,
 focusedGroupTabIndex: null,
 savedAt: 0
}

export function sanitizePaneTree(node: unknown): SavedPaneNode | null {
 if (!node || typeof node !== 'object') return null
 const n = node as SavedPaneNode
 if (n.type === 'leaf' && Array.isArray(n.tabIndices)) {
 return {
 type: 'leaf',
 tabIndices: n.tabIndices.filter((i) => typeof i === 'number' && i >= 0),
 activeTabIndex:
 typeof n.activeTabIndex === 'number' ? n.activeTabIndex : null
 }
 }
 if (n.type === 'split' && (n.direction === 'row' || n.direction === 'column')) {
 const first = sanitizePaneTree(n.first)
 const second = sanitizePaneTree(n.second)
 if (!first || !second) return first || second
 return {
 type: 'split',
 direction: n.direction,
 ratio:
 typeof n.ratio === 'number' && n.ratio > 0 && n.ratio < 1 ? n.ratio : 0.5,
 first,
 second
 }
 }
 return null
}

/**
 * Remap every tab index in a pane tree through old→new.
 * Drops leaves that lose all tabs; collapses splits with one live child.
 */
export function remapPaneTree(
 node: SavedPaneNode | null | undefined,
 indexMap: Map<number, number>
): SavedPaneNode | null {
 const sanitized = node ? sanitizePaneTree(node) : null
 if (!sanitized) return null
 const walk = (n: SavedPaneNode): SavedPaneNode | null => {
 if (n.type === 'leaf') {
 const tabIndices = n.tabIndices
 .map((i) => indexMap.get(i))
 .filter((i): i is number => typeof i === 'number')
 if (!tabIndices.length) return null
 const activeRaw =
 n.activeTabIndex != null ? indexMap.get(n.activeTabIndex) : undefined
 const active =
 typeof activeRaw === 'number' && tabIndices.includes(activeRaw)
 ? activeRaw
 : tabIndices[tabIndices.length - 1]
 return { type: 'leaf', tabIndices, activeTabIndex: active ?? null }
 }
 const first = walk(n.first)
 const second = walk(n.second)
 if (!first && !second) return null
 if (!first) return second
 if (!second) return first
 return {
 type: 'split',
 direction: n.direction,
 ratio: n.ratio,
 first,
 second
 }
 }
 return walk(sanitized)
}

/** Drop install-help noise, dedupe stacked onOpen commands, enforce MAX_SAVED_TABS. */
export function clampTabs(tabs: SavedSessionTab[]): SavedSessionTab[] {
 const cleaned = tabs.filter((t) => {
 if (!t?.projectRoot || !t.agentId) return false
 const name = (t.agentName || '').toLowerCase()
 const cmd = (t.commandLine || '').toLowerCase()
 // Install helper shells should not respawn on next launch
 if (name.includes('install') || cmd.includes('=== install')) return false
 return true
 })
 // Collapse identical command tabs (restore + onOpen used to stack Rojo/Shell to MAX)
 const seenCmd = new Set<string>()
 const deduped: SavedSessionTab[] = []
 for (const t of cleaned) {
 if (t.kind === 'command' || t.commandLine) {
 const key = `${t.projectRoot}\0${t.commandLine || ''}\0${t.agentId}`
 if (seenCmd.has(key)) continue
 seenCmd.add(key)
 }
 deduped.push(t)
 }
 if (deduped.length <= MAX_SAVED_TABS) return deduped
 // Prefer agent tabs over one-off command tabs when truncating
 const agents = deduped.filter((t) => t.kind !== 'command')
 const commands = deduped.filter((t) => t.kind === 'command')
 const preferred = [...agents, ...commands]
 return preferred.slice(0, MAX_SAVED_TABS)
}

/** Collect every tab index referenced by a pane tree (preorder). */
export function collectTreeIndices(node: SavedPaneNode | null | undefined): number[] {
 if (!node) return []
 if (node.type === 'leaf') {
 const ids = [...node.tabIndices]
 if (typeof node.activeTabIndex === 'number') ids.push(node.activeTabIndex)
 return ids
 }
 return [...collectTreeIndices(node.first), ...collectTreeIndices(node.second)]
}

/**
 * Keep only tabs the pane tree references, in first-seen order, and remap indices.
 * Drops zombie tabs that restore+onOpen used to stack outside the studio layout.
 */
export function compactTabsToPaneTree(
 tabs: SavedSessionTab[],
 tree: SavedPaneNode | null | undefined
): {
 tabs: SavedSessionTab[]
 paneTree: SavedPaneNode | null
 /** old tab index → new tab index after compact */
 indexMap: Map<number, number>
} {
 const sanitized = tree ? sanitizePaneTree(tree) : null
 if (!sanitized || !tabs.length) {
 const clamped = clampTabs(tabs)
 const indexMap = new Map<number, number>()
 // Best-effort identity for tabs that survived clamp (order may shift on dedupe)
 let ni = 0
 const seen = new Set<string>()
 tabs.forEach((t, oi) => {
 if (!t?.projectRoot || !t.agentId) return
 const name = (t.agentName || '').toLowerCase()
 const cmd = (t.commandLine || '').toLowerCase()
 if (name.includes('install') || cmd.includes('=== install')) return
 if (t.kind === 'command' || t.commandLine) {
 const key = `${t.projectRoot}\0${t.commandLine || ''}\0${t.agentId}`
 if (seen.has(key)) return
 seen.add(key)
 }
 if (ni < clamped.length && ni < MAX_SAVED_TABS) {
 indexMap.set(oi, ni)
 ni++
 }
 })
 return { tabs: clamped, paneTree: sanitized, indexMap }
 }
 const used: number[] = []
 const seen = new Set<number>()
 for (const i of collectTreeIndices(sanitized)) {
 if (typeof i !== 'number' || i < 0 || i >= tabs.length || seen.has(i)) continue
 seen.add(i)
 used.push(i)
 }
 // If tree referenced nothing valid, fall back to clamped full list
 if (!used.length) {
 const clamped = clampTabs(tabs)
 return { tabs: clamped, paneTree: sanitized, indexMap: new Map() }
 }
 const indexMap = new Map<number, number>()
 used.forEach((old, neu) => indexMap.set(old, neu))
 // Do not clampTabs-dedupe here - two shells in two panes must both survive
 const nextTabs = used
 .map((i) => tabs[i])
 .filter(Boolean)
 .slice(0, MAX_SAVED_TABS)
 return {
 tabs: nextTabs,
 paneTree: remapPaneTree(sanitized, indexMap),
 indexMap
 }
}

export function loadSessionLayout(): SessionLayout {
 try {
 const p = getSessionLayoutPath()
 if (!existsSync(p)) return { ...EMPTY }
 const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<SessionLayout>
 if (!raw || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.tabs)) {
 return { ...EMPTY }
 }
 const tabs = clampTabs(
 raw.tabs
 .filter((t): t is SavedSessionTab => Boolean(t && t.projectRoot && t.agentId))
 .map((t) => ({
 agentId: String(t.agentId),
 agentName: String(t.agentName || t.agentId),
 projectRoot: String(t.projectRoot),
 color: String(t.color || '#6cb6ff'),
 kind: t.kind === 'command' ? 'command' : 'agent',
 commandLine: t.commandLine ? String(t.commandLine) : undefined
 }))
 )
 const paneTree = sanitizePaneTree(raw.paneTree)
 const compact = compactTabsToPaneTree(tabs, paneTree)
 const activeRaw = typeof raw.activeIndex === 'number' ? raw.activeIndex : 0
 const focusRaw =
 typeof raw.focusedGroupTabIndex === 'number' ? raw.focusedGroupTabIndex : null
 const activeIndex =
 compact.indexMap.get(activeRaw) ??
 Math.min(activeRaw, Math.max(0, compact.tabs.length - 1))
 const focusedGroupTabIndex =
 focusRaw != null ? (compact.indexMap.get(focusRaw) ?? null) : null
 const fixed: SessionLayout = {
 version: 2,
 activeProjectRoot: raw.activeProjectRoot ?? null,
 activeIndex: Math.min(activeIndex, Math.max(0, compact.tabs.length - 1)),
 splitIndex:
 typeof raw.splitIndex === 'number' && compact.tabs.length >= 2
 ? Math.min(
 compact.indexMap.get(raw.splitIndex) ?? raw.splitIndex,
 compact.tabs.length - 1
 )
 : null,
 splitRatio:
 typeof raw.splitRatio === 'number' && raw.splitRatio > 0 && raw.splitRatio < 1
 ? raw.splitRatio
 : 0.5,
 tabs: compact.tabs,
 paneTree: compact.paneTree,
 focusedGroupTabIndex,
 savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0
 }
 // Rewrite bloated / desynced disk layouts immediately
 if (
 (Array.isArray(raw.tabs) && raw.tabs.length > compact.tabs.length) ||
 (focusRaw != null && focusedGroupTabIndex !== focusRaw)
 ) {
 try {
 saveSessionLayout(fixed)
 } catch {
 // ignore rewrite failures
 }
 }
 return fixed
 } catch {
 return { ...EMPTY }
 }
}

export function saveSessionLayout(layout: SessionLayout): SessionLayout {
 const rawTabs = layout.tabs || []
 const compact = compactTabsToPaneTree(rawTabs, layout.paneTree ?? null)
 const tabs = compact.tabs
 const map = compact.indexMap

 const mapIndex = (i: number | null | undefined): number | null => {
 if (i == null || typeof i !== 'number' || i < 0) return null
 if (map.has(i)) return map.get(i)!
 // If compact kept identity order, clamp
 if (i < tabs.length) return i
 return tabs.length ? Math.min(i, tabs.length - 1) : null
 }

 const activeMapped = mapIndex(layout.activeIndex)
 const focusMapped = mapIndex(layout.focusedGroupTabIndex ?? null)
 const splitMapped = mapIndex(layout.splitIndex ?? null)

 const next: SessionLayout = {
 version: 2,
 activeProjectRoot: layout.activeProjectRoot ?? null,
 activeIndex: activeMapped ?? 0,
 splitIndex:
 splitMapped != null && tabs.length >= 2 && splitMapped !== activeMapped
 ? splitMapped
 : null,
 splitRatio:
 typeof layout.splitRatio === 'number' && layout.splitRatio > 0 && layout.splitRatio < 1
 ? layout.splitRatio
 : 0.5,
 tabs: tabs.map((t) => ({
 agentId: t.agentId,
 agentName: t.agentName,
 projectRoot: t.projectRoot,
 color: t.color,
 kind: t.kind === 'command' ? 'command' : 'agent',
 commandLine: t.commandLine
 })),
 paneTree: compact.paneTree,
 focusedGroupTabIndex: focusMapped,
 savedAt: Date.now()
 }
 const path = getSessionLayoutPath()
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
 return next
}

export function sessionInfoToSavedTab(s: SessionInfo): SavedSessionTab {
 return {
 agentId: s.agentId,
 agentName: s.agentName,
 projectRoot: s.projectRoot,
 color: s.color,
 kind: s.kind === 'command' || s.commandLine ? 'command' : 'agent',
 commandLine: s.commandLine
 }
}

/** Normalize folder roots so Windows path casing / slashes still match. */
export function sameProjectRoot(
 a: string | null | undefined,
 b: string | null | undefined
): boolean {
 if (!a || !b) return false
 const norm = (p: string): string =>
 p.replace(/\//g, '\\').replace(/[\\/]+$/, '').toLowerCase()
 return norm(a) === norm(b)
}

function normalizeCmdKey(s: string): string {
 return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * True if a live PTY already covers this on-open / restored command tab
 * (same project + same command line or same label). Used so openProject and
 * restore never stack another Rojo Serve / Shell when one is still running.
 */
export function isCommandSessionRunning(
 live: SessionInfo[],
 projectRoot: string,
 opts: { command?: string | null; label?: string | null; agentId?: string | null }
): boolean {
 const wantCmd = opts.command ? normalizeCmdKey(opts.command) : ''
 const wantLabel = opts.label ? normalizeCmdKey(opts.label) : ''
 const wantAgent = opts.agentId ? normalizeCmdKey(opts.agentId) : ''
 return live.some((s) => {
 if (s.status !== 'running') return false
 if (!sameProjectRoot(s.projectRoot, projectRoot)) return false
 const line = s.commandLine ? normalizeCmdKey(s.commandLine) : ''
 if (wantCmd && line && line === wantCmd) return true
 const name = s.agentName ? normalizeCmdKey(s.agentName) : ''
 if (wantLabel && name && name === wantLabel) return true
 const aid = s.agentId ? normalizeCmdKey(s.agentId) : ''
 if (wantLabel && aid && (aid === wantLabel || aid === `cmd-${wantLabel}`)) return true
 if (wantAgent && aid && aid === wantAgent) return true
 // Command panes only - don't treat a coding agent as "rojo serve"
 if (wantCmd && s.kind === 'command' && name && wantLabel && name === wantLabel) return true
 return false
 })
}

/** True if a non-command agent tab (e.g. shell) is already running in this project. */
export function isAgentSessionRunning(
 live: SessionInfo[],
 projectRoot: string,
 agentId: string
): boolean {
 const want = normalizeCmdKey(agentId)
 return live.some(
 (s) =>
 s.status === 'running' &&
 sameProjectRoot(s.projectRoot, projectRoot) &&
 s.kind !== 'command' &&
 normalizeCmdKey(s.agentId) === want
 )
}

/** Snapshot payload from the renderer (async or sync persist). */
export type PersistSnapshot = {
 activeProjectRoot: string | null
 activeSessionId: string | null
 splitSessionId: string | null
 splitRatio?: number
 /** Live PTY ids in pane-tree preorder (preferred source of order). */
 sessionOrder?: string[]
 /**
 * Tab metadata aligned with sessionOrder indices. When provided, disk tabs
 * are taken from here (not re-derived only from ptyManager order).
 */
 tabs?: SavedSessionTab[]
 paneTree?: SessionLayout['paneTree']
 focusedGroupTabIndex?: number | null
}

/**
 * Build a SessionLayout from a renderer snapshot + currently live PTYs.
 * Trusts sessionOrder / tabs from the UI so multi-pane indices stay aligned.
 * Does **not** append orphan live PTYs (that used to desync paneTree indices).
 *
 * Important: when `truedeck-backend` owns PTYs, `live` from ptyManager alone is
 * often empty/partial. Renderer `tabs[]` (already filtered to running) is then
 * the source of truth - requiring a live match used to wipe every tab + paneTree.
 */
export function layoutFromPersistSnapshot(
 snapshot: PersistSnapshot,
 live: SessionInfo[]
): SessionLayout {
 const byId = new Map(live.map((s) => [s.id, s]))
 const order = snapshot.sessionOrder?.length ? snapshot.sessionOrder : live.map((s) => s.id)
 const meta = snapshot.tabs || []
 const hasMeta = meta.length > 0

 const keptIds: string[] = []
 const tabs: SavedSessionTab[] = []
 const oldToNew = new Map<number, number>()

 for (let i = 0; i < order.length; i++) {
 if (tabs.length >= MAX_SAVED_TABS) break
 const id = order[i]
 const s = byId.get(id)
 // Known exited in live list → skip (don't resurrect dead tabs)
 if (s && s.status !== 'running') continue

 const fromMeta = meta[i]
 let tab: SavedSessionTab | null = null
 if (fromMeta && fromMeta.projectRoot && fromMeta.agentId) {
 // Renderer already filtered to running; do not require ptyManager match
 // (Rust-backend sessions are invisible to ptyManager.list()).
 tab = {
 agentId: String(fromMeta.agentId),
 agentName: String(fromMeta.agentName || fromMeta.agentId),
 projectRoot: String(fromMeta.projectRoot),
 color: String(fromMeta.color || s?.color || '#6cb6ff'),
 kind: fromMeta.kind === 'command' || fromMeta.commandLine ? 'command' : 'agent',
 commandLine: fromMeta.commandLine
 ? String(fromMeta.commandLine)
 : s?.commandLine
 }
 } else if (s && s.status === 'running') {
 tab = sessionInfoToSavedTab(s)
 }
 if (!tab) continue
 oldToNew.set(i, tabs.length)
 tabs.push(tab)
 keptIds.push(id)
 }

 // Order missing but tabs[] present (defensive) - still persist multi-pane indices
 if (!tabs.length && hasMeta) {
 for (let i = 0; i < meta.length && tabs.length < MAX_SAVED_TABS; i++) {
 const fromMeta = meta[i]
 if (!fromMeta?.projectRoot || !fromMeta.agentId) continue
 oldToNew.set(i, tabs.length)
 tabs.push({
 agentId: String(fromMeta.agentId),
 agentName: String(fromMeta.agentName || fromMeta.agentId),
 projectRoot: String(fromMeta.projectRoot),
 color: String(fromMeta.color || '#6cb6ff'),
 kind: fromMeta.kind === 'command' || fromMeta.commandLine ? 'command' : 'agent',
 commandLine: fromMeta.commandLine ? String(fromMeta.commandLine) : undefined
 })
 keptIds.push(snapshot.sessionOrder?.[i] || `meta-${i}`)
 }
 }

 // Remap pane tree through sessions that were still alive
 let paneTree = snapshot.paneTree
 ? remapPaneTree(sanitizePaneTree(snapshot.paneTree), oldToNew)
 : null

 // If no tree (or all leaves dropped), synthesize a single group in order
 if (!paneTree && tabs.length) {
 paneTree = {
 type: 'leaf',
 tabIndices: tabs.map((_, i) => i),
 activeTabIndex: Math.max(0, tabs.length - 1)
 }
 }

 const activeId = snapshot.activeSessionId
 let activeIndex = activeId ? keptIds.indexOf(activeId) : -1
 if (activeIndex < 0 && typeof snapshot.focusedGroupTabIndex === 'number') {
 activeIndex = oldToNew.get(snapshot.focusedGroupTabIndex) ?? -1
 }
 if (activeIndex < 0) activeIndex = 0

 let splitIndex: number | null = null
 if (snapshot.splitSessionId) {
 const si = keptIds.indexOf(snapshot.splitSessionId)
 splitIndex = si >= 0 && si !== activeIndex ? si : null
 }

 return {
 version: 2,
 activeProjectRoot: snapshot.activeProjectRoot,
 activeIndex: Math.min(Math.max(0, activeIndex), Math.max(0, tabs.length - 1)),
 splitIndex,
 splitRatio:
 typeof snapshot.splitRatio === 'number' &&
 snapshot.splitRatio > 0 &&
 snapshot.splitRatio < 1
 ? snapshot.splitRatio
 : 0.5,
 tabs,
 paneTree,
 focusedGroupTabIndex: activeIndex,
 savedAt: Date.now()
 }
}

/** Merge live PTY list into the last layout (keeps active/split indices when possible). */
export function layoutFromLiveSessions(
 sessions: SessionInfo[],
 prev?: SessionLayout | null
): SessionLayout {
 const base = prev || loadSessionLayout()
 const running = sessions.filter((s) => s.status === 'running')
 return {
 version: 2,
 activeProjectRoot: base.activeProjectRoot,
 activeIndex: Math.min(base.activeIndex, Math.max(0, running.length - 1)),
 splitIndex:
 base.splitIndex === null
 ? null
 : running.length < 2
 ? null
 : Math.min(base.splitIndex, running.length - 1),
 splitRatio: base.splitRatio,
 tabs: running.map(sessionInfoToSavedTab),
 // Keep tree only if tab count still matches (indices would otherwise desync)
 paneTree:
 base.paneTree && (base.tabs?.length || 0) === running.length ? base.paneTree : null,
 focusedGroupTabIndex: base.focusedGroupTabIndex ?? null,
 savedAt: Date.now()
 }
}
