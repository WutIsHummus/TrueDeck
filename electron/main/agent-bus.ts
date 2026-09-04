/**
 * Agent bus — agents message each other across TrueDeck terminals and PCs.
 *
 * Durable store (Syncthing-friendly): `<globalMemory>/.agent-bus/`
 * Local-only (device id, inject receipts, session bindings): `<dataDir>/agent-bus/`
 *
 * Same-PC: both sessions share APPDATA, so send is immediate.
 * PC-to-PC: the global memory folder is already synced (`truedeck-global-memory`);
 * the other TrueDeck watches new message files and injects into matching PTYs.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync
} from 'fs'
import { join, dirname } from 'path'
import { hostname } from 'os'
import { randomUUID } from 'crypto'
import { getGlobalDataDir, getGlobalMemoryDir } from './paths'
import type { SessionInfo } from '../shared/types'

const PRESENCE_STALE_MS = 45_000
const HEARTBEAT_MS = 3_000
const DELIVER_MS = 1_200
const MAX_BODY = 16 * 1024
const MAX_MESSAGES = 250
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface BusDevice {
  id: string
  name: string
}

export interface BusPeerSession {
  busId: string
  ptyId?: string
  agentId: string
  agentName?: string
  title?: string
  projectRoot?: string
  kind?: string
  status?: string
}

export interface BusPresence {
  deviceId: string
  deviceName: string
  platform: string
  updatedAt: number
  online: boolean
  sessions: BusPeerSession[]
}

export interface BusParty {
  deviceId: string
  deviceName?: string
  sessionId?: string
  agentId?: string
  title?: string
}

export interface BusMessage {
  id: string
  createdAt: number
  from: BusParty
  to: {
    /** session bus id, pty id, agent id, device id/name, `local`, or `all` */
    target: string
    deviceId?: string
    sessionId?: string
    agentId?: string
  }
  body: string
  channel?: string
  deliver: 'inbox' | 'interrupt' | 'both'
}

interface BusBinding {
  busId: string
  ptyId: string
  agentId: string
  agentName: string
  title: string
  projectRoot: string
  kind?: string
  boundAt: number
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return raw == null ? fallback : (raw as T)
  } catch {
    return fallback
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function busPublicDir(): string {
  return join(getGlobalMemoryDir(), '.agent-bus')
}

export function busLocalDir(): string {
  return join(getGlobalDataDir(), 'agent-bus')
}

function devicePath(): string {
  return join(getGlobalDataDir(), 'device.json')
}

function devicesDir(): string {
  return join(busPublicDir(), 'devices')
}

function messagesDir(): string {
  return join(busPublicDir(), 'messages')
}

function bindingsPath(): string {
  return join(busLocalDir(), 'sessions.json')
}

function injectedPath(): string {
  return join(busLocalDir(), 'injected.json')
}

function ensureBusDirs(): void {
  mkdirSync(devicesDir(), { recursive: true })
  mkdirSync(messagesDir(), { recursive: true })
  mkdirSync(busLocalDir(), { recursive: true })
  const readme = join(busPublicDir(), 'README.md')
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      [
        '# TrueDeck agent bus',
        '',
        'Live presence and messages between TrueDeck agent sessions.',
        'Synced with global TrueMemory so another PC running TrueDeck can see it.',
        'Do not edit by hand.',
        ''
      ].join('\n'),
      'utf8'
    )
  }
}

export function ensureDevice(): BusDevice {
  ensureBusDirs()
  const existing = readJson<Partial<BusDevice>>(devicePath(), {})
  const name = (hostname() || 'truedeck').trim() || 'truedeck'
  if (existing.id && typeof existing.id === 'string') {
    const device = { id: existing.id, name: existing.name || name }
    if (device.name !== existing.name) writeJson(devicePath(), device)
    return device
  }
  const device = { id: randomUUID(), name }
  writeJson(devicePath(), device)
  return device
}

export function agentBusEnv(opts?: {
  sessionId?: string
  agentId?: string
}): Record<string, string> {
  const device = ensureDevice()
  const env: Record<string, string> = {
    TRUEDECK_DEVICE_ID: device.id,
    TRUEDECK_DEVICE_NAME: device.name,
    TRUEDECK_BUS_DIR: busPublicDir()
  }
  if (opts?.sessionId) env.TRUEDECK_SESSION_ID = opts.sessionId
  if (opts?.agentId) env.TRUEDECK_AGENT_ID = opts.agentId
  return env
}

function loadBindings(): BusBinding[] {
  const raw = readJson<BusBinding[]>(bindingsPath(), [])
  return Array.isArray(raw) ? raw : []
}

function saveBindings(list: BusBinding[]): void {
  writeJson(bindingsPath(), list.slice(-64))
}

