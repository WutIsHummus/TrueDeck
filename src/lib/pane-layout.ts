/**
 * Nested multi-pane layout (Roblox Studio / VS Code docking).
 *
 * Dropping a tab on a specific pane splits or joins **only that pane**.
 * Other panes keep their arrangement and sizes.
 */

export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** BridgeSpace-class grid: up to 16 agent panes. Soft-warn in UI above 12. */
export const MAX_PANES = 16
/** Soft warning threshold for machine load. */
export const PANE_WARN_THRESHOLD = 12

export interface PaneGroup {
 id: string
 sessionIds: string[]
 activeSessionId: string | null
}

/** Binary tree: leaves are tab groups; splits nest independently. */
export type LayoutNode =
 | { type: 'leaf'; group: PaneGroup }
 | {
 type: 'split'
 id: string
 direction: 'row' | 'column'
 /** Fraction of the first child along the split axis (0.08-0.92). */
 ratio: number
 first: LayoutNode
 second: LayoutNode
 }

export interface PaneLayout {
 root: LayoutNode
 focusedGroupId: string
}

/** @deprecated flat-compat: prefer listGroups(layout) */
export type FlatCompat = {
 groups: PaneGroup[]
 direction: 'row' | 'column'
 ratios: number[]
}

let _gid = 0
function gid(prefix = 'g'): string {
 _gid += 1
 return `${prefix}${_gid}`
}

function makeGroup(sessionIds: string[], active?: string | null): PaneGroup {
 const ids = [...sessionIds]
 const activeSessionId =
 active && ids.includes(active) ? active : ids[ids.length - 1] || null
 return { id: gid('g'), sessionIds: ids, activeSessionId }
}

function leaf(group: PaneGroup): LayoutNode {
 return { type: 'leaf', group }
}

function split(
 direction: 'row' | 'column',
 first: LayoutNode,
 second: LayoutNode,
 ratio = 0.5
): LayoutNode {
 return {
 type: 'split',
 id: gid('s'),
 direction,
 ratio: clampRatio(ratio),
 first,
 second
 }
}

function clampRatio(r: number): number {
 if (!Number.isFinite(r)) return 0.5
 return Math.min(0.92, Math.max(0.08, r))
}

// ── Tree walks ──────────────────────────────────────────────────────────────

export function listGroups(layout: PaneLayout): PaneGroup[] {
 const normalized = layout.root ? layout : normalizeLayout(layout)
 const out: PaneGroup[] = []
 walk(normalized.root, (n) => {
 if (n.type === 'leaf') out.push(n.group)
 })
 return out
}

/** Flat list for callers that still use layout.groups */
export function getGroups(layout: PaneLayout): PaneGroup[] {
 return listGroups(layout)
}

function walk(node: LayoutNode, fn: (n: LayoutNode) => void): void {
 fn(node)
 if (node.type === 'split') {
 walk(node.first, fn)
 walk(node.second, fn)
 }
}

export function countLeaves(layout: PaneLayout): number {
 let n = 0
 walk(layout.root, (node) => {
 if (node.type === 'leaf') n += 1
 })
 return n
}

export function findGroup(layout: PaneLayout, sessionId: string): PaneGroup | null {
 return listGroups(layout).find((g) => g.sessionIds.includes(sessionId)) || null
}

export function findGroupById(layout: PaneLayout, groupId: string): PaneGroup | null {
 return listGroups(layout).find((g) => g.id === groupId) || null
}

export function focusedGroup(layout: PaneLayout): PaneGroup {
 const groups = listGroups(layout)
 return groups.find((g) => g.id === layout.focusedGroupId) || groups[0]
}

export function allSessionIds(layout: PaneLayout): string[] {
 return listGroups(layout).flatMap((g) => g.sessionIds)
}

export function activeSessionOf(layout: PaneLayout): string | null {
 const g = focusedGroup(layout)
 return g?.activeSessionId || null
}

/** Spatial navigation between pane groups (Ctrl+Arrow). */
export type NavDir = 'left' | 'right' | 'up' | 'down'

interface LeafRect {
 x: number
 y: number
 w: number
 h: number
 groupId: string
}

function collectLeafRects(
 node: LayoutNode,
 x: number,
 y: number,
 w: number,
 h: number,
 out: LeafRect[]
): void {
 if (node.type === 'leaf') {
 out.push({ x, y, w, h, groupId: node.group.id })
 return
 }
 if (node.direction === 'row') {
 const w1 = w * node.ratio
 collectLeafRects(node.first, x, y, w1, h, out)
 collectLeafRects(node.second, x + w1, y, w - w1, h, out)
 } else {
 const h1 = h * node.ratio
 collectLeafRects(node.first, x, y, w, h1, out)
 collectLeafRects(node.second, x, y + h1, w, h - h1, out)
 }
}

