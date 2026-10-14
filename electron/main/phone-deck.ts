/**
 * Phone page on loopback, published the same way as the Photon UI:
 * ssh -R to the Oracle host so a phone can open the public address
 * from any network. The desktop app stays open; Send types into a live session.
 */
import { spawn, type ChildProcess } from 'child_process'
import type { BrowserWindow } from 'electron'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getSharedBackend } from './backend-bridge'
import { getGlobalDataDir } from './paths'
import { PHONE_PAGE } from './phone-page'
import {
  normCode,
  promptEnter,
  promptPayload,
  sessionAllowsPaste,
  visibleText
} from '../shared/phone-text'
import { listProjects } from './projects'
import { loadSessionLayout } from './session-layout'
import { listSessions, writeSession } from './sessions-rust'

const PHONE_PORT = 8787
const PUBLIC_HOST = '150.136.85.207'
const SSH_USER = 'openvpnas'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_PROMPT = 8000

export type PhoneUrl = { url: string; label: string }

export type PhoneDeckInfo = {
  enabled: boolean
  port: number | null
  token: string
  urls: PhoneUrl[]
  error?: string
}

type PublicSession = {
  id: string
  agentId: string
  agentName: string
  project: string
  projectId: string
  color: string
  status: string
}

type PublicProject = {
  id: string
  name: string
  hint: string
  color: string
}

let phoneWindow: BrowserWindow | null = null
/** Holds the phone's choice until the desktop layout file catches up. */
let pinnedProjectId: string | null = null

export function setPhoneWindow(win: BrowserWindow | null): void {
  phoneWindow = win
}

let httpServer: Server | null = null
let unlisten: (() => void) | null = null
let attachTimer: NodeJS.Timeout | null = null
let starting: Promise<PhoneDeckInfo> | null = null
let tunnel: ChildProcess | null = null
let tunnelStop = false
let tunnelTimer: NodeJS.Timeout | null = null
let info: PhoneDeckInfo = {
  enabled: false,
  port: null,
  token: '',
  urls: []
}

const rawBySession = new Map<string, string>()
const sentBySession = new Map<string, string[]>()
const loginFails = new Map<string, { n: number; reset: number }>()
const promptTimes = new Map<string, number[]>()

function tokenPath(): string {
  return join(getGlobalDataDir(), 'phone-deck.json')
}

function loadOrCreateToken(): string {
  try {
    const parsed = JSON.parse(readFileSync(tokenPath(), 'utf8')) as { token?: string }
    const token = normCode(parsed.token || '')
    if (token.length === 8) return token
  } catch {
    /* first run, or unreadable */
  }
  const bytes = randomBytes(8)
  let token = ''
  for (let i = 0; i < 8; i++) token += ALPHABET[bytes[i] % ALPHABET.length]
  try {
    mkdirSync(getGlobalDataDir(), { recursive: true })
    writeFileSync(tokenPath(), JSON.stringify({ token }), 'utf8')
  } catch {
    /* in-memory token still works until quit */
  }
  return token
}

function codesMatch(input: string, token: string): boolean {
  const ha = createHash('sha256').update(normCode(input)).digest()
  const hb = createHash('sha256').update(normCode(token)).digest()
  return timingSafeEqual(ha, hb)
}

function publicUrls(port: number): PhoneUrl[] {
  return [{ url: `http://${PUBLIC_HOST}:${port}`, label: 'Oracle' }]
}

function sshBin(): string {
  const win = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')
  return existsSync(win) ? win : 'ssh'
}

function oracleKeyPath(): string {
  return join(homedir(), '.ssh', 'oci-openvpn-2026-08-31-alt.key')
}

function tunnelAlive(): boolean {
  return !!tunnel && tunnel.exitCode == null && !tunnel.killed
}

/** Same pipe as the Photon UI: Oracle :port -> this PC's loopback page. */
function startPublicTunnel(port: number): void {
  tunnelStop = false
  const kick = (): void => {
    if (tunnelStop) return
    const key = oracleKeyPath()
    if (!existsSync(key)) {
      info = {
        ...info,
        error: 'The Oracle SSH key is not in the usual place, so the public link is down.'
      }
      return
    }
    let stderr = ''
    const child = spawn(
      sshBin(),
      [
        '-i',
        key,
        '-N',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'BatchMode=yes',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-R',
        `0.0.0.0:${port}:127.0.0.1:${port}`,
        `${SSH_USER}@${PUBLIC_HOST}`
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    tunnel = child
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-400)
    })
    child.on('exit', (code) => {
      if (tunnel === child) tunnel = null
      if (tunnelStop) return
      const why = stderr.trim() || `ssh exited ${code ?? ''}`.trim()
      info = { ...info, error: `Public link dropped. ${why}` }
      tunnelTimer = setTimeout(kick, 5000)
    })
  }
  if (tunnelTimer) clearTimeout(tunnelTimer)
  tunnelTimer = null
  kick()
}

function stopPublicTunnel(): void {
  tunnelStop = true
  if (tunnelTimer) clearTimeout(tunnelTimer)
  tunnelTimer = null
  const child = tunnel
  tunnel = null
  if (child && child.exitCode == null) child.kill()
}

