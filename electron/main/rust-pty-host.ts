/**
 * Client for the Rust truedeck-pty sidecar (JSON-lines over stdio).
 * Falls back gracefully when the binary is missing - PtyManager uses node-pty.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { createInterface } from 'readline'

export type RustPtyEvent =
 | { type: 'ready'; version: string }
 | { type: 'spawned'; id: string }
 | { type: 'data'; id: string; data_b64: string }
 | { type: 'exit'; id: string; code: number }
 | { type: 'error'; id?: string | null; message: string }
 | { type: 'pong' }
 | { type: 'list'; ids: string[] }

type Handler = (ev: RustPtyEvent) => void

function candidateBinaries(): string[] {
 const name = process.platform === 'win32' ? 'truedeck-pty.exe' : 'truedeck-pty'
 const list: string[] = []
 try {
 if (app.isPackaged) {
 list.push(join(process.resourcesPath, name))
 list.push(join(process.resourcesPath, 'bin', name))
 }
 } catch {
 // app may not be ready in tests
 }
 // Dev: crates/truedeck-pty/target/release|debug
 const root = app.isPackaged ? '' : process.cwd()
 if (root) {
 list.push(join(root, 'crates', 'truedeck-pty', 'target', 'release', name))
 list.push(join(root, 'crates', 'truedeck-pty', 'target', 'debug', name))
 list.push(join(root, 'resources', 'bin', name))
 }
 // Optional env override
 if (process.env.TRUEDECK_PTY_BIN) list.unshift(process.env.TRUEDECK_PTY_BIN)
 return list
}

export function findRustPtyBinary(): string | null {
 for (const p of candidateBinaries()) {
 if (p && existsSync(p)) return p
 }
 return null
}

/** Bytes at the end of `buf` that form an incomplete UTF-8 character (0-3). */
export function incompleteUtf8Tail(buf: Buffer): number {
 const n = buf.length
 if (n === 0) return 0
 // Walk back over continuation bytes (max 3)
 let i = n - 1
 let cont = 0
 while (i >= 0 && cont < 3 && (buf[i]! & 0xc0) === 0x80) {
 cont++
 i--
 }
 if (i < 0) return 0 // orphan continuations - emit as-is (replacement chars)
 const lead = buf[i]!
 if ((lead & 0x80) === 0) return 0 // ASCII
 let need = 0
 if ((lead & 0xe0) === 0xc0) need = 2
 else if ((lead & 0xf0) === 0xe0) need = 3
 else if ((lead & 0xf8) === 0xf0) need = 4
 else return 0
 const have = n - i
 return have < need ? have : 0
}