/**
 * Find the best neighboring pane group in a compass direction.
 * Uses layout geometry (nested splits + ratios), not tab order.
 */
export function findNeighborGroup(
 layout: PaneLayout,
 fromGroupId: string,
 dir: NavDir
): string | null {
 const rects: LeafRect[] = []
 collectLeafRects(layout.root, 0, 0, 1, 1, rects)
 if (rects.length < 2) return null

 const from = rects.find((r) => r.groupId === fromGroupId) || rects[0]
 if (!from) return null

 const cx = from.x + from.w / 2
 const cy = from.y + from.h / 2

 let best: string | null = null
 let bestScore = Infinity

 for (const r of rects) {
 if (r.groupId === from.groupId) continue
 const rx = r.x + r.w / 2
 const ry = r.y + r.h / 2
 const dx = rx - cx
 const dy = ry - cy

 // Must lie primarily in the requested direction
 if (dir === 'left' && dx >= -0.001) continue
 if (dir === 'right' && dx <= 0.001) continue
 if (dir === 'up' && dy >= -0.001) continue
 if (dir === 'down' && dy <= 0.001) continue

 const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy)
 const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
 // Prefer closer along the travel axis; penalize off-axis offset
 const score = primary + secondary * 2.5
 if (score < bestScore) {
 bestScore = score
 best = r.groupId
 }
 }
 return best
}

/**
 * Focus neighbor pane (or cycle tabs in-group when only one pane).
 * Returns the session id that should become active, or null.
 */
export function navigatePanes(
 layout: PaneLayout,
 dir: NavDir,
 /** When true, Left/Right cycle tabs inside the focused group if no neighbor. */
 cycleTabsInGroup = true,
 opts?: CycleTabsOpts
): { layout: PaneLayout; sessionId: string | null } {
 layout = normalizeLayout(layout)

 // First load / restore often leaves focusedGroupId on group A while
 // activeSessionId is on group B - seed from preferActive so arrows start right.
 if (opts?.preferActive && findGroup(layout, opts.preferActive)) {
 layout = focusSession(layout, opts.preferActive)
 } else if (opts?.allowIds && opts.allowIds.size > 0) {
 const fg0 = focusedGroup(layout)
 const { ids: seedIds } = cycleableInGroup(fg0, { allowIds: opts.allowIds })
 if (!seedIds.length) {
 // Focused group has no visible tabs - jump to first allowlisted session
 for (const id of opts.allowIds) {
 if (findGroup(layout, id)) {
 layout = focusSession(layout, id)
 break
 }
 }
 }
 }

 const groups = listGroups(layout)
 if (!groups.length) return { layout, sessionId: null }

 const fg = focusedGroup(layout)
 if (!fg) return { layout, sessionId: null }
 const neighborId = findNeighborGroup(layout, fg.id, dir)

 if (neighborId) {
 const ng = groups.find((g) => g.id === neighborId)
 if (!ng) return { layout, sessionId: null }
 // Land on the tab that pane already shows - do NOT use preferActive from the
 // group we are leaving (that is never in the target ids, but if it ever is,
 // reusing it would jump to the wrong tab).
 const { ids } = cycleableInGroup(ng, { allowIds: opts?.allowIds })
 const sid =
 (ng.activeSessionId && ids.includes(ng.activeSessionId) && ng.activeSessionId) ||
 ids[0] ||
 null
 if (!sid) return { layout, sessionId: null }
 return { layout: focusSession(layout, sid), sessionId: sid }
 }

 // No geometric neighbor - still move between panes with Ctrl+Arrow by
 // walking leaf order (helps when ratios/rects make compass search miss).
 if (groups.length > 1) {
 const gi = groups.findIndex((g) => g.id === fg.id)
 if (gi >= 0) {
 const step = dir === 'right' || dir === 'down' ? 1 : -1
 const ni = (gi + step + groups.length) % groups.length
 if (ni !== gi) {
 const ng = groups[ni]
 const { ids } = cycleableInGroup(ng, { allowIds: opts?.allowIds })
 const sid =
 (ng.activeSessionId && ids.includes(ng.activeSessionId) && ng.activeSessionId) ||
 ids[0] ||
 null
 if (sid) return { layout: focusSession(layout, sid), sessionId: sid }
 }
 }
 }

 // Single pane (or no neighbor that way): cycle tabs with any arrow
 if (cycleTabsInGroup) {
 const { ids, cur } = cycleableInGroup(fg, opts)
 const from = cur || ids[0] || null
 if (ids.length > 1 && from) {
 const idx = Math.max(0, ids.indexOf(from))
 const forward = dir === 'right' || dir === 'down'
 const nextIdx = forward
 ? (idx + 1) % ids.length
 : (idx - 1 + ids.length) % ids.length
 const sid = ids[nextIdx]
 return { layout: focusSession(layout, sid), sessionId: sid }
 }
 }

 const { ids: fallIds, cur: fallCur } = cycleableInGroup(fg, opts)
 return {
 layout,
 sessionId: fallCur || fallIds[0] || fg.activeSessionId || null
 }
}

