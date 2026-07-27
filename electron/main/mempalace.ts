import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface MemPalaceStatus {
  installed: boolean
  cliPath: string | null
  mcpPath: string | null
  palacePath: string
  ready: boolean
  mode: 'native' | 'docker' | 'missing'
  message: string
  version?: string
}

function localBin(name: string): string {
  return join(homedir(), '.local', 'bin', name)
}

function defaultPalace(): string {
  return join(homedir(), '.mempalace', 'palace')
}

function findMempalaceCli(): string | null {
  const candidates = [
    localBin(process.platform === 'win32' ? 'mempalace.exe' : 'mempalace'),
    'mempalace'
  ]
  for (const c of candidates) {
    if (c === 'mempalace') continue
    if (existsSync(c)) return c
  }
  return candidates[0] && existsSync(candidates[0]) ? candidates[0] : null
}

function findMempalaceMcp(): string | null {
  const candidates = [
    localBin(process.platform === 'win32' ? 'mempalace-mcp.exe' : 'mempalace-mcp'),
    'mempalace-mcp'
  ]
  for (const c of candidates) {
    if (c.includes(homedir()) && existsSync(c)) return c
  }
  const local = localBin(process.platform === 'win32' ? 'mempalace-mcp.exe' : 'mempalace-mcp')
  return existsSync(local) ? local : null
}

/** Status of MemPalace without requiring Docker. */
export async function getMemPalaceStatus(): Promise<MemPalaceStatus> {
  const cliPath = findMempalaceCli()
  const mcpPath = findMempalaceMcp()
  const palacePath = defaultPalace()
  const installed = Boolean(cliPath || mcpPath)

  if (!installed) {
    return {
      installed: false,
      cliPath: null,
      mcpPath: null,
      palacePath,
      ready: false,
      mode: 'missing',
      message:
        'MemPalace not found. Install with: uv tool install mempalace  (no Docker needed)'
    }
  }

  let version: string | undefined
  if (cliPath) {
    try {
      const { stdout } = await execFileAsync(cliPath, ['--version'], {
        windowsHide: true,
        timeout: 8000
      })
      version = stdout.trim() || undefined
    } catch {
      // ignore
    }
  }

  // Ensure palace dir exists
  if (!existsSync(palacePath)) {
    if (cliPath) {
      try {
        await execFileAsync(cliPath, ['init', palacePath], {
          windowsHide: true,
          timeout: 30000
        })
      } catch {
        // init may need a project dir; palace folder may still work empty
      }
    }
  }

  return {
    installed: true,
    cliPath,
    mcpPath,
    palacePath,
    ready: Boolean(mcpPath),
    mode: 'native',
    message: mcpPath
      ? `Native MemPalace ready (no Docker). Palace: ${palacePath}`
      : 'mempalace CLI found but mempalace-mcp missing',
    version
  }
}

/**
 * Warm MemPalace so first MCP call is fast. Does not use Docker.
 * Optionally mines a project wing for per-repo memory.
 */
export async function ensureMemPalace(opts?: {
  projectRoot?: string
  wing?: string
}): Promise<MemPalaceStatus> {
  const status = await getMemPalaceStatus()
  if (!status.installed || !status.cliPath) return status

  // Light status ping
  try {
    await execFileAsync(status.cliPath, ['status', '--palace', status.palacePath], {
      windowsHide: true,
      timeout: 15000
    })
  } catch {
    // empty palace is fine
  }

  // Optional: mine project into a wing (async background, non-blocking for UI)
  if (opts?.projectRoot && existsSync(opts.projectRoot) && status.cliPath) {
    const wing = opts.wing || opts.projectRoot.split(/[/\\]/).filter(Boolean).pop() || 'project'
    // fire-and-forget mine — can take a while on large repos
    try {
      const child = spawn(
        status.cliPath,
        ['mine', opts.projectRoot, '--wing', wing, '--palace', status.palacePath],
        {
          windowsHide: true,
          detached: true,
          stdio: 'ignore'
        }
      )
      child.unref()
    } catch {
      // ignore mine failures
    }
  }

  return getMemPalaceStatus()
}

/** Suggested MCP config snippet for clients (Cursor/Grok/Claude). */
export function mempalaceMcpSnippet(status: MemPalaceStatus): {
  command: string
  args: string[]
} {
  return {
    command: status.mcpPath || 'mempalace-mcp',
    args: ['--palace', status.palacePath]
  }
}