export function bindBusSession(binding: Omit<BusBinding, 'boundAt'>): void {
  const all = loadBindings().filter(
    (b) => b.busId !== binding.busId && b.ptyId !== binding.ptyId
  )
  all.push({ ...binding, boundAt: Date.now() })
  saveBindings(all)
}

export function unbindBusSession(ptyId: string): void {
  saveBindings(loadBindings().filter((b) => b.ptyId !== ptyId))
}

export function attachBusOnSpawn(params: {
  projectRoot: string
  agentId: string
  env?: Record<string, string>
  agentName?: string
}): {
  env: Record<string, string>
  bind: (session: SessionInfo) => void
} {
  const busId = randomUUID()
  const env = {
    ...(params.env || {}),
    ...agentBusEnv({ sessionId: busId, agentId: params.agentId })
  }
  return {
    env,
    bind: (session) => {
      bindBusSession({
        busId,
        ptyId: session.id,
        agentId: params.agentId,
        agentName: params.agentName || session.agentName,
        title: session.title,
        projectRoot: session.projectRoot || params.projectRoot,
        kind: session.kind || 'agent'
      })
    }
  }
}

function loadInjected(): Record<string, number> {
  const raw = readJson<Record<string, number>>(injectedPath(), {})
  return raw && typeof raw === 'object' ? raw : {}
}

function markInjected(id: string): void {
  const all = loadInjected()
  all[id] = Date.now()
  const ids = Object.keys(all)
  if (ids.length > MAX_MESSAGES * 2) {
    const keep = ids.sort((a, b) => all[b] - all[a]).slice(0, MAX_MESSAGES)
    const next: Record<string, number> = {}
    for (const k of keep) next[k] = all[k]
    writeJson(injectedPath(), next)
    return
  }
  writeJson(injectedPath(), all)
}

function listMessageFiles(): string[] {
  try {
    if (!existsSync(messagesDir())) return []
    return readdirSync(messagesDir())
      .filter((n) => n.endsWith('.json'))
      .map((n) => join(messagesDir(), n))
  } catch {
    return []
  }
}

function loadMessage(path: string): BusMessage | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as BusMessage
    if (!raw?.id || !raw.body || !raw.to?.target) return null
    return raw
  } catch {
    return null
  }
}

function pruneMessages(): void {
  const now = Date.now()
  const files = listMessageFiles()
    .map((p) => {
      const msg = loadMessage(p)
      return { p, msg, t: msg?.createdAt || 0 }
    })
    .sort((a, b) => b.t - a.t)
  files.forEach((f, i) => {
    const tooOld = f.t && now - f.t > MESSAGE_TTL_MS
    if (tooOld || i >= MAX_MESSAGES) {
      try {
        unlinkSync(f.p)
      } catch {
        /* ignore */
      }
    }
  })
}

