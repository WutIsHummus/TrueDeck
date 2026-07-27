/**
 * Abstracted memory layer — users should never manage this manually.
 *
 * Responsibilities (all automatic):
 *  - Ensure per-repo + global file memory trees
 *  - Keep MemPalace warm (native, no Docker)
 *  - Background-mine the open project into a wing
 *  - Write a fresh auto-context file agents can read
 *  - Export env vars so every spawned agent inherits memory paths
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { ensureGlobalMemory, ensureRepoMemory } from './memory'
import { getMemPalaceStatus, ensureMemPalace } from './mempalace'
import { ensureEnabledProviders } from './memory-providers'

const execFileAsync = promisify(execFile)

export interface MemoryRuntimeStatus {
  ok: boolean
  label: string
  detail: string
  autoContextPath?: string
  palacePath?: string
  repoMemory?: string
  globalMemory?: string
}

const mineCooldown = new Map<string, number>()
const MINE_EVERY_MS = 30 * 60 * 1000

function truedeckDir(projectRoot: string): string {
  return join(projectRoot, '.truedeck')
}

function autoContextPath(projectRoot: string): string {
  return join(truedeckDir(projectRoot), 'auto-context.md')
}

function mempalaceCli(): string | null {
  const p = join(
    homedir(),
    '.local',
    'bin',
    process.platform === 'win32' ? 'mempalace.exe' : 'mempalace'
  )
  return existsSync(p) ? p : null
}

function palacePath(): string {
  return join(homedir(), '.mempalace', 'palace')
}

function wingName(projectRoot: string): string {
  return basename(projectRoot).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'project'
}

function listRecentNotes(dir: string, limit = 8): string[] {
  if (!existsSync(dir)) return []
  const files: { path: string; mtime: number }[] = []
  const walk = (d: string): void => {
    try {
      for (const name of readdirSync(d)) {
        if (name === 'sessions' || name.startsWith('.')) continue
        const full = join(d, name)
        const st = statSync(full)
        if (st.isDirectory()) walk(full)
        else if (name.endsWith('.md') && name !== 'INDEX.md' && name !== 'README.md') {
          files.push({ path: full, mtime: st.mtimeMs })
        }
      }
    } catch {
      // ignore
    }
  }
  walk(dir)
  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => f.path)
}

function readHead(file: string, max = 400): string {
  try {
    const t = readFileSync(file, 'utf8').trim()
    if (t.length <= max) return t
    return t.slice(0, max) + '…'
  } catch {
    return ''
  }
}

async function mempalaceWakeUp(projectRoot: string): Promise<string> {
  const cli = mempalaceCli()
  if (!cli) return ''
  const wing = wingName(projectRoot)
  try {
    const { stdout } = await execFileAsync(
      cli,
      ['wake-up', '--wing', wing, '--palace', palacePath()],
      { windowsHide: true, timeout: 12000, encoding: 'utf8' }
    )
    return (stdout || '').trim().slice(0, 4000)
  } catch {
    try {
      const { stdout } = await execFileAsync(cli, ['wake-up', '--palace', palacePath()], {
        windowsHide: true,
        timeout: 12000,
        encoding: 'utf8'
      })
      return (stdout || '').trim().slice(0, 4000)
    } catch {
      return ''
    }
  }
}

function scheduleMine(projectRoot: string): void {
  const now = Date.now()
  const last = mineCooldown.get(projectRoot) || 0
  if (now - last < MINE_EVERY_MS) return
  mineCooldown.set(projectRoot, now)

  const cli = mempalaceCli()
  if (!cli || !existsSync(projectRoot)) return
  const wing = wingName(projectRoot)
  try {
    const child = spawn(
      cli,
      ['mine', projectRoot, '--wing', wing, '--palace', palacePath()],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
  } catch {
    // optional
  }
}

/**
 * Build / refresh the auto-context file. Agents are pointed here automatically.
 * User never needs to open or edit this.
 */
