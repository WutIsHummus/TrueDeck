import { useSyncExternalStore } from 'react'
import {
  classifyAgentTail,
  formatWorkingElapsed,
  resolveAgentPhase,
  type AgentPhase
} from './agent-phase'

export interface AgentPhaseSnap {
  phase: AgentPhase
  label: string
  title: string
  unseen: boolean
}

interface Row {
  id: string
  agentId: string
  tail: string
  lastByteAt: number
  createdAt: number
  sawWork: boolean
  phase: AgentPhase
  workingSince: number | null
  seen: boolean
  exited: boolean
  /** Ignore an idle screen until this time after we submit a task. */
  holdUntil: number
}

const rows = new Map<string, Row>()
const listeners = new Set<() => void>()
let revision = 0
let focusedId: string | null = null
const snapCache = new Map<string, { rev: number; snap: AgentPhaseSnap }>()

const EMPTY: AgentPhaseSnap = {
  phase: 'starting',
  label: '',
  title: 'Starting',
  unseen: false
}

function emit(): void {
  revision += 1
  snapCache.clear()
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function labelFor(row: Row, now: number): string {
  if (row.exited) return 'Exit'
  if (row.phase === 'working') {
    return formatWorkingElapsed(now - (row.workingSince || row.lastByteAt || now))
  }
  if (row.phase === 'waiting') return 'Wait'
  if (row.phase === 'done') return 'Done'
  return ''
}

function titleFor(row: Row, now: number): string {
  if (row.exited) return 'Agent exited'
  if (row.phase === 'working') {
    const elapsed = formatWorkingElapsed(now - (row.workingSince || row.lastByteAt || now))
    return `Working for ${elapsed}`
  }
  if (row.phase === 'waiting') return 'Waiting on you — cannot take a new task'
  if (row.phase === 'done') return row.seen ? 'Stopped' : 'Stopped — not looked at yet'
  return 'Idle — can take a task'
}

function recompute(row: Row, now: number): boolean {
  if (!row.exited && row.holdUntil > now) {
    const signal = classifyAgentTail(row.agentId, row.tail)
    if (signal !== 'waiting') {
      const changed = row.phase !== 'working'
      if (row.workingSince == null) row.workingSince = now
      row.phase = 'working'
      row.sawWork = true
      return changed
    }
  }
  const signal = classifyAgentTail(row.agentId, row.tail)
  if (signal === 'working' || signal === 'done' || signal === 'waiting') row.sawWork = true
  const phase = resolveAgentPhase({
    signal,
    sawWork: row.sawWork,
    quietMs: now - row.lastByteAt,
    wasWorking: row.phase === 'working' || row.workingSince != null,
    exited: row.exited
  })
  if (phase === 'working') {
    if (row.workingSince == null) row.workingSince = now
  } else {
    row.workingSince = null
  }
  if (phase === 'done' && row.phase !== 'done') row.seen = row.id === focusedId
  const changed = phase !== row.phase
  row.phase = phase
  return changed
}

function ensure(id: string, agentId: string): Row {
  let row = rows.get(id)
  if (!row) {
    const now = Date.now()
    row = {
      id,
      agentId,
      tail: '',
      lastByteAt: now,
      createdAt: now,
      sawWork: false,
      phase: 'starting',
      workingSince: null,
      seen: true,
      exited: false,
      holdUntil: 0
    }
    rows.set(id, row)
  } else if (agentId) {
    row.agentId = agentId
  }
  return row
}

export function feedAgentOutput(id: string, agentId: string, chunk: string): void {
  if (!id || !chunk) return
  const row = ensure(id, agentId || 'agent')
  row.exited = false
  row.tail = (row.tail + chunk).slice(-8000)
  row.lastByteAt = Date.now()
  const plain = chunk.replace(/\s+/g, '')
  if (plain.length > 24 && row.lastByteAt - row.createdAt > 2500) row.sawWork = true
  if (recompute(row, row.lastByteAt)) emit()
}

export function markAgentWorking(id: string, agentId: string): void {
  const row = ensure(id, agentId || 'agent')
  const now = Date.now()
  row.exited = false
  row.sawWork = true
  row.lastByteAt = now
  row.holdUntil = now + 4000
  if (row.phase !== 'working' || row.workingSince == null) row.workingSince = now
  row.phase = 'working'
  row.seen = true
  emit()
}

export function noteAgentFocused(id: string): void {
  focusedId = id
  const row = rows.get(id)
  if (!row || row.seen) return
  row.seen = true
  emit()
}

export function noteAgentExited(id: string): void {
  const row = rows.get(id)
  if (!row) return
  row.exited = true
  row.phase = 'done'
  row.seen = false
  emit()
}

export function forgetAgent(id: string): void {
  if (!rows.delete(id)) return
  emit()
}

export function readAgentPhase(id: string): AgentPhase {
  return rows.get(id)?.phase || 'starting'
}

export function tickAgentActivity(now = Date.now()): void {
  let changed = false
  rows.forEach((row) => {
    const before = row.phase
    const beforeSince = row.workingSince
    if (recompute(row, now) || before !== row.phase || beforeSince !== row.workingSince) {
      changed = true
    }
    if (row.phase === 'working') changed = true
  })
  if (changed) emit()
}

function snapFor(id: string): AgentPhaseSnap {
  const hit = snapCache.get(id)
  if (hit && hit.rev === revision) return hit.snap
  const row = rows.get(id)
  const snap: AgentPhaseSnap = row
    ? {
        phase: row.phase,
        label: labelFor(row, Date.now()),
        title: titleFor(row, Date.now()),
        unseen: row.phase === 'done' && !row.seen && !row.exited
      }
    : EMPTY
  snapCache.set(id, { rev: revision, snap })
  return snap
}

export function useAgentPhase(sessionId: string): AgentPhaseSnap {
  return useSyncExternalStore(
    subscribe,
    () => snapFor(sessionId),
    () => snapFor(sessionId)
  )
}

export function useAgentRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision
  )
}

/** Bracketed paste plus Enter, so a multi-line task does not submit early. */
export function taskKeystrokes(text: string): string {
  const body = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const enter = /win/i.test(navigator.platform) ? '\r' : '\n'
  if (!body.includes('\n')) return body + enter
  return `\u001b[200~${body}\u001b[201~${enter}`
}