/**
 * Guaranteed pane/tab step for Ctrl+Arrow - never returns null when there is
 * another allowlisted session somewhere in the tree. Falls back to walking
 * all visible sessions in leaf order when geometry/neighbors miss.
 */
export function stepPaneFocus(
 layout: PaneLayout,
 dir: NavDir,
 opts?: CycleTabsOpts
): { layout: PaneLayout; sessionId: string | null } {
 const first = navigatePanes(layout, dir, true, opts)
 const prefer = opts?.preferActive || null
 if (first.sessionId && first.sessionId !== prefer) {
 return first
 }

 // Same session or null - walk every visible tab in pane order
 layout = normalizeLayout(first.layout)
 if (prefer && findGroup(layout, prefer)) {
 layout = focusSession(layout, prefer)
 }
 const groups = listGroups(layout)
 const order: string[] = []
 const seen = new Set<string>()
 for (const g of groups) {
 const { ids } = cycleableInGroup(g, opts)
 for (const id of ids) {
 if (seen.has(id)) continue
 seen.add(id)
 order.push(id)
 }
 }
 if (order.length < 2) {
 return {
 layout,
 sessionId: first.sessionId || order[0] || prefer
 }
 }
 const cur = (prefer && order.includes(prefer) ? prefer : null) || order[0]
 const idx = Math.max(0, order.indexOf(cur))
 const forward = dir === 'right' || dir === 'down'
 const nextIdx = forward
 ? (idx + 1) % order.length
 : (idx - 1 + order.length) % order.length
 const sid = order[nextIdx]
 return { layout: focusSession(layout, sid), sessionId: sid }
}

// ── Create / map ────────────────────────────────────────────────────────────

export function createLayout(sessionIds: string[] = [], activeId: string | null = null): PaneLayout {
 const g = makeGroup(sessionIds, activeId)
 return { root: leaf(g), focusedGroupId: g.id }
}

/**
 * Coerce legacy flat layouts `{ groups, direction, ratios }` (pre-nested)
 * into the new binary-tree shape so HMR / old state doesn't crash.
 */
export function normalizeLayout(layout: PaneLayout | Record<string, unknown> | null | undefined): PaneLayout {
 if (!layout || typeof layout !== 'object') return createLayout()
 const any = layout as {
 root?: LayoutNode
 focusedGroupId?: string
 groups?: PaneGroup[]
 direction?: 'row' | 'column'
 ratios?: number[]
 }
 if (any.root && (any.root.type === 'leaf' || any.root.type === 'split')) {
 return {
 root: any.root,
 focusedGroupId: any.focusedGroupId || firstLeafId(any.root)
 }
 }
 // Legacy flat strip
 const groups = Array.isArray(any.groups) ? any.groups : []
 if (groups.length === 0) return createLayout()
 if (groups.length === 1) {
 return { root: leaf({ ...groups[0] }), focusedGroupId: groups[0].id }
 }
 const direction = any.direction === 'column' ? 'column' : 'row'
 const ratios = any.ratios || groups.map(() => 1 / groups.length)
 // Fold left-to-right into a binary tree preserving approximate sizes
 let node: LayoutNode = leaf({ ...groups[0] })
 let used = ratios[0] || 1 / groups.length
 for (let i = 1; i < groups.length; i++) {
 const r = ratios[i] || 1 / groups.length
 const total = used + r
 const firstShare = used / total
 node = split(direction, node, leaf({ ...groups[i] }), firstShare)
 used = total
 }
 return {
 root: node,
 focusedGroupId: any.focusedGroupId || groups[0].id
 }
}

function mapNode(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
 const next = fn(node)
 if (next.type === 'split') {
 return {
 ...next,
 first: mapNode(next.first, fn),
 second: mapNode(next.second, fn)
 }
 }
 return next
}

function updateGroup(
 node: LayoutNode,
 groupId: string,
 updater: (g: PaneGroup) => PaneGroup
): LayoutNode {
 if (node.type === 'leaf') {
 if (node.group.id !== groupId) return node
 return { type: 'leaf', group: updater(node.group) }
 }
 return {
 ...node,
 first: updateGroup(node.first, groupId, updater),
 second: updateGroup(node.second, groupId, updater)
 }
}

// ── Remove / prune ──────────────────────────────────────────────────────────

