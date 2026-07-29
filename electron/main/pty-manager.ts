import { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import { v4 as uuid } from 'uuid'
import type { AgentPreset, SessionInfo } from '../shared/types'
import { resolveAgentCommand } from './resolve-command'
import { memoryEnv } from './memory-service'
import {
 getRustPtyHost,
 shutdownRustPtyHost,
 type RustPtyHost,
 findRustPtyBinary
} from './rust-pty-host'
import { maybeWrapAgentFrame } from './agent-frame'

// node-pty is a native module; require keeps electron-vite externalization happy
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty')

interface LiveSession {
 info: SessionInfo
 /** Present when using node-pty backend */
 proc?: IPty
 backend: 'node' | 'rust'
 /** Last applied size - skip no-op WINCH (agent TUIs clear+redraw on every resize) */
 cols?: number
 rows?: number
}

export type PtyBackendKind = 'node' | 'rust' | 'none'

/**
 * PTY session manager - prefers Rust sidecar (`truedeck-pty`) when built,
 * otherwise falls back to node-pty (ConPTY).
 */
export class PtyManager {
 private sessions = new Map<string, LiveSession>()
 private win: BrowserWindow | null = null
 private rust: RustPtyHost | null = null
 private backend: PtyBackendKind = 'none'
 private initPromise: Promise<void> | null = null

 setWindow(win: BrowserWindow | null): void {
 this.win = win
 }

 /** IPC to renderer - never throw if the window was already destroyed (quit path). */
 private safeSend(channel: string, payload: unknown): void {
 try {
 const w = this.win
 if (!w || w.isDestroyed()) return
 const wc = w.webContents
 if (!wc || wc.isDestroyed()) return
 wc.send(channel, payload)
 } catch {
 // ignore - common on app quit after BrowserWindow teardown
 }
 }

 /** Which engine will host new sessions. */
 getBackend(): PtyBackendKind {
 return this.backend === 'none' ? (findRustPtyBinary() ? 'rust' : 'node') : this.backend
 }

 /** Ensure Rust host is probed once (non-blocking after first call). */
 async ensureBackend(): Promise<PtyBackendKind> {
 if (!this.initPromise) {
 this.initPromise = this.initBackend()
 }
 await this.initPromise
 return this.backend
 }

 private async initBackend(): Promise<void> {
 try {
 const host = await getRustPtyHost()
 if (host?.isReady) {
 this.rust = host
 this.backend = 'rust'
 host.onEvent((ev) => {
 if (ev.type === 'data') {
 // Carry incomplete UTF-8 across chunks (see RustPtyHost.decodeUtf8)
 const text = host.decodeUtf8(ev.id, ev.data_b64)
 if (text) this.safeSend('pty:data', { id: ev.id, data: text })
 } else if (ev.type === 'exit') {
 host.clearUtf8Carry(ev.id)
 const live = this.sessions.get(ev.id)
 if (live) {
 live.info.status = 'exited'
 live.info.exitCode = ev.code
 }
 this.sessions.delete(ev.id)
 this.safeSend('pty:exit', { id: ev.id, exitCode: ev.code })
 }
 })
 return
 }
 } catch {
 // fall through
 }
 this.rust = null
 this.backend = 'node'
 }

 list(): SessionInfo[] {
 return [...this.sessions.values()].map((s) => s.info)
 }

 /** True if this manager owns a live session with the given id. */
 has(id: string): boolean {
 return this.sessions.has(id)
 }

 async spawn(opts: {
 projectRoot: string
 agent: AgentPreset
 cols?: number
 rows?: number
 injectMemoryHint?: boolean
 extraEnv?: Record<string, string>
 commandLine?: string
 }): Promise<SessionInfo> {
 await this.ensureBackend()

 const id = uuid()
 const resolved = resolveAgentCommand(opts.agent.id, opts.agent.command, [
 ...(opts.agent.args || [])
 ])
 if (!resolved.available) {
 const install =
 resolved.installCommand || opts.agent.installCommand || '(no install command known)'
 throw new Error(
 `${opts.agent.name} CLI not found (${opts.agent.command}). Install with: ${install}`
 )
 }
 let shell = resolved.command
 let args = [...resolved.args]
 // Final hard block - never spawn Cursor/VS Code IDE even if resolve slipped
 {
 const low = shell.toLowerCase().replace(/\//g, '\\')
 if (
 low.endsWith('cursor.exe') ||
 low.endsWith('\\cursor.cmd') ||
 low.includes('\\program files\\cursor\\') ||
 (low.includes('cursor') &&
 !low.includes('cursor-agent') &&
 !low.endsWith('node.exe') &&
 opts.agent.id === 'cursor')
 ) {
 throw new Error(
 'Blocked: Cursor IDE cannot be spawned. Use cursor-agent CLI only.'
 )
 }
 }
 const cwd = opts.projectRoot
 const mem = opts.extraEnv || memoryEnv(cwd)
 const cols = Math.max(40, opts.cols || 120)
 const rows = Math.max(12, opts.rows || 36)
 const env = {
 ...process.env,
 ...mem,
 TRUEDECK: '1',
 TRUEDECK_AGENT: opts.agent.id,
 TRUEDECK_RESOLVED: resolved.resolvedFrom || '',
 TRUEDECK_PTY: this.backend,
 TRUEDECK_PROJECT: cwd,
 // Agent TUIs need a real terminal identity (alt screen, colors, mouse).
 // xterm-256color + truecolor is what Grok's terminal-support docs expect.
 TERM: process.env.TERM || 'xterm-256color',
 COLORTERM: process.env.COLORTERM || 'truecolor',
 // Keep TrueDeck identity but advertise a mouse-capable host family so CLIs
 // that gate features on TERM_PROGRAM still enable mouse reporting / alt-screen.
 TERM_PROGRAM: process.env.TERM_PROGRAM || 'TrueDeck',
 TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION || '1.0.0',
 // Many full-screen CLIs (Grok Build, Codex) read these at boot before WINCH
 COLUMNS: String(cols),
 LINES: String(rows)
 } as Record<string, string>

 // In-PTY frame wrap disabled - nested ConPTY left agent CLIs blank.
 const isCommand = opts.agent.id.startsWith('cmd-') || Boolean(opts.commandLine)
 void maybeWrapAgentFrame

 const focusTitle = typeof mem.TRUEDECK_TASK_TITLE === 'string' ? mem.TRUEDECK_TASK_TITLE : undefined
 const focusIdea = typeof mem.TRUEDECK_TASK_IDEA === 'string' ? mem.TRUEDECK_TASK_IDEA : undefined
 const taskId = typeof mem.TRUEDECK_TASK === 'string' ? mem.TRUEDECK_TASK : undefined
 const roleLabel =
 typeof mem.TRUEDECK_ROLE_LABEL === 'string' ? mem.TRUEDECK_ROLE_LABEL : undefined
 const worktreeLabel =
 typeof mem.TRUEDECK_WORKTREE_LABEL === 'string' ? mem.TRUEDECK_WORKTREE_LABEL : undefined
 const info: SessionInfo = {
 id,
 agentId: opts.agent.id,
 agentName: opts.agent.name,
 color: opts.agent.color,
 projectRoot: cwd,
 status: 'running',
 createdAt: Date.now(),
 title: focusTitle || opts.agent.name,
 kind: isCommand ? 'command' : 'agent',
 commandLine: opts.commandLine || (isCommand ? opts.agent.description : undefined),
 focusTitle,
 focusIdea,
 taskId,
 taskStatus: taskId ? 'running' : undefined,
 roleLabel,
 worktreeLabel
 }

 if (this.backend === 'rust' && this.rust) {
 try {
 // Strip undefined env values
 const cleanEnv: Record<string, string> = {}
 for (const [k, v] of Object.entries(env)) {
 if (typeof v === 'string') cleanEnv[k] = v
 }
 await this.rust.spawn({
 id,
 command: shell,
 args,
 cwd,
 cols,
 rows,
 env: cleanEnv
 })
 this.sessions.set(id, { info, backend: 'rust', cols, rows })
 this.safeSend('pty:spawned', info)
 return info
 } catch (err) {
 // One-shot fallback to node-pty for this spawn
 console.warn('[pty] rust spawn failed, falling back to node-pty', err)
 }
 }

 return this.spawnNode(info, shell, args, cwd, env, cols, rows)
 }

 private spawnNode(
 info: SessionInfo,
 shell: string,
 args: string[],
 cwd: string,
 env: Record<string, string>,
 cols: number,
 rows: number
 ): SessionInfo {
 let proc: IPty
 try {
 proc = pty.spawn(shell, args, {
 name: 'xterm-256color',
 cols,
 rows,
 cwd,
 env,
 useConpty: process.platform === 'win32'
 })
 } catch (err) {
 const fallbackShell =
 process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
 const fallbackArgs = process.platform === 'win32' ? ['-NoLogo'] : []
 proc = pty.spawn(fallbackShell, fallbackArgs, {
 name: 'xterm-256color',
 cols,
 rows,
 cwd,
 env
 })
 const msg = err instanceof Error ? err.message : String(err)
 setTimeout(() => {
 proc.write(
 process.platform === 'win32'
 ? `Write-Host "Failed to launch ${info.agentName} (${shell}). ${msg}" -ForegroundColor Red\r\n`
 : `echo "Failed to launch ${info.agentName} (${shell}). ${msg}"\r`
 )
 }, 100)
 }

 const id = info.id
 proc.onData((data: string) => {
 this.safeSend('pty:data', { id, data })
 })

 proc.onExit(({ exitCode }) => {
 const live = this.sessions.get(id)
 if (live) {
 live.info.status = 'exited'
 live.info.exitCode = exitCode
 }
 this.safeSend('pty:exit', { id, exitCode })
 this.sessions.delete(id)
 })

 this.sessions.set(id, { info, proc, backend: 'node', cols, rows })
 this.safeSend('pty:spawned', info)
 return info
 }

 spawnCommand(opts: {
 projectRoot: string
 label: string
 command: string
 color?: string
 cols?: number
 rows?: number
 }): Promise<SessionInfo> {
 const isWin = process.platform === 'win32'
 const agent: AgentPreset = {
 id: `cmd-${opts.label}`,
 name: opts.label,
 command: isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
 args: isWin
 ? ['-NoLogo', '-NoExit', '-Command', opts.command]
 : ['-lc', opts.command + '; exec bash'],
 color: opts.color || '#3b82f6',
 icon: '▶',
 description: opts.command
 }
 return this.spawn({
 projectRoot: opts.projectRoot,
 agent,
 cols: opts.cols,
 rows: opts.rows,
 injectMemoryHint: false,
 commandLine: opts.command
 })
 }

 write(id: string, data: string): void {
 const live = this.sessions.get(id)
 if (!live) return
 if (live.backend === 'rust' && this.rust) {
 try {
 this.rust.write(id, data)
 } catch {
 // ignore
 }
 return
 }
 live.proc?.write(data)
 }

 /**
 * Resize the PTY. Pass force=true to always deliver WINCH even when size is
 * unchanged - full-screen agent TUIs (Grok) often stay black until a WINCH.
 */
 resize(id: string, cols: number, rows: number, force = false): void {
 const live = this.sessions.get(id)
 if (!live) return
 const c = Math.max(2, Math.floor(cols) || 80)
 const r = Math.max(2, Math.floor(rows) || 24)
 if (!force && live.cols === c && live.rows === r) return
 live.cols = c
 live.rows = r
 if (live.backend === 'rust' && this.rust) {
 try {
 this.rust.resize(id, c, r)
 } catch {
 // ignore
 }
 return
 }
 try {
 live.proc?.resize(c, r)
 } catch {
 // ignore
 }
 }

 kill(id: string): void {
 const live = this.sessions.get(id)
 if (!live) return
 // Remove first so re-entrant dispose/exit handlers cannot double-kill
 this.sessions.delete(id)
 try {
 if (live.backend === 'rust' && this.rust) {
 try {
 this.rust.kill(id)
 } catch {
 // ignore
 }
 } else {
 const proc = live.proc
 live.proc = undefined
 if (proc) {
 try {
 proc.kill()
 } catch {
 // ignore - ConPTY often already torn down on quit
 }
 try {
 // Some node-pty builds throw "Object has been destroyed" on second kill
 proc.kill('SIGKILL')
 } catch {
 // ignore
 }
 }
 }
 } catch {
 // ignore any native teardown races on app close
 }
 this.safeSend('pty:exit', { id, exitCode: -1 })
 }

 killAllForProject(projectRoot: string): void {
 for (const [id, live] of this.sessions) {
 if (live.info.projectRoot === projectRoot) this.kill(id)
 }
 }

 dispose(): void {
 try {
 const ids = [...this.sessions.keys()]
 for (const id of ids) {
 try {
 this.kill(id)
 } catch {
 // never let one session block shutdown
 }
 }
 this.sessions.clear()
 try {
 shutdownRustPtyHost()
 } catch {
 // ignore
 }
 this.rust = null
 this.backend = 'none'
 this.initPromise = null
 this.win = null
 } catch {
 // last-resort: never throw out of dispose during app.quit
 this.sessions.clear()
 this.win = null
 }
 }
}

export const ptyManager = new PtyManager()