function projectLabel(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join('/')
  return parts[0] || ''
}

function sameRoot(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

function resolveActiveProjectId(projects: { id: string; root: string }[]): string | null {
  let layoutRoot = ''
  try {
    layoutRoot = loadSessionLayout().activeProjectRoot || ''
  } catch {
    layoutRoot = ''
  }
  const fromLayout = layoutRoot
    ? projects.find((p) => sameRoot(p.root, layoutRoot))
    : undefined
  if (pinnedProjectId) {
    const pinned = projects.find((p) => p.id === pinnedProjectId)
    if (!pinned) pinnedProjectId = null
    else if (fromLayout && fromLayout.id === pinned.id) pinnedProjectId = null
    else return pinned.id
  }
  return fromLayout?.id || projects[0]?.id || null
}

function attachPty(): boolean {
  const backend = getSharedBackend()
  if (!backend) return false
  unlisten?.()
  unlisten = backend.onPush((channel, payload) => {
    if (!payload || typeof payload !== 'object') return
    const row = payload as { id?: unknown; data?: unknown }
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id) return
    if (channel === 'pty:data' && typeof row.data === 'string') {
      const prev = rawBySession.get(id) || ''
      rawBySession.set(id, (prev + row.data).slice(-200_000))
    } else if (channel === 'pty:exit') {
      rawBySession.delete(id)
    }
  })
  return true
}

function watchBackend(): void {
  if (attachPty()) return
  if (attachTimer) return
  attachTimer = setInterval(() => {
    if (attachPty() && attachTimer) {
      clearInterval(attachTimer)
      attachTimer = null
    }
  }, 500)
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || 'unknown'
}

function loginLocked(ip: string): boolean {
  const row = loginFails.get(ip)
  return !!row && Date.now() <= row.reset && row.n >= 8
}

function noteLoginFail(ip: string): void {
  const now = Date.now()
  const row = loginFails.get(ip)
  if (!row || now > row.reset) loginFails.set(ip, { n: 1, reset: now + 10 * 60 * 1000 })
  else row.n += 1
}

function promptLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (promptTimes.get(ip) || []).filter((t) => now - t < 60_000)
  if (recent.length >= 30) {
    promptTimes.set(ip, recent)
    return true
  }
  recent.push(now)
  promptTimes.set(ip, recent)
  return false
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return ''
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return ''
      }
    }
  }
  return ''
}

function authed(req: IncomingMessage, token: string): boolean {
  return codesMatch(readCookie(req.headers.cookie, 'td_phone'), token)
}