export async function writeAutoContext(projectRoot: string): Promise<string> {
  const dir = truedeckDir(projectRoot)
  mkdirSync(dir, { recursive: true })

  const globalMem = ensureGlobalMemory()
  const repoMem = ensureRepoMemory(projectRoot)
  const wake = await mempalaceWakeUp(projectRoot)
  const recentRepo = listRecentNotes(repoMem, 6)
  const recentGlobal = listRecentNotes(globalMem, 4)

  const lines: string[] = [
    '# TrueDeck auto-context (managed — do not hand-edit)',
    '',
    'Memory is **automatic**. You do not need the user to manage notes, MemPalace, or Docker.',
    '',
    '## Protocol',
    '- At session start: treat this file as wake-up context.',
    '- When you learn something durable (decisions, gotchas, API quirks): write a short markdown note under `.memory/context/` or `.memory/decisions/` in the project, OR use MemPalace MCP tools if available.',
    '- Prefer facts over chat logs. Never store secrets.',
    '- Cross-project preferences live in the global memory path below.',
    '',
    `## Project`,
    `- Root: \`${projectRoot}\``,
    `- Wing: \`${wingName(projectRoot)}\``,
    '',
    '## Paths',
    `- Repo memory: \`${repoMem}\``,
    `- Global memory: \`${globalMem}\``,
    `- Palace: \`${palacePath()}\``,
    ''
  ]

  if (wake) {
    lines.push('## MemPalace wake-up', '', '```', wake, '```', '')
  } else {
    lines.push(
      '## MemPalace',
      '',
      'No wake-up text yet (palace empty or CLI missing). Background mining may still be running.',
      ''
    )
  }

  if (recentRepo.length) {
    lines.push('## Recent repo notes', '')
    for (const p of recentRepo) {
      const head = readHead(p, 220)
      lines.push(`### ${basename(p)}`, '', head || '_(empty)_', '')
    }
  }

  if (recentGlobal.length) {
    lines.push('## Recent global notes', '')
    for (const p of recentGlobal) {
      const head = readHead(p, 180)
      lines.push(`### ${basename(p)}`, '', head || '_(empty)_', '')
    }
  }

  const out = autoContextPath(projectRoot)
  writeFileSync(out, lines.join('\n'), 'utf8')

  // Lightweight pointer so Claude/Codex-style agents discover it without user work
  ensureAgentPointer(projectRoot)

  return out
}

function ensureAgentPointer(projectRoot: string): void {
  const pointer = [
    '',
    '<!-- truedeck-memory -->',
    '## TrueDeck memory (automatic)',
    'Session context is auto-generated at `.truedeck/auto-context.md`. Read it at start. Durable facts go in `.memory/`. Do not ask the user to manage memory.',
    '<!-- /truedeck-memory -->',
    ''
  ].join('\n')

  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const p = join(projectRoot, name)
    try {
      if (existsSync(p)) {
        const cur = readFileSync(p, 'utf8')
        if (cur.includes('truedeck-memory')) continue
        writeFileSync(p, cur.trimEnd() + '\n' + pointer, 'utf8')
      } else if (name === 'AGENTS.md') {
        // only create AGENTS.md if nothing exists — avoid surprising large CLAUDE.md creates
        writeFileSync(
          p,
          `# Agent instructions\n${pointer}`,
          'utf8'
        )
      }
    } catch {
      // ignore permission errors
    }
  }
}

/** Env bag every agent process should inherit. */
export function memoryEnv(projectRoot: string): Record<string, string> {
  const globalMem = ensureGlobalMemory()
  const repoMem = ensureRepoMemory(projectRoot)
  const ctx = autoContextPath(projectRoot)
  return {
    TRUEDECK_MEMORY: 'auto',
    TRUEDECK_PROJECT: projectRoot,
    TRUEDECK_REPO_MEMORY: repoMem,
    TRUEDECK_GLOBAL_MEMORY: globalMem,
    TRUEDECK_PALACE: palacePath(),
    TRUEDECK_AUTO_CONTEXT: ctx,
    TRUEDECK_MEMORY_WING: wingName(projectRoot)
  }
}

/**
 * Called when a project is opened. Fully automatic.
 */
export async function onProjectOpen(projectRoot: string): Promise<MemoryRuntimeStatus> {
  ensureGlobalMemory()
  ensureRepoMemory(projectRoot)

  // Warm providers (MemPalace native) without user action
  try {
    await ensureEnabledProviders(projectRoot)
  } catch {
    // ignore
  }
  try {
    await ensureMemPalace({ projectRoot, wing: wingName(projectRoot) })
  } catch {
    // ignore
  }

  scheduleMine(projectRoot)
  const ctx = await writeAutoContext(projectRoot)
  return getRuntimeStatus(projectRoot, ctx)
}

/**
 * Called right before/after spawning an agent. Refresh context; return env.
 */
export async function onAgentSpawn(projectRoot: string): Promise<{
  env: Record<string, string>
  status: MemoryRuntimeStatus
}> {
  const ctx = await writeAutoContext(projectRoot)
  // light mine throttle already handled
  scheduleMine(projectRoot)
  return {
    env: memoryEnv(projectRoot),
    status: await getRuntimeStatus(projectRoot, ctx)
  }
}

export async function getRuntimeStatus(
  projectRoot?: string,
  ctxPath?: string
): Promise<MemoryRuntimeStatus> {
  const palace = await getMemPalaceStatus()
  const globalMem = ensureGlobalMemory()
  const repoMem = projectRoot ? ensureRepoMemory(projectRoot) : undefined
  const auto = ctxPath || (projectRoot ? autoContextPath(projectRoot) : undefined)
  const ok = true // file memory always works; palace optional
  const parts: string[] = ['auto']
  if (palace.ready) parts.push('palace')
  else parts.push('files')

  return {
    ok,
    label: parts.join('+'),
    detail: palace.ready
      ? 'Memory automatic (files + MemPalace)'
      : 'Memory automatic (files); install mempalace for graph search',
    autoContextPath: auto && existsSync(auto) ? auto : undefined,
    palacePath: palace.palacePath,
    repoMemory: repoMem,
    globalMemory: globalMem
  }
}