/** Remove a session from the tree; collapse empty leaves into their sibling. */
function removeSessionFromNode(
 node: LayoutNode,
 sessionId: string
): LayoutNode | null {
 if (node.type === 'leaf') {
 if (!node.group.sessionIds.includes(sessionId)) return node
 const ids = node.group.sessionIds.filter((id) => id !== sessionId)
 if (ids.length === 0) return null
 return {
 type: 'leaf',
 group: {
 ...node.group,
 sessionIds: ids,
 activeSessionId:
 node.group.activeSessionId === sessionId
 ? ids[ids.length - 1] || null
 : node.group.activeSessionId
 }
 }
 }

 const first = removeSessionFromNode(node.first, sessionId)
 const second = removeSessionFromNode(node.second, sessionId)
 if (!first && !second) return null
 if (!first) return second
 if (!second) return first
 return { ...node, first, second }
}

export function removeSessionFromLayout(layout: PaneLayout, sessionId: string): PaneLayout {
 const root = removeSessionFromNode(layout.root, sessionId)
 if (!root) return createLayout([])
 const groups = listGroups({ root, focusedGroupId: layout.focusedGroupId })
 let focusedGroupId = layout.focusedGroupId
 if (!groups.some((g) => g.id === focusedGroupId)) {
 focusedGroupId = groups[0]?.id || createLayout().focusedGroupId
 }
 return { root, focusedGroupId }
}

// ── Sync live sessions ──────────────────────────────────────────────────────

export function syncSessions(
 layout: PaneLayout,
 sessionIds: string[],
 preferActive: string | null
): PaneLayout {
 layout = normalizeLayout(layout)
 const set = new Set(sessionIds)

 // Empty live set: keep structure only if layout is already empty; otherwise
 // collapse once. Callers that project-filter should not pass [] while other
 // projects still have live sessions - use filterLayoutToSessionIds for views.
 if (sessionIds.length === 0) {
 const existing = allSessionIds(layout)
 if (existing.length === 0) return layout
 return createLayout([], preferActive)
 }

 let root = layout.root

 // Drop dead sessions
 for (const g of listGroups(layout)) {
 for (const id of g.sessionIds) {
 if (!set.has(id)) {
 const next = removeSessionFromNode(root, id)
 if (!next) return createLayout(sessionIds, preferActive)
 root = next
 }
 }
 }

 let groups = listGroups({ root, focusedGroupId: layout.focusedGroupId })
 if (groups.length === 0) return createLayout(sessionIds, preferActive)

 const known = new Set(groups.flatMap((g) => g.sessionIds))
 const orphans = sessionIds.filter((id) => !known.has(id))
 if (orphans.length) {
 const focusId = groups.some((g) => g.id === layout.focusedGroupId)
 ? layout.focusedGroupId
 : groups[0].id
 root = updateGroup(root, focusId, (g) => ({
 ...g,
 sessionIds: [...g.sessionIds, ...orphans],
 activeSessionId: orphans[orphans.length - 1] || g.activeSessionId
 }))
 groups = listGroups({ root, focusedGroupId: focusId })
 }

 let focusedGroupId = layout.focusedGroupId
 if (!groups.some((g) => g.id === focusedGroupId)) {
 focusedGroupId = groups[0].id
 }

 // Only force focus onto preferActive when membership changed (new orphans)
 // or the focused group disappeared. Always rewriting focusedGroupId from the
 // store fought Ctrl+Arrow: a one-frame-stale activeSessionId snapped focus
 // back to the previous pane (and title/patch session updates re-triggered it).
 const focusStillValid = groups.some((g) => g.id === focusedGroupId)
 if (
 preferActive &&
 (orphans.length > 0 || !focusStillValid) &&
 groups.some((g) => g.sessionIds.includes(preferActive))
 ) {
 const owner = groups.find((g) => g.sessionIds.includes(preferActive))
 if (owner) {
 focusedGroupId = owner.id
 root = updateGroup(root, owner.id, (g) => ({ ...g, activeSessionId: preferActive }))
 }
 }

 return { root, focusedGroupId }
}

/**
 * View-only prune: drop sessions not in `keep` and collapse empty leaves.
 * Does not mutate the source layout - used to show one project's panes without
 * destroying multi-pane state for other projects.
 */
export function filterLayoutToSessionIds(
 layout: PaneLayout,
 keep: ReadonlySet<string>
): PaneLayout {
 layout = normalizeLayout(layout)
 if (keep.size === 0) return createLayout()

 let root: LayoutNode | null = layout.root
 for (const id of allSessionIds(layout)) {
 if (!keep.has(id)) {
 root = root ? removeSessionFromNode(root, id) : null
 if (!root) return createLayout()
 }
 }

 const groups = listGroups({ root, focusedGroupId: layout.focusedGroupId })
 if (groups.length === 0) return createLayout()

 let focusedGroupId = layout.focusedGroupId
 if (!groups.some((g) => g.id === focusedGroupId)) {
 focusedGroupId = groups[0].id
 }
 return { root, focusedGroupId }
}

