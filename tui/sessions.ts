import type { IPty } from 'node-pty'
import { resolveCommand } from './resolve'
import type { AgentPreset } from './agents'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty')

export interface Session {
  id: string
  name: string
  agentId: string
  color: string
  cwd: string
  proc: IPty
  status: 'running' | 'exited'
  buf: string
  exitCode?: number
}

let seq = 0

export class SessionManager {
  sessions: Session[] = []
  activeId: string | null = null

  get active(): Session | null {
    return this.sessions.find((s) => s.id === this.activeId) || this.sessions[0] || null
  }

  spawn(agent: AgentPreset, cwd: string, cols = 120, rows = 30): Session {
    const resolved = resolveCommand(agent.id, agent.command, [...(agent.args || [])])
    let proc: IPty
    try {
      proc = pty.spawn(resolved.command, resolved.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TRUEDECK: '1',
          TRUEDECK_PROJECT: cwd,
          TRUEDECK_AGENT: agent.id,
          TRUEDECK_UI: 'tui'
        } as Record<string, string>,
        useConpty: process.platform === 'win32'
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
      const shellArgs = process.platform === 'win32' ? ['-NoLogo'] : []
      proc = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as Record<string, string>,
        useConpty: process.platform === 'win32'
      })
      setTimeout(() => {
        proc.write(
          process.platform === 'win32'
            ? `Write-Host "Failed to launch ${agent.name}: ${msg}" -ForegroundColor Red\r\n`
            : `echo "Failed to launch ${agent.name}: ${msg}"\r`
        )
      }, 80)
    }

    const id = `s${++seq}`
    const session: Session = {
      id,
      name: agent.name,
      agentId: agent.id,
      color: agent.color,
      cwd,
      proc,
      status: 'running',
      buf: ''
    }

    proc.onData((data) => {
      session.buf += data
      // cap buffer for preview
      if (session.buf.length > 200_000) session.buf = session.buf.slice(-150_000)
    })

    proc.onExit(({ exitCode }) => {
      session.status = 'exited'
      session.exitCode = exitCode
    })

    this.sessions.push(session)
    this.activeId = id
    return session
  }

  spawnCommand(label: string, command: string, cwd: string, cols = 120, rows = 30): Session {
    const isWin = process.platform === 'win32'
    const agent: AgentPreset = {
      id: `cmd-${label}`,
      name: label,
      command: isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
      args: isWin
        ? ['-NoLogo', '-NoExit', '-Command', command]
        : ['-lc', `${command}; exec bash`],
      color: 'blue'
    }
    return this.spawn(agent, cwd, cols, rows)
  }

  kill(id: string): void {
    const s = this.sessions.find((x) => x.id === id)
    if (!s) return
    try {
      // SIGKILL on Windows via node-pty; try graceful then force
      s.proc.kill()
    } catch {
      // ignore
    }
    try {
      // Some Windows agents leave children; second signal helps
      s.proc.kill('SIGKILL')
    } catch {
      // ignore
    }
    this.sessions = this.sessions.filter((x) => x.id !== id)
    if (this.activeId === id) {
      this.activeId = this.sessions[this.sessions.length - 1]?.id || null
    }
  }

  /** Close tab by list index (0-based). */
  killIndex(i: number): boolean {
    const s = this.sessions[i]
    if (!s) return false
    this.kill(s.id)
    return true
  }

  killActive(): boolean {
    if (!this.activeId) return false
    this.kill(this.activeId)
    return true
  }

  select(id: string): void {
    if (this.sessions.some((s) => s.id === id)) this.activeId = id
  }

  selectIndex(i: number): void {
    const s = this.sessions[i]
    if (s) this.activeId = s.id
  }

  dispose(): void {
    for (const s of [...this.sessions]) this.kill(s.id)
  }
}
