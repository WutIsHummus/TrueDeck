/**
 * Bridge from Electron IPC → Rust truedeck-backend (JSON-RPC over stdio).
 * Primary session engine. Returns null only when the binary is missing.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import { createInterface, type Interface } from 'readline'
import { getGlobalDataDir } from './paths'
import { incompleteUtf8Tail } from './utf8-carry'

type RpcResponse = {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

type RpcEvent = {
  event: string
  params: Record<string, unknown>
}

function candidateBinaries(): string[] {
  const name = process.platform === 'win32' ? 'truedeck-backend.exe' : 'truedeck-backend'
  const list: string[] = []
  if (process.env.TRUEDECK_BACKEND_BIN) list.push(process.env.TRUEDECK_BACKEND_BIN)
  try {
    if (app.isPackaged) {
      list.push(join(process.resourcesPath, 'bin', name))
      list.push(join(process.resourcesPath, name))
    }
  } catch {
    // ignore
  }
  const root = app.isPackaged ? '' : process.cwd()
  if (root) {
    list.push(join(root, 'crates', 'truedeck-backend', 'target', 'release', name))
    list.push(join(root, 'crates', 'truedeck-backend', 'target', 'debug', name))
    list.push(join(root, 'resources', 'bin', name))
  }
  return list
}

export function findBackendBinary(): string | null {
  for (const p of candidateBinaries()) {
    if (p && existsSync(p)) return p
  }
  return null
}

export class BackendBridge {
  private proc: ChildProcessWithoutNullStreams | null = null
  private rl: Interface | null = null
  private ready = false
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private win: BrowserWindow | null = null
  version: string | null = null
  /** Incomplete UTF-8 tails per PTY session (same as RustPtyHost). */
  private utf8Carry = new Map<string, Buffer>()

  get isReady(): boolean {
    return this.ready && this.proc !== null
  }

  setWindow(win: BrowserWindow | null): void {
    this.win = win
  }

  start(): boolean {
    if (this.proc) return this.ready
    const bin = findBackendBinary()
    if (!bin) return false

    try {
      this.proc = spawn(bin, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          TRUEDECK_DATA_DIR: getGlobalDataDir()
        }
      })
    } catch {
      this.proc = null
      return false
    }

    this.rl = createInterface({ input: this.proc.stdout })
    this.rl.on('line', (line) => this.onLine(line))

    this.proc.stderr.on('data', (buf: Buffer) => {
      const msg = buf.toString('utf8').trim()
      if (msg) console.warn('[backend stderr]', msg)
    })

    this.proc.on('exit', (code) => {
      console.warn('[backend] exited', code)
      this.ready = false
      this.proc = null
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error('backend exited'))
      }
      this.pending.clear()
    })

    return true
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    // Event push
    if (typeof msg.event === 'string') {
      this.handleEvent(msg as unknown as RpcEvent)
      return
    }

    // RPC response
    if (typeof msg.id === 'number') {
      const r = msg as unknown as RpcResponse
      const p = this.pending.get(r.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(r.id)
      if (r.ok) p.resolve(r.result)
      else p.reject(new Error(r.error || 'backend error'))
    }
  }

  private handleEvent(ev: RpcEvent): void {
    if (ev.event === 'ready') {
      this.ready = true
      this.version = String((ev.params as { version?: string }).version || '')
      console.log('[backend] rust truedeck-backend', this.version || '')
      return
    }
    if (ev.event === 'pty.data') {
      const id = String(ev.params.id || '')
      const b64 = String(ev.params.data_b64 || '')
      const chunk = Buffer.from(b64, 'base64')
      const prev = this.utf8Carry.get(id)
      const buf = prev && prev.length ? Buffer.concat([prev, chunk]) : chunk
      const keep = incompleteUtf8Tail(buf)
      const emitEnd = buf.length - keep
      if (keep > 0) this.utf8Carry.set(id, Buffer.from(buf.subarray(emitEnd)))
      else this.utf8Carry.delete(id)
      if (emitEnd > 0) {
        const data = buf.subarray(0, emitEnd).toString('utf8')
        this.win?.webContents.send('pty:data', { id, data })
      }
      return
    }
    if (ev.event === 'pty.exit') {
      const id = String(ev.params.id || '')
      this.utf8Carry.delete(id)
      const exitCode = Number(ev.params.exitCode ?? ev.params.code ?? 0)
      this.win?.webContents.send('pty:exit', { id, exitCode })
      return
    }
    if (ev.event === 'error') {
      console.warn('[backend event error]', ev.params)
    }
  }

  async waitReady(ms = 3000): Promise<boolean> {
    if (this.ready) return true
    if (!this.proc) return false
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (this.ready) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return this.ready
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin.writable) {
        reject(new Error('backend not running'))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`backend timeout: ${method}`))
      }, 30000)
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer
      })
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  shutdown(): void {
    try {
      if (this.proc?.stdin.writable) {
        this.proc.stdin.write(
          JSON.stringify({ id: this.nextId++, method: 'shutdown', params: {} }) + '\n'
        )
      }
    } catch {
      // ignore
    }
    try {
      this.proc?.kill()
    } catch {
      // ignore
    }
    this.rl?.close()
    this.proc = null
    this.ready = false
  }
}

let shared: BackendBridge | null = null

/**
 * Start the primary session backend: Rust `truedeck-backend`.
 * This is the required session engine (no node-pty fallback).
 */
export async function getBackend(): Promise<BackendBridge | null> {
  if (shared?.isReady) return shared
  const bin = findBackendBinary()
  if (!bin) {
    console.error(
      '[backend] truedeck-backend not found. Rust is required - ' +
        'run `npm run build:backend` or use a release that ships resources/bin/truedeck-backend.'
    )
    return null
  }
  if (!shared) shared = new BackendBridge()
  if (!shared.start()) {
    console.error('[backend] failed to start truedeck-backend at', bin)
    shared = null
    return null
  }
  // Give the native process a bit longer on cold Windows starts
  const ok = await shared.waitReady(8000)
  if (!ok) {
    console.error('[backend] truedeck-backend did not become ready in time')
    shared.shutdown()
    shared = null
    return null
  }
  console.log('[backend] primary engine: rust truedeck-backend', shared.version || bin)
  return shared
}

export function shutdownBackend(): void {
  shared?.shutdown()
  shared = null
}

export function getSharedBackend(): BackendBridge | null {
  return shared?.isReady ? shared : null
}