// ── Focus / reorder ─────────────────────────────────────────────────────────

export function focusSession(layout: PaneLayout, sessionId: string): PaneLayout {
 const g = findGroup(layout, sessionId)
 if (!g) return layout
 return {
 root: updateGroup(layout.root, g.id, (x) => ({ ...x, activeSessionId: sessionId })),
 focusedGroupId: g.id
 }
}

export type CycleTabsOpts = {
 /**
 * Preferred current tab (usually store `activeSessionId`). Used when it belongs
 * to the focused group’s cycleable list - more reliable than group active alone.
 */
 preferActive?: string | null
 /**
 * Only cycle among these session ids (e.g. live project sessions). Hidden /
 * other-project ids stay in the tree but must not steal the index - otherwise
 * Ctrl+Shift+Tab on the last *visible* tab looks dead (cur was a ghost past it).
 */
 allowIds?: ReadonlySet<string>
}

/**
 * Tabs the user can actually land on in a group (optionally project-filtered).
 * When the layout’s active id is not cycleable (pruned from the view), treat
 * current as the last cycleable id - same fallback as filterLayoutToSessionIds.
 */
function cycleableInGroup(
 fg: PaneGroup,
 opts?: CycleTabsOpts
): { ids: string[]; cur: string | null } {
 const allow = opts?.allowIds
 const ids = allow ? fg.sessionIds.filter((id) => allow.has(id)) : [...fg.sessionIds]
 if (!ids.length) return { ids, cur: null }

 const prefer = opts?.preferActive
 if (prefer && ids.includes(prefer)) return { ids, cur: prefer }
 if (fg.activeSessionId && ids.includes(fg.activeSessionId)) {
 return { ids, cur: fg.activeSessionId }
 }
 // Active points at a hidden/foreign tab - view shows last remaining (see removeSessionFromNode)
 return { ids, cur: ids[ids.length - 1] }
}

/**
 * Cycle active tab within the focused pane group only (Ctrl+Tab / Ctrl+Shift+Tab).
 * Does not cross into other split panes.
 */
export function cycleTabsInFocusedGroup(
 layout: PaneLayout,
 direction: 'next' | 'prev' = 'next',
 opts?: CycleTabsOpts
): { layout: PaneLayout; sessionId: string | null } {
 const fg = focusedGroup(layout)
 if (!fg) return { layout, sessionId: null }
 const { ids, cur } = cycleableInGroup(fg, opts)
 if (!ids.length || !cur) return { layout, sessionId: null }
 if (ids.length === 1) {
 const only = ids[0]
 return { layout: focusSession(layout, only), sessionId: only }
 }
 const idx = Math.max(0, ids.indexOf(cur))
 const nextIdx =
 direction === 'next'
 ? (idx + 1) % ids.length
 : (idx - 1 + ids.length) % ids.length
 const sid = ids[nextIdx]
 return { layout: focusSession(layout, sid), sessionId: sid }
}

export function setGroupActive(
 layout: PaneLayout,
 groupId: string,
 sessionId: string
): PaneLayout {
 return {
 root: updateGroup(layout.root, groupId, (g) =>
 g.sessionIds.includes(sessionId) ? { ...g, activeSessionId: sessionId } : g
 ),
 focusedGroupId: groupId
 }
}

export function reorderInGroup(
 layout: PaneLayout,
 groupId: string,
 sessionId: string,
 toIndex: number
): PaneLayout {
 return {
 ...layout,
 root: updateGroup(layout.root, groupId, (g) => {
 const ids = [...g.sessionIds]
 const from = ids.indexOf(sessionId)
 if (from < 0) return g
 ids.splice(from, 1)
 const dest = Math.max(0, Math.min(toIndex, ids.length))
 ids.splice(dest, 0, sessionId)
 return { ...g, sessionIds: ids }
 })
 }
}

// ── Dock (Roblox-style: relative to one target pane only) ───────────────────

function replaceGroupNode(
 node: LayoutNode,
 groupId: string,
 replacement: LayoutNode
): LayoutNode {
 if (node.type === 'leaf') {
 return node.group.id === groupId ? replacement : node
 }
 return {
 ...node,
 first: replaceGroupNode(node.first, groupId, replacement),
 second: replaceGroupNode(node.second, groupId, replacement)
 }
}

/**
 * Move a tab relative to a **target pane**:
 * - center → join that pane’s tab strip (other panes untouched)
 * - left/right/top/bottom → split **only that pane** into two; neighbors stay put
 */