export class RustPtyHost {
 private proc: ChildProcessWithoutNullStreams | null = null
 private ready = false
 private handlers = new Set<Handler>()
 private pendingSpawn = new Map<
 string,
 { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
 >()
 /**
 * Incomplete UTF-8 tails per session - ConPTY/read chunks can split multi-byte
 * characters across data events. Decoding each chunk alone produces U+FFFD
 * garbage that looks like "cut off" text until more bytes arrive (and even then
 * the prior replacement chars stay wrong).
 */
 private utf8Carry = new Map<string, Buffer>()

 get isReady(): boolean {
 return this.ready && this.proc !== null
 }

 /**
 * Decode base64 PTY bytes to UTF-8, carrying incomplete multi-byte tails.
 * Returns '' when the whole chunk was only an incomplete sequence (held).
 */
 decodeUtf8(id: string, dataB64: string): string {
 const chunk = Buffer.from(dataB64, 'base64')
 if (!chunk.length) return ''
 const prev = this.utf8Carry.get(id)
 const buf = prev && prev.length ? Buffer.concat([prev, chunk]) : chunk
 const keep = incompleteUtf8Tail(buf)
 const emitEnd = buf.length - keep
 if (keep > 0) this.utf8Carry.set(id, Buffer.from(buf.subarray(emitEnd)))
 else this.utf8Carry.delete(id)
 if (emitEnd <= 0) return ''
 return buf.subarray(0, emitEnd).toString('utf8')
 }

 clearUtf8Carry(id: string): void {
 this.utf8Carry.delete(id)
 }

 onEvent(cb: Handler): () => void {
 this.handlers.add(cb)
 return () => this.handlers.delete(cb)
 }

 private emit(ev: RustPtyEvent): void {
 for (const h of this.handlers) {
 try {
 h(ev)
 } catch {
 // ignore
 }
 }
 }

 start(): boolean {
 if (this.proc) return this.ready
 const bin = findRustPtyBinary()
 if (!bin) return false

 try {
 this.proc = spawn(bin, [], {
 stdio: ['pipe', 'pipe', 'pipe'],
 windowsHide: true,
 env: { ...process.env }
 })
 } catch {
 this.proc = null
 return false
 }

 const rl = createInterface({ input: this.proc.stdout })
 rl.on('line', (line) => {
 let ev: RustPtyEvent
 try {
 ev = JSON.parse(line) as RustPtyEvent
 } catch {
 return
 }
 if (ev.type === 'ready') {
 this.ready = true
 }
 if (ev.type === 'spawned') {
 const p = this.pendingSpawn.get(ev.id)
 if (p) {
 clearTimeout(p.timer)
 this.pendingSpawn.delete(ev.id)
 p.resolve()
 }
 }
 if (ev.type === 'error' && ev.id) {
 const p = this.pendingSpawn.get(ev.id)
 if (p) {
 clearTimeout(p.timer)
 this.pendingSpawn.delete(ev.id)
 p.reject(new Error(ev.message))
 }
 }
 this.emit(ev)
 })

 this.proc.stderr.on('data', (buf: Buffer) => {
 const msg = buf.toString('utf8').trim()
 if (msg) {
 this.emit({ type: 'error', message: `[rust-pty stderr] ${msg}` })
 }
 })

 this.proc.on('exit', () => {
 this.ready = false
 this.proc = null
 for (const [, p] of this.pendingSpawn) {
 clearTimeout(p.timer)
 p.reject(new Error('rust-pty exited'))
 }
 this.pendingSpawn.clear()
 })

 // Wait briefly for ready line (sync-ish via flag set on first event)
 return true
 }

 private send(obj: Record<string, unknown>): void {
 if (!this.proc?.stdin.writable) throw new Error('rust-pty not running')
 this.proc.stdin.write(JSON.stringify(obj) + '\n')
 }

 async waitReady(ms = 2000): Promise<boolean> {
 if (this.ready) return true
 if (!this.proc) return false
 const start = Date.now()
 while (Date.now() - start < ms) {
 if (this.ready) return true
 await new Promise((r) => setTimeout(r, 20))
 }
 return this.ready
 }

 spawn(opts: {
 id: string
 command: string
 args: string[]
 cwd: string
 cols: number
 rows: number
 env: Record<string, string>
 }): Promise<void> {
 return new Promise((resolve, reject) => {
 const timer = setTimeout(() => {
 this.pendingSpawn.delete(opts.id)
 reject(new Error('rust-pty spawn timeout'))
 }, 8000)
 this.pendingSpawn.set(opts.id, { resolve, reject, timer })
 try {
 this.send({
 type: 'spawn',
 id: opts.id,
 command: opts.command,
 args: opts.args,
 cwd: opts.cwd,
 cols: opts.cols,
 rows: opts.rows,
 env: opts.env
 })
 } catch (e) {
 clearTimeout(timer)
 this.pendingSpawn.delete(opts.id)
 reject(e instanceof Error ? e : new Error(String(e)))
 }
 })
 }

 write(id: string, data: string): void {
 this.send({
 type: 'write',
 id,
 data_b64: Buffer.from(data, 'utf8').toString('base64')
 })
 }

 resize(id: string, cols: number, rows: number): void {
 this.send({ type: 'resize', id, cols, rows })
 }

 kill(id: string): void {
 try {
 this.send({ type: 'kill', id })
 } catch {
 // ignore
 }
 }

 shutdown(): void {
 try {
 this.send({ type: 'shutdown' })
 } catch {
 // ignore
 }
 try {
 this.proc?.kill()
 } catch {
 // ignore
 }
 this.proc = null
 this.ready = false
 }
}

let shared: RustPtyHost | null = null

/** Try to start the shared Rust host; returns null if binary missing or failed. */
export async function getRustPtyHost(): Promise<RustPtyHost | null> {
 if (shared?.isReady) return shared
 if (!findRustPtyBinary()) return null
 if (!shared) shared = new RustPtyHost()
 if (!shared.start()) {
 shared = null
 return null
 }
 const ok = await shared.waitReady(2500)
 if (!ok) {
 shared.shutdown()
 shared = null
 return null
 }
 return shared
}

export function shutdownRustPtyHost(): void {
 shared?.shutdown()
 shared = null
}