function norm(s: string | undefined): string {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function parseTarget(raw: string): { agentId?: string; device?: string; raw: string } {
  const t = norm(raw)
  const at = t.lastIndexOf('@')
  if (at > 0) {
    return { agentId: t.slice(0, at), device: t.slice(at + 1), raw: t }
  }
  return { raw: t }
}

function targetMatchesSession(
  msg: BusMessage,
  device: BusDevice,
  session: BusPeerSession
): boolean {
  const parsed = parseTarget(msg.to.target)
  const t = parsed.raw
  if (!t) return false

  if (parsed.device && parsed.device !== norm(device.id) && parsed.device !== norm(device.name)) {
    return false
  }
  if (msg.to.deviceId && norm(msg.to.deviceId) !== norm(device.id)) return false

  if (t === 'all' || t === '*' || t === 'broadcast') return true
  if (t === 'local' || t === 'here') {
    return !msg.from.deviceId || norm(msg.from.deviceId) === norm(device.id)
  }
  if (t === norm(device.id) || t === norm(device.name)) return true
  if (t === norm(session.busId) || t === norm(session.ptyId)) return true
  if (session.busId && t === norm(session.busId.slice(0, 8))) return true
  if (session.ptyId && t === norm(session.ptyId.slice(0, 8))) return true
  if (parsed.agentId && parsed.agentId === norm(session.agentId)) return true
  if (t === norm(session.agentId)) return true
  if (msg.to.sessionId && norm(msg.to.sessionId) === norm(session.busId)) return true
  if (msg.to.sessionId && norm(msg.to.sessionId) === norm(session.ptyId)) return true
  if (msg.to.agentId && norm(msg.to.agentId) === norm(session.agentId)) return true
  return false
}

function isFromSelf(msg: BusMessage, session: BusPeerSession): boolean {
  const fromSid = norm(msg.from.sessionId)
  if (!fromSid) return false
  return fromSid === norm(session.busId) || fromSid === norm(session.ptyId)
}

function injectText(msg: BusMessage): string {
  const who = [
    msg.from.agentId || 'agent',
    msg.from.deviceName || msg.from.deviceId?.slice(0, 8) || 'peer'
  ].join('@')
  const sid = msg.from.sessionId ? msg.from.sessionId.slice(0, 8) : ''
  const header = `[TrueDeck bus] from ${who}${sid ? ` (${sid})` : ''}:`
  const body = String(msg.body || '').slice(0, MAX_BODY)
  const nl = process.platform === 'win32' ? '\r' : '\n'
  return `${nl}${nl}${header}${nl}${body}${nl}`
}

function publishPresence(sessions: SessionInfo[]): void {
  const device = ensureDevice()
  const bindings = loadBindings()
  const byPty = new Map(bindings.map((b) => [b.ptyId, b]))
  const live = sessions.filter((s) => s.status === 'running' && s.kind !== 'document')
  const liveIds = new Set(live.map((s) => s.id))
  const nextBindings = bindings.filter((b) => liveIds.has(b.ptyId))
  if (nextBindings.length !== bindings.length) saveBindings(nextBindings)

  const peers: BusPeerSession[] = live.map((s) => {
    const b = byPty.get(s.id)
    return {
      busId: b?.busId || s.id,
      ptyId: s.id,
      agentId: s.agentId,
      agentName: s.agentName,
      title: s.title || b?.title,
      projectRoot: s.projectRoot,
      kind: s.kind || 'agent',
      status: s.status
    }
  })

  const presence: BusPresence = {
    deviceId: device.id,
    deviceName: device.name,
    platform: process.platform,
    updatedAt: Date.now(),
    online: true,
    sessions: peers
  }
  writeJson(join(devicesDir(), `${device.id}.json`), presence)
}

function markPresenceOffline(): void {
  try {
    const device = ensureDevice()
    const p = join(devicesDir(), `${device.id}.json`)
    const cur = readJson<Partial<BusPresence>>(p, {})
    writeJson(p, {
      ...cur,
      deviceId: device.id,
      deviceName: device.name,
      platform: process.platform,
      updatedAt: Date.now(),
      online: false,
      sessions: []
    })
  } catch {
    /* ignore */
  }
}

async function deliverPending(opts: {
  listSessions: () => Promise<SessionInfo[]>
  writeSession: (id: string, data: string) => Promise<void>
}): Promise<void> {
  const device = ensureDevice()
  const live = await opts.listSessions()
  const bindings = loadBindings()
  const byPty = new Map(bindings.map((b) => [b.ptyId, b]))
  const sessions: BusPeerSession[] = live
    .filter((s) => s.status === 'running' && s.kind !== 'document')
    .map((s) => {
      const b = byPty.get(s.id)
      return {
        busId: b?.busId || s.id,
        ptyId: s.id,
        agentId: s.agentId,
        agentName: s.agentName,
        title: s.title,
        projectRoot: s.projectRoot,
        kind: s.kind || 'agent',
        status: s.status
      }
    })
  if (!sessions.length) return

  const injected = loadInjected()
  for (const path of listMessageFiles()) {
    const msg = loadMessage(path)
    if (!msg) continue
    if (injected[msg.id]) continue
    if (msg.deliver === 'inbox') continue
    const created = Number(msg.createdAt) || 0
    if (created && Date.now() - created > MESSAGE_TTL_MS) continue

    const matches = sessions.filter(
      (s) => targetMatchesSession(msg, device, s) && !isFromSelf(msg, s)
    )
    if (!matches.length) continue

    let any = false
    for (const s of matches) {
      if (!s.ptyId) continue
      try {
        await opts.writeSession(s.ptyId, injectText(msg))
        any = true
      } catch (e) {
        console.warn('[agent-bus] inject failed', s.ptyId, e)
      }
    }
    if (any) markInjected(msg.id)
  }
}

export function startAgentBus(opts: {
  listSessions: () => Promise<SessionInfo[]>
  writeSession: (id: string, data: string) => Promise<void>
}): () => void {
  ensureDevice()
  let stopped = false
  let delivering = false

  const heartbeat = async (): Promise<void> => {
    if (stopped) return
    try {
      const list = await opts.listSessions()
      publishPresence(list)
    } catch (e) {
      console.warn('[agent-bus] presence', e)
    }
  }

  const deliver = async (): Promise<void> => {
    if (stopped || delivering) return
    delivering = true
    try {
      await deliverPending(opts)
    } catch (e) {
      console.warn('[agent-bus] deliver', e)
    } finally {
      delivering = false
    }
  }

  const hb = setInterval(() => {
    void heartbeat()
  }, HEARTBEAT_MS)
  const dv = setInterval(() => {
    void deliver()
  }, DELIVER_MS)
  const prune = setInterval(() => {
    try {
      pruneMessages()
    } catch {
      /* ignore */
    }
  }, 60_000)

  void heartbeat()
  void deliver()

  return () => {
    stopped = true
    clearInterval(hb)
    clearInterval(dv)
    clearInterval(prune)
    markPresenceOffline()
  }
}