export function placeSession(
 layout: PaneLayout,
 sessionId: string,
 edge: DropEdge,
 targetGroupId?: string
): PaneLayout {
 layout = normalizeLayout(layout)
 // 1) Pull the tab out of the tree
 let root = removeSessionFromNode(layout.root, sessionId)
 if (!root) {
 // Tree was only this tab - start fresh
 const g = makeGroup([sessionId], sessionId)
 return { root: leaf(g), focusedGroupId: g.id }
 }

 let groups = listGroups({ root, focusedGroupId: layout.focusedGroupId })
 const tid =
 (targetGroupId && groups.some((g) => g.id === targetGroupId) && targetGroupId) ||
 (groups.some((g) => g.id === layout.focusedGroupId) && layout.focusedGroupId) ||
 groups[0]?.id

 if (!tid) {
 const g = makeGroup([sessionId], sessionId)
 return { root: leaf(g), focusedGroupId: g.id }
 }

 // 2) Center: join existing tab strip of that pane only
 if (edge === 'center') {
 root = updateGroup(root, tid, (g) => {
 if (g.sessionIds.includes(sessionId)) {
 return { ...g, activeSessionId: sessionId }
 }
 return {
 ...g,
 sessionIds: [...g.sessionIds, sessionId],
 activeSessionId: sessionId
 }
 })
 return { root, focusedGroupId: tid }
 }

 // 3) At capacity: join center of target instead of adding a leaf
 groups = listGroups({ root, focusedGroupId: tid })
 if (groups.length >= MAX_PANES) {
 root = updateGroup(root, tid, (g) => ({
 ...g,
 sessionIds: [...g.sessionIds.filter((id) => id !== sessionId), sessionId],
 activeSessionId: sessionId
 }))
 return { root, focusedGroupId: tid }
 }

 // 4) Split only the target leaf - siblings keep their structure
 const target = findGroupById({ root, focusedGroupId: tid }, tid)
 if (!target) return { root, focusedGroupId: tid }

 const newG = makeGroup([sessionId], sessionId)
 const targetLeaf: LayoutNode = leaf({ ...target })
 const newLeaf: LayoutNode = leaf(newG)

 let replacement: LayoutNode
 switch (edge) {
 case 'left':
 replacement = split('row', newLeaf, targetLeaf, 0.5)
 break
 case 'right':
 replacement = split('row', targetLeaf, newLeaf, 0.5)
 break
 case 'top':
 replacement = split('column', newLeaf, targetLeaf, 0.5)
 break
 case 'bottom':
 replacement = split('column', targetLeaf, newLeaf, 0.5)
 break
 default:
 replacement = targetLeaf
 }

 root = replaceGroupNode(root, tid, replacement)
 return { root, focusedGroupId: newG.id }
}

export function addPane(
 layout: PaneLayout,
 sessionId: string | null,
 direction: 'row' | 'column' = 'row'
): PaneLayout {
 if (!sessionId) return layout
 if (countLeaves(layout) >= MAX_PANES) return layout
 const edge = direction === 'row' ? 'right' : 'bottom'
 return placeSession(layout, sessionId, edge, layout.focusedGroupId)
}

export function fanOutSessions(
 _layout: PaneLayout,
 sessionIds: string[],
 direction: 'row' | 'column' = 'row'
): PaneLayout {
 const ids = sessionIds.slice(0, MAX_PANES)
 if (ids.length === 0) return createLayout()
 if (ids.length === 1) return createLayout(ids, ids[0])

 // Build a balanced binary tree of single-tab leaves
 const leaves = ids.map((id) => leaf(makeGroup([id], id)))
 const build = (nodes: LayoutNode[]): LayoutNode => {
 if (nodes.length === 1) return nodes[0]
 const mid = Math.ceil(nodes.length / 2)
 return split(direction, build(nodes.slice(0, mid)), build(nodes.slice(mid)), 0.5)
 }
 const root = build(leaves)
 const groups = listGroups({ root, focusedGroupId: '' })
 return { root, focusedGroupId: groups[0].id }
}

export function mergeAllGroups(layout: PaneLayout): PaneLayout {
 const ids = allSessionIds(layout)
 const active = activeSessionOf(layout) || ids[0] || null
 return createLayout(ids, active)
}

/** Close a pane group - its tabs move into the nearest sibling. */
export function closeGroup(layout: PaneLayout, groupId: string): PaneLayout {
 const groups = listGroups(layout)
 if (groups.length < 2) return layout
 const dying = groups.find((g) => g.id === groupId)
 if (!dying) return layout

 // Prefer a sibling under the same parent split
 const siblingId = findSiblingGroupId(layout.root, groupId)
 const targetId =
 siblingId ||
 groups.find((g) => g.id !== groupId)?.id ||
 null
 if (!targetId) return layout

 let root = layout.root
 // Move tabs into target
 root = updateGroup(root, targetId, (g) => ({
 ...g,
 sessionIds: [...g.sessionIds, ...dying.sessionIds],
 activeSessionId: g.activeSessionId || dying.activeSessionId
 }))
 // Remove empty dying leaf
 root = removeEmptyGroup(root, groupId) || root
 const remaining = listGroups({ root, focusedGroupId: targetId })
 return {
 root,
 focusedGroupId: remaining.some((g) => g.id === targetId)
 ? targetId
 : remaining[0]?.id || targetId
 }
}

