import { BrowserWindow } from 'electron'
import * as os from 'os'
import type { IPty } from 'node-pty'
import { v4 as uuid } from 'uuid'
import type { AgentPreset, SessionInfo } from '../shared/types'
import { buildAgentBootstrapPrompt } from './memory'

// node-pty is a native module; require keeps electron-vite externalization happy
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty')

interface LiveSession {
  info: SessionInfo
  proc: IPty
}

export class PtyManager {
  private sessions = new Map<string, LiveSession>()
  private win: BrowserWindow | null = null

  setWindow(win: BrowserWindow | null): void {
    this.win = win
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info)
  }

  spawn(opts: {
    projectRoot: string
    agent: AgentPreset
    cols?: number
    rows?: number
    injectMemoryHint?: boolean
  }): SessionInfo {
    const id = uuid()
    const shell = opts.agent.command
    const args = [...(opts.agent.args || [])]
    const cwd = opts.projectRoot
    const env = {
      ...process.env,
      TRUEDECK: '1',
      TRUEDECK_PROJECT: cwd,
      TRUEDECK_AGENT: opts.agent.id
    } as Record<string, string>

    let proc: IPty
    try {
      proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: opts.cols || 120,
        rows: opts.rows || 30,
        cwd,
        env,
        useConpty: process.platform === 'win32'
      })
    } catch (err) {
      // Fallback: open a shell and print the error so the UI still works
      const fallbackShell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
      const fallbackArgs = process.platform === 'win32' ? ['-NoLogo'] : []
      proc = pty.spawn(fallbackShell, fallbackArgs, {
        name: 'xterm-256color',
        cols: opts.cols || 120,
        rows: opts.rows || 30,
        cwd,
        env
      })
      const msg = err instanceof Error ? err.message : String(err)
      setTimeout(() => {
        proc.write(
          process.platform === 'win32'
            ? `Write-Host "Failed to launch ${opts.agent.name} (${shell}). ${msg}" -ForegroundColor Red\r\n`
            : `echo "Failed to launch ${opts.agent.name} (${shell}). ${msg}"\r`
        )
      }, 100)
    }

    const info: SessionInfo = {
      id,
      agentId: opts.agent.id,
      agentName: opts.agent.name,
      color: opts.agent.color,
      projectRoot: cwd,
      status: 'running',
      createdAt: Date.now(),
      title: opts.agent.name
    }

    proc.onData((data: string) => {
      this.win?.webContents.send('pty:data', { id, data })
    })

    proc.onExit(({ exitCode }) => {
      const live = this.sessions.get(id)
      if (live) {
        live.info.status = 'exited'
        live.info.exitCode = exitCode
      }
      this.win?.webContents.send('pty:exit', { id, exitCode })
      this.sessions.delete(id)
    })

    this.sessions.set(id, { info, proc })

    if (opts.injectMemoryHint !== false) {
      // Soft hint after short delay so the agent/shell is ready
      const hint = buildAgentBootstrapPrompt(cwd)
      setTimeout(() => {
        // Don't auto-type into interactive TUIs aggressively — write a one-line pointer
        const oneLiner =
          process.platform === 'win32'
            ? `# TrueDeck memory: global=%USERPROFILE%\\.truedeck is mirrored under app data; repo=.memory — read INDEX.md\r\n`
            : `# TrueDeck: read .memory/INDEX.md (repo) + global memory for cross-project context\r`
        // Only inject into plain shell; agents have their own UIs
        if (opts.agent.id === 'shell') {
          proc.write(oneLiner)
        } else {
          // Expose path via env already; optional silent no-op
          void hint
        }
      }, 200)
    }

    this.win?.webContents.send('pty:spawned', info)
    return info
  }

  /** Spawn a background-ish on-open command in its own pane */
  spawnCommand(opts: {
    projectRoot: string
    label: string
    command: string
    color?: string
    cols?: number
    rows?: number
  }): SessionInfo {
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
      injectMemoryHint: false
    })
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.proc.resize(cols, rows)
    } catch {
      // ignore
    }
  }

  kill(id: string): void {
    const live = this.sessions.get(id)
    if (!live) return
    try {
      live.proc.kill()
    } catch {
      // ignore
    }
    this.sessions.delete(id)
    this.win?.webContents.send('pty:exit', { id, exitCode: -1 })
  }

  killAllForProject(projectRoot: string): void {
    for (const [id, live] of this.sessions) {
      if (live.info.projectRoot === projectRoot) this.kill(id)
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}

export const ptyManager = new PtyManager()

// silence unused import warning if os used later
void os
