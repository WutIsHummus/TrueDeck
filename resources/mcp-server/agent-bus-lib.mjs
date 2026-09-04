/**
 * File-backed agent bus used by truedeck-hub MCP.
 * Layout matches electron/main/agent-bus.ts:
 *   <globalMemory>/.agent-bus/{devices,messages}/
 *   <dataDir>/device.json
 *   <dataDir>/agent-bus/read.json
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, hostname, platform } from 'node:os'
import { randomUUID } from 'node:crypto'

const MAX_BODY = 16 * 1024
const PRESENCE_STALE_MS = 45_000

function dataDir() {
  if (process.env.TRUEDECK_DATA_DIR) return process.env.TRUEDECK_DATA_DIR
  if (platform() === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'TrueDeck', 'data')
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'TrueDeck', 'data')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'TrueDeck', 'data')
}

function globalMemoryDir() {
  return join(dataDir(), 'memory')
}

export function busPublicDir() {
  return process.env.TRUEDECK_BUS_DIR || join(globalMemoryDir(), '.agent-bus')
}

function busLocalDir() {
  return join(dataDir(), 'agent-bus')
}

function devicePath() {
  return join(dataDir(), 'device.json')
}

function devicesDir() {
  return join(busPublicDir(), 'devices')
}

function messagesDir() {
  return join(busPublicDir(), 'messages')
}

function readPath() {
  return join(busLocalDir(), 'read.json')
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return raw == null ? fallback : raw
  } catch {
    return fallback
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function ensureDirs() {
  mkdirSync(devicesDir(), { recursive: true })
  mkdirSync(messagesDir(), { recursive: true })
  mkdirSync(busLocalDir(), { recursive: true })
}

export function ensureDevice() {
  ensureDirs()
  const existing = readJson(devicePath(), {})
  const name = String(process.env.TRUEDECK_DEVICE_NAME || hostname() || 'truedeck').trim()
  if (existing.id) {
    return { id: String(existing.id), name: String(existing.name || name) }
  }
  const device = { id: randomUUID(), name }
  writeJson(devicePath(), device)
  return device
}

export function whoami() {
  const device = ensureDevice()
  return {
    deviceId: process.env.TRUEDECK_DEVICE_ID || device.id,
    deviceName: process.env.TRUEDECK_DEVICE_NAME || device.name,
    sessionId: process.env.TRUEDECK_SESSION_ID || null,
    agentId: process.env.TRUEDECK_AGENT_ID || null,
    projectRoot: process.env.TRUEDECK_PROJECT || null,
    busDir: busPublicDir()
  }
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function isFresh(updatedAt) {
  const t = Number(updatedAt) || 0
  return t > 0 && Date.now() - t < PRESENCE_STALE_MS
}

export function listPeers() {
  ensureDirs()
  const me = whoami()
  const files = existsSync(devicesDir())
    ? readdirSync(devicesDir()).filter((n) => n.endsWith('.json'))
    : []
  const devices = []
  for (const name of files) {
    const raw = readJson(join(devicesDir(), name), null)
    if (!raw?.deviceId) continue
    const online = raw.online !== false && isFresh(raw.updatedAt)
    devices.push({
      deviceId: raw.deviceId,
      deviceName: raw.deviceName || raw.deviceId,
      platform: raw.platform,
      updatedAt: raw.updatedAt,
      online,
      self: raw.deviceId === me.deviceId,
      sessions: Array.isArray(raw.sessions) ? raw.sessions : []
    })
  }
  devices.sort((a, b) => Number(b.online) - Number(a.online) || String(a.deviceName).localeCompare(b.deviceName))
  const sessions = devices.flatMap((d) =>
    (d.sessions || []).map((s) => ({
      ...s,
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      online: d.online,
      selfSession: s.busId && s.busId === me.sessionId
    }))
  )
  return { you: me, devices, sessions }
}

function loadReadMap() {
  const raw = readJson(readPath(), {})
  return raw && typeof raw === 'object' ? raw : {}
}

function readKey(me) {
  return me.sessionId || `device:${me.deviceId}`
}

function alreadyRead(id, me) {
  const map = loadReadMap()
  const row = map[readKey(me)]
  const ids = Array.isArray(row?.ids) ? row.ids : []
  return ids.includes(id)
}

export function ackMessages(ids) {
  const me = whoami()
  const map = loadReadMap()
  const key = readKey(me)
  const prev = Array.isArray(map[key]?.ids) ? map[key].ids : []
  const next = [...new Set([...prev, ...ids.map(String)])].slice(-400)
  map[key] = { ids: next, updatedAt: Date.now() }
  writeJson(readPath(), map)
  return { ok: true, read: next.length }
}

function listMessageFiles() {
  if (!existsSync(messagesDir())) return []
  return readdirSync(messagesDir())
    .filter((n) => n.endsWith('.json'))
    .map((n) => join(messagesDir(), n))
}

function loadMessage(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw?.id || !raw.body) return null
    return raw
  } catch {
    return null
  }
}

function messageForMe(msg, me) {
  const t = norm(msg.to?.target)
  if (!t) return false
  if (t === 'all' || t === '*' || t === 'broadcast') return true
  if (t === 'local' || t === 'here') return norm(msg.from?.deviceId) === norm(me.deviceId) || !msg.from?.deviceId
  if (t === norm(me.deviceId) || t === norm(me.deviceName)) return true
  if (me.sessionId && (t === norm(me.sessionId) || t === norm(me.sessionId.slice(0, 8)))) return true
  if (me.agentId && t === norm(me.agentId)) return true
  const at = t.lastIndexOf('@')
  if (at > 0) {
    const agent = t.slice(0, at)
    const device = t.slice(at + 1)
    const deviceOk = device === norm(me.deviceId) || device === norm(me.deviceName)
    const agentOk = !me.agentId || agent === norm(me.agentId)
    return deviceOk && agentOk
  }
  if (msg.to.deviceId && norm(msg.to.deviceId) !== norm(me.deviceId)) return false
  if (msg.to.sessionId && me.sessionId && norm(msg.to.sessionId) === norm(me.sessionId)) return true
  if (msg.to.agentId && me.agentId && norm(msg.to.agentId) === norm(me.agentId)) return true
  return false
}

export function listInbox(opts = {}) {
  const me = whoami()
  const unreadOnly = opts.unreadOnly !== false
  const items = []
  for (const path of listMessageFiles()) {
    const msg = loadMessage(path)
    if (!msg) continue
    if (!messageForMe(msg, me)) continue
    if (me.sessionId && norm(msg.from?.sessionId) === norm(me.sessionId)) continue
    const unread = !alreadyRead(msg.id, me)
    if (unreadOnly && !unread) continue
    items.push({ ...msg, unread })
  }
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return { you: me, count: items.length, messages: items.slice(0, 50) }
}

export function sendMessage(input) {
  const me = whoami()
  const target = String(input.to || '').trim()
  const body = String(input.body || '').trim()
  if (!target) throw new Error('to is required (session id, agent id, device name, agent@device, local, or all)')
  if (!body) throw new Error('body is required')
  if (body.length > MAX_BODY) throw new Error(`body too long (max ${MAX_BODY} chars)`)
  ensureDirs()
  const deliver = input.deliver === 'inbox' || input.deliver === 'interrupt' ? input.deliver : 'both'
  const msg = {
    id: randomUUID(),
    createdAt: Date.now(),
    from: {
      deviceId: me.deviceId,
      deviceName: me.deviceName,
      sessionId: me.sessionId || undefined,
      agentId: me.agentId || undefined,
      title: input.fromTitle || undefined
    },
    to: {
      target,
      deviceId: input.deviceId || undefined,
      sessionId: input.sessionId || undefined,
      agentId: input.agentId || undefined
    },
    body,
    channel: input.channel ? String(input.channel) : undefined,
    deliver
  }
  writeJson(join(messagesDir(), `${msg.id}.json`), msg)
  return {
    ok: true,
    message: msg,
    hint:
      deliver === 'inbox'
        ? 'Stored in inbox. Recipient should call truedeck_inbox (or wait for interrupt if they use both).'
        : 'Stored. If the recipient has a live TrueDeck terminal, the message is typed into that session shortly.'
  }
}