function findSiblingGroupId(node: LayoutNode, groupId: string): string | null {
 if (node.type === 'leaf') return null
 if (node.first.type === 'leaf' && node.first.group.id === groupId) {
 return firstLeafId(node.second)
 }
 if (node.second.type === 'leaf' && node.second.group.id === groupId) {
 return firstLeafId(node.first)
 }
 return (
 findSiblingGroupId(node.first, groupId) || findSiblingGroupId(node.second, groupId)
 )
}

function firstLeafId(node: LayoutNode): string {
 if (node.type === 'leaf') return node.group.id
 return firstLeafId(node.first)
}

function removeEmptyGroup(node: LayoutNode, groupId: string): LayoutNode | null {
 if (node.type === 'leaf') {
 return node.group.id === groupId ? null : node
 }
 const first = removeEmptyGroup(node.first, groupId)
 const second = removeEmptyGroup(node.second, groupId)
 if (!first && !second) return null
 if (!first) return second
 if (!second) return first
 return { ...node, first, second }
}

// ── Resize ──────────────────────────────────────────────────────────────────

/** Set ratio on a specific split node (Roblox/VS Code gutter). */
export function setSplitRatio(
 layout: PaneLayout,
 splitId: string,
 ratio: number
): PaneLayout {
 const r = clampRatio(ratio)
 const patch = (node: LayoutNode): LayoutNode => {
 if (node.type === 'leaf') return node
 if (node.id === splitId) return { ...node, ratio: r }
 return { ...node, first: patch(node.first), second: patch(node.second) }
 }
 return { ...layout, root: patch(layout.root) }
}

/**
 * Legacy flat gutter API - used when layout is still a simple strip.
 * Prefer setSplitRatio with a split id for nested trees.
 */
export function setGutterRatio(
 layout: PaneLayout,
 gutterIndex: number,
 leftAccumFraction: number
): PaneLayout {
 // Only works for a flat single-level split chain - walk left-spine
 if (layout.root.type !== 'split') return layout
 // For nested trees this is approximate; App now uses setSplitRatio.
 void gutterIndex
 return setSplitRatio(layout, layout.root.id, leftAccumFraction)
}

/** @deprecated */
export function setPrimaryRatio(layout: PaneLayout, ratio: number): PaneLayout {
 if (layout.root.type !== 'split') return layout
 return setSplitRatio(layout, layout.root.id, ratio)
}

// ── Drop geometry (Roblox Studio docking) ───────────────────────────────────

/**
 * Size of the centered Studio dock cross (px).
 * Matches the classic dock widget: up / down / left / right / center.
 */
export const STUDIO_DOCK_CELL = 36
export const STUDIO_DOCK_GAP = 4
/** Total dock widget = 3 cells + 2 gaps */
export const STUDIO_DOCK_SIZE = STUDIO_DOCK_CELL * 3 + STUDIO_DOCK_GAP * 2

export interface DropTarget {
 groupId: string
 edge: DropEdge
}

/**
 * Hit-test the Studio dock cross in the center of a pane.
 * Returns null if pointer is outside the dock widget (caller may fall back
 * to coarse edge-of-pane docking or tab-bar join).
 */
export function studioDockEdgeFromPoint(
 clientX: number,
 clientY: number,
 paneRect: DOMRect
): DropEdge | null {
 const size = STUDIO_DOCK_SIZE
 const cell = STUDIO_DOCK_CELL
 const gap = STUDIO_DOCK_GAP
 const cx = paneRect.left + paneRect.width / 2
 const cy = paneRect.top + paneRect.height / 2
 const left = cx - size / 2
 const top = cy - size / 2
 const x = clientX - left
 const y = clientY - top
 if (x < 0 || y < 0 || x > size || y > size) return null

 // 3×3 grid cells (corners unused). Layout:
 // . T .
 // L C R
 // . B .
 const col = x < cell ? 0 : x < cell + gap + cell ? 1 : 2
 const row = y < cell ? 0 : y < cell + gap + cell ? 1 : 2

 if (row === 0 && col === 1) return 'top'
 if (row === 1 && col === 0) return 'left'
 if (row === 1 && col === 1) return 'center'
 if (row === 1 && col === 2) return 'right'
 if (row === 2 && col === 1) return 'bottom'
 return null
}

/**
 * Map pointer over a pane to a dock edge (Studio-first).
 * 1) Tab strip / title of that pane → center (join tabs)
 * 2) Studio dock cross hit → that direction
 * 3) Coarse half-pane fallback for quick edge drops
 */