function cookieHeader(token: string): string {
  return `td_phone=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  })
  res.end(data)
}

function sendHtml(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  })
  res.end(PHONE_PAGE)
}

function readBody(req: IncomingMessage, limit = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let failed = false
    req.on('data', (chunk: Buffer | string) => {
      if (failed) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > limit) {
        failed = true
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      if (!failed) reject(err)
    })
  })
}

async function publicState(): Promise<{
  sessions: PublicSession[]
  frames: Record<string, string>
  sent: Record<string, string[]>
  projects: PublicProject[]
  activeProjectId: string | null
}> {
  const known = listProjects()
  const projects: PublicProject[] = known.map((p) => ({
    id: p.id,
    name: p.name,
    hint: projectLabel(p.root),
    color: p.color || ''
  }))
  const activeProjectId = resolveActiveProjectId(known)
  let sessions: PublicSession[] = []
  try {
    const live = await listSessions()
    sessions = live
      .filter((s) => s.status === 'running')
      .map((s) => {
        const match = known.find((p) => sameRoot(p.root, s.projectRoot || ''))
        return {
          id: s.id,
          agentId: s.agentId,
          agentName: s.agentName,
          project: projectLabel(s.projectRoot || ''),
          projectId: match?.id || '',
          color: s.color || '',
          status: s.status
        }
      })
  } catch {
    sessions = []
  }
  const frames: Record<string, string> = {}
  const sent: Record<string, string[]> = {}
  for (const session of sessions) {
    frames[session.id] = visibleText(rawBySession.get(session.id) || '')
    const notes = sentBySession.get(session.id)
    if (notes?.length) sent[session.id] = notes.slice(-8)
  }
  return { sessions, frames, sent, projects, activeProjectId }
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    const key = url.searchParams.get('k')
    if (key && codesMatch(key, token)) {
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': cookieHeader(token),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer'
      })
      res.end()
      return
    }
    sendHtml(res)
    return
  }

  if (req.method === 'POST' && path === '/api/login') {
    const ip = clientIp(req)
    if (loginLocked(ip)) {
      sendJson(res, 429, { error: 'Too many tries. Wait a few minutes and use the code on the desktop.' })
      return
    }
    let code = ''
    try {
      const parsed = JSON.parse(await readBody(req)) as { code?: string }
      code = String(parsed.code || '')
    } catch {
      sendJson(res, 400, { error: 'Enter the code shown on the desktop.' })
      return
    }
    if (!codesMatch(code, token)) {
      noteLoginFail(ip)
      sendJson(res, 401, { error: 'That code did not match the desktop.' })
      return
    }
    res.writeHead(204, {
      'Set-Cookie': cookieHeader(token),
      'Cache-Control': 'no-store'
    })
    res.end()
    return
  }

  if (path === '/api/state' || path === '/api/prompt' || path === '/api/project') {
    if (!authed(req, token)) {
      sendJson(res, 401, { error: 'Enter the code shown on the desktop.' })
      return
    }
  }

  if (req.method === 'GET' && path === '/api/state') {
    sendJson(res, 200, await publicState())
    return
  }

  if (req.method === 'POST' && path === '/api/project') {
    let id = ''
    try {
      const parsed = JSON.parse(await readBody(req)) as { id?: string }
      id = String(parsed.id || '')
    } catch {
      sendJson(res, 400, { error: 'Choose a project.' })
      return
    }
    const project = listProjects().find((p) => p.id === id)
    if (!project) {
      sendJson(res, 404, { error: 'That project is not on this desktop.' })
      return
    }
    const win = phoneWindow
    if (!win || win.isDestroyed()) {
      sendJson(res, 503, { error: 'The desktop window is not open.' })
      return
    }
    pinnedProjectId = project.id
    win.webContents.send('phone:open-project', project.id)
    sendJson(res, 200, { ok: true, id: project.id })
    return
  }

  if (req.method === 'POST' && path === '/api/prompt') {
    const ip = clientIp(req)
    if (promptLimited(ip)) {
      sendJson(res, 429, { error: 'Slow down a moment, then send again.' })
      return
    }
    let sessionId = ''
    let text = ''
    try {
      const parsed = JSON.parse(await readBody(req)) as { sessionId?: string; text?: string }
      sessionId = String(parsed.sessionId || '')
      text = String(parsed.text || '')
    } catch {
      sendJson(res, 400, { error: 'Send a prompt for a desktop session.' })
      return
    }
    if (text.trim().length > MAX_PROMPT) {
      sendJson(res, 400, { error: 'That prompt is too long for one send.' })
      return
    }
    const live = await listSessions().catch(() => [])
    const session = live.find((s) => s.id === sessionId && s.status === 'running')
    if (!session) {
      sendJson(res, 409, { error: 'That desktop session is not running. Pick another, or open an agent.' })
      return
    }
    const raw = rawBySession.get(sessionId) || ''
    const payload = promptPayload(text, sessionAllowsPaste(raw))
    if (!payload) {
      sendJson(res, 400, { error: 'Write a prompt first.' })
      return
    }
    try {
      await writeSession(sessionId, payload)
      // Let the TUI finish inserting the paste before the submit key.
      await new Promise((r) => setTimeout(r, 250))
      await writeSession(sessionId, promptEnter())
    } catch (err) {
      sendJson(res, 502, {
        error: err instanceof Error ? err.message : 'The desktop session did not take the prompt.'
      })
      return
    }
    const notes = sentBySession.get(sessionId) || []
    notes.push(text.trim().slice(0, 500))
    sentBySession.set(sessionId, notes.slice(-20))
    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

function listen(port: number, token: string): Promise<Server> {
  const server = createServer((req, res) => {
    void handle(req, res, token).catch((err) => {
      if (res.headersSent) return
      const tooLarge = err instanceof Error && err.message === 'too large'
      sendJson(res, tooLarge ? 413 : 500, {
        error: tooLarge ? 'That prompt is too long for one send.' : 'The phone page hit an error.'
      })
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeAllListeners('error')
      server.on('error', (err) => {
        console.warn('[phone] server error', err)
      })
      resolve(server)
    })
  })
}

async function bind(token: string): Promise<PhoneDeckInfo> {
  const port = PHONE_PORT
  try {
    httpServer = await listen(port, token)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    info = { enabled: false, port: null, token, urls: [], error: message }
    return info
  }
  const urls = publicUrls(port)
  info = { enabled: true, port, token, urls }
  watchBackend()
  startPublicTunnel(port)
  const started = Date.now()
  while (Date.now() - started < 2500) {
    if (!tunnelAlive()) break
    await new Promise((r) => setTimeout(r, 200))
  }
  if (tunnelAlive()) info = { ...info, error: undefined }
  console.log('[phone]', urls.map((u) => u.url).join(' '))
  return info
}

export function phoneDeckInfo(): PhoneDeckInfo {
  return info
}

export function startPhoneDeck(): Promise<PhoneDeckInfo> {
  if (httpServer && info.enabled) return Promise.resolve(info)
  if (starting) return starting
  const token = info.token || loadOrCreateToken()
  info = { ...info, token }
  starting = bind(token).finally(() => {
    starting = null
  })
  return starting
}

export function stopPhoneDeck(): void {
  if (attachTimer) clearInterval(attachTimer)
  attachTimer = null
  unlisten?.()
  unlisten = null
  stopPublicTunnel()
  const server = httpServer
  httpServer = null
  if (server) server.close()
  info = { ...info, enabled: false, port: null, urls: [] }
}
