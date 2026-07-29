/**
 * Session operations via the primary Rust engine only (truedeck-backend).
 * No node-pty / truedeck-pty fallbacks.
 */
import type { BrowserWindow } from 'electron'
import {
  getBackend,
  getSharedBackend,
  findBackendBinary,
  type BackendBridge
} from './backend-bridge'
import type { SessionInfo } from '../shared/types'

let win: BrowserWindow | null = null

export function setSessionsWindow(w: BrowserWindow | null): void {
  win = w
  getSharedBackend()?.setWindow(w)
}

export async function requireRustBackend(): Promise<BackendBridge> {
  let b = getSharedBackend()
  if (b?.isReady) {
    if (win) b.setWindow(win)
    return b
  }
  b = await getBackend()
  if (!b?.isReady) {
    throw new Error(
      'Rust truedeck-backend is required and is not running. ' +
        'Run `npm run build:backend` (needs Rust) or install a TrueDeck release that ships resources/bin/truedeck-backend.'
    )
  }
  if (win) b.setWindow(win)
  return b
}

export async function rustRequest<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  const b = await requireRustBackend()
  return b.request<T>(method, params)
}

export async function listSessions(): Promise<SessionInfo[]> {
  const list = await rustRequest<SessionInfo[]>('sessions.list', {})
  return Array.isArray(list) ? list : []
}

export async function spawnAgent(params: {
  projectRoot: string
  agentId: string
  cols?: number
  rows?: number
  command?: string
  args?: string[]
  agentName?: string
  color?: string
  env?: Record<string, string>
}): Promise<SessionInfo> {
  return rustRequest<SessionInfo>('sessions.spawn', params)
}

export async function spawnCommand(params: {
  projectRoot: string
  label: string
  command: string
  color?: string
  cols?: number
  rows?: number
}): Promise<SessionInfo> {
  return rustRequest<SessionInfo>('sessions.spawnCommand', params)
}

export async function writeSession(id: string, data: string): Promise<void> {
  await rustRequest('sessions.write', { id, data })
}

export async function resizeSession(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  await rustRequest('sessions.resize', { id, cols, rows })
}

export async function killSession(id: string): Promise<void> {
  await rustRequest('sessions.kill', { id })
}

export function backendStatus(): {
  backend: 'rust'
  rustBinary: string | null
  version: string | null
} {
  const b = getSharedBackend()
  if (!b?.isReady) {
    throw new Error('Rust truedeck-backend is not running')
  }
  return {
    backend: 'rust',
    rustBinary: findBackendBinary(),
    version: b.version
  }
}