export function edgeFromPoint(clientX: number, clientY: number, rect: DOMRect): DropEdge {
 // Prefer Studio dock cross
 const studio = studioDockEdgeFromPoint(clientX, clientY, rect)
 if (studio) return studio

 const x = (clientX - rect.left) / Math.max(1, rect.width)
 const y = (clientY - rect.top) / Math.max(1, rect.height)

 // Outer band fallback (only near edges of the pane)
 const band = 0.18
 if (x < band) return 'left'
 if (x > 1 - band) return 'right'
 if (y < band) return 'top'
 if (y > 1 - band) return 'bottom'
 return 'center'
}

/** Resolve which pane is under the pointer (by data-group-id). */
export function groupIdFromPoint(clientX: number, clientY: number): string | null {
 if (typeof document === 'undefined') return null
 const els = document.elementsFromPoint(clientX, clientY)
 for (const el of els) {
 if (!(el instanceof HTMLElement)) continue
 // Prefer explicit group host
 const host = el.closest?.('[data-group-id]') as HTMLElement | null
 if (host?.dataset.groupId) return host.dataset.groupId
 if (el.dataset.groupId) return el.dataset.groupId
 }
 return null
}

/** True if pointer is over that pane’s tab strip (join tabs - Studio tab dock). */
export function isOverGroupTabBar(clientX: number, clientY: number, groupId: string): boolean {
 if (typeof document === 'undefined') return false
 const bar = document.querySelector(
 `.group-tabbar[data-group="${CSS.escape(groupId)}"]`
 ) as HTMLElement | null
 if (!bar) return false
 const r = bar.getBoundingClientRect()
 return (
 clientX >= r.left &&
 clientX <= r.right &&
 clientY >= r.top &&
 clientY <= r.bottom
 )
}

// ── Serialize nested layout for disk (tab indices, not PTY ids) ─────────────

export type SavedPaneNode =
 | {
 type: 'leaf'
 tabIndices: number[]
 activeTabIndex: number | null
 }
 | {
 type: 'split'
 direction: 'row' | 'column'
 ratio: number
 first: SavedPaneNode
 second: SavedPaneNode
 }

/** Encode live layout → indices into sessionOrder. */
export function serializePaneTree(
 layout: PaneLayout,
 sessionOrder: string[]
): SavedPaneNode | null {
 const indexOf = new Map(sessionOrder.map((id, i) => [id, i]))
 const walk = (node: LayoutNode): SavedPaneNode | null => {
 if (node.type === 'leaf') {
 const tabIndices = node.group.sessionIds
 .map((id) => indexOf.get(id))
 .filter((i): i is number => typeof i === 'number')
 if (!tabIndices.length) return null
 const active = node.group.activeSessionId
 ? indexOf.get(node.group.activeSessionId) ?? tabIndices[tabIndices.length - 1]
 : tabIndices[tabIndices.length - 1]
 return { type: 'leaf', tabIndices, activeTabIndex: active ?? null }
 }
 const first = walk(node.first)
 const second = walk(node.second)
 if (!first && !second) return null
 if (!first) return second
 if (!second) return first
 return {
 type: 'split',
 direction: node.direction,
 ratio: node.ratio,
 first,
 second
 }
 }
 return walk(normalizeLayout(layout).root)
}

/** Rebuild layout from saved tree + restored session ids (same order as tabs). */
export function deserializePaneTree(
 tree: SavedPaneNode | null | undefined,
 sessionIds: string[],
 preferActive?: string | null
): PaneLayout {
 if (!tree || !sessionIds.length) {
 return createLayout(sessionIds, preferActive || sessionIds[0] || null)
 }
 const walk = (node: SavedPaneNode): LayoutNode | null => {
 if (node.type === 'leaf') {
 const ids = node.tabIndices
 .map((i) => sessionIds[i])
 .filter((id): id is string => Boolean(id))
 if (!ids.length) return null
 const active =
 (node.activeTabIndex != null && sessionIds[node.activeTabIndex]) ||
 ids[ids.length - 1]
 return leaf(makeGroup(ids, active))
 }
 const first = walk(node.first)
 const second = walk(node.second)
 if (!first && !second) return null
 if (!first) return second
 if (!second) return first
 return split(node.direction, first, second, node.ratio)
 }
 const root = walk(tree)
 if (!root) return createLayout(sessionIds, preferActive || null)
 const groups = listGroups({ root, focusedGroupId: '' })
 let focusedGroupId = groups[0]?.id || ''
 if (preferActive) {
 const owner = groups.find((g) => g.sessionIds.includes(preferActive))
 if (owner) focusedGroupId = owner.id
 }
 return { root, focusedGroupId }
}
