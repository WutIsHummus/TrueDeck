/**
 * Bind each agent tab to a real CLI conversation id, and restore with that id only.
 *
 * - New tabs: allocate / create a session id and pass it into the CLI when supported.
 * - Restore: ` --resume <id>` / `codex resume <id>` only. Never `--last` or bare `--continue`.
 * - Codex cannot take a pre-chosen id → discover from ~/.codex after spawn (cwd match).
 */

import { execFileSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export interface ResumeHint {
  sessionId?: string | null
  title?: string | null
  agentName?: string | null
}

export interface PreparedSpawn {
  args: string[]
  /** CLI conversation id to persist on the tab */
  resumeToken: string | null
  /** When true, caller should run discoverSessionId after PTY is up */
  needsDiscover: boolean
}

function alreadyHasSessionFlags(args: string[]): boolean {
  const low = args.map((a) => a.toLowerCase())
  for (const a of low) {
    if (
      a === '--continue' ||
      a === '-c' ||
      a === '--resume' ||
      a === '-r' ||
      a === '--session-id' ||
      a === '-s' ||
      a === 'resume' ||
      a === 'continue'
    ) {
      return true
    }
  }
  return false
}

/**
 * Cursor Agent CLI often fails MCP until workspace is trusted and MCPs approved.
 * Without these flags, MemPalace / truedeck-hub look "unavailable" even though
 * ~/.cursor/mcp.json is correctly injected by TrueDeck.
 */
function withCursorMcpFlags(args: string[], projectRoot?: string): string[] {
  const low = args.map((a) => a.toLowerCase())
  const out = [...args]
  if (!low.includes('--trust')) out.unshift('--trust')
  if (!low.includes('--approve-mcps')) out.unshift('--approve-mcps')
  // Prefer explicit workspace when we know the project root
  if (projectRoot && !low.includes('--workspace') && !low.includes('-w')) {
    out.push('--workspace', projectRoot)
  }
  return out
}

function normRoot(p: string): string {
  return p.replace(/\//g, '\\').replace(/[\\/]+$/, '').toLowerCase()
}

/** Allocate a UUID suitable for Grok/Claude/Gemini --session-id. */
export function newCliSessionId(): string {
  return randomUUID()
}

/**
 * Argv for a brand-new interactive session, binding a stable conversation id when possible.
 */
export function prepareNewSessionSpawn(
  agentId: string,
  baseArgs: string[],
  projectRoot: string,
  cliCommand?: string
): PreparedSpawn {
  const id = (agentId || '').toLowerCase().replace(/^cmd-/, '')
  if (id === 'shell' || id.startsWith('cmd')) {
    return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
  }
  if (alreadyHasSessionFlags(baseArgs)) {
    return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
  }

  switch (id) {
    case 'grok': {
      const token = newCliSessionId()
      return {
        args: [...baseArgs, '--session-id', token],
        resumeToken: token,
        needsDiscover: false
      }
    }
    case 'claude': {
      const token = newCliSessionId()
      return {
        args: [...baseArgs, '--session-id', token],
        resumeToken: token,
        needsDiscover: false
      }
    }
    case 'gemini': {
      const token = newCliSessionId()
      return {
        args: [...baseArgs, '--session-id', token],
        resumeToken: token,
        needsDiscover: false
      }
    }
    case 'cursor': {
      // New tabs: do NOT pre-create + --resume an empty chat.
      // create-chat + resume often leaves a blank ConPTY until the user types.
      // Interactive unbound start paints reliably; bind id only on restore.
      const withMcp = withCursorMcpFlags(baseArgs, projectRoot)
      return { args: withMcp, resumeToken: null, needsDiscover: false }
    }
    case 'codex':
      // Codex picks its own id; scrape ~/.codex after spawn using cwd.
      return { args: [...baseArgs], resumeToken: null, needsDiscover: true }
    case 'opencode': {
      const token = newCliSessionId()
      return {
        args: [...baseArgs, '--session', token],
        resumeToken: token,
        needsDiscover: false
      }
    }
    case 'kiro':
      // https://kiro.dev/docs/cli — `kiro-cli` opens the TUI; resume via chat --resume-id
      // Session ids are assigned by Kiro; start unbound for new tabs.
      return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
    case 'aider':
      return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
    default:
      return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
  }
}

/**
 * Argv to reattach a known conversation. Requires sessionId.
 * Returns null when there is no token (caller should open a *new* bound session).
 */
export function prepareResumeSpawn(
  agentId: string,
  baseArgs: string[],
  sessionId: string
): string[] | null {
  const token = (sessionId || '').trim()
  if (!token) return null
  const id = (agentId || '').toLowerCase().replace(/^cmd-/, '')
  if (id === 'shell' || id.startsWith('cmd')) return null
  if (alreadyHasSessionFlags(baseArgs)) return [...baseArgs]

  switch (id) {
    case 'claude':
    case 'grok':
    case 'gemini':
      return [...baseArgs, '--resume', token]
    case 'cursor':
      return [...withCursorMcpFlags(baseArgs), '--resume', token]
    case 'codex':
      return ['resume', token]
    case 'opencode':
      return [...baseArgs, '--session', token]
    case 'kiro': {
      // kiro-cli chat --resume-id <id>
      const low = baseArgs.map((a) => a.toLowerCase())
      if (low.includes('chat')) {
        return [...baseArgs, '--resume-id', token]
      }
      return [...baseArgs, 'chat', '--resume-id', token]
    }
    default:
      return [...baseArgs, '--resume', token]
  }
}

/** @deprecated use prepareResumeSpawn / prepareNewSessionSpawn */
export function argsForResumeConversation(
  agentId: string,
  baseArgs: string[] = [],
  hint?: ResumeHint
): string[] {
  const resumed = prepareResumeSpawn(agentId, baseArgs, hint?.sessionId || '')
  if (resumed) return resumed
  // No silent --last/--continue - open a new bound session instead.
  return prepareNewSessionSpawn(agentId, baseArgs, '').args
}

/**
 * Create a Cursor chat id for --resume binding.
 * Hard-capped: spawn path must not wait on a slow/hung cursor-agent.
 * Prefer unbound spawn over blocking the palette for seconds.
 */
function createCursorChatId(projectRoot: string, cliCommand?: string): string | null {
  try {
    const cmd = cliCommand || 'cursor-agent'
    const out = execFileSync(cmd, ['create-chat'], {
      encoding: 'utf8',
      cwd: projectRoot || undefined,
      windowsHide: true,
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'pipe']
    })
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    // Last non-empty line is usually the UUID
    const line = out[out.length - 1] || ''
    const m = line.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    )
    return m ? m[0] : null
  } catch {
    return null
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Find a Codex session id created for this project after `notBeforeMs`.
 * Reads recent rollout jsonl session_meta.cwd.
 */
export async function discoverCodexSessionId(
  projectRoot: string,
  notBeforeMs: number,
  timeoutMs = 5000
): Promise<string | null> {
  const root = normRoot(projectRoot)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = scanCodexSessions(root, notBeforeMs)
    if (hit) return hit.id
    await sleep(200)
  }
  // Last chance: any recent session for this cwd (slightly older)
  return scanCodexSessions(root, notBeforeMs - 30_000)?.id || null
}

function scanCodexSessions(
  projectRootNorm: string,
  notBeforeMs: number
): { id: string; t: number } | null {
  const base = join(homedir(), '.codex', 'sessions')
  if (!existsSync(base)) return null
  let best: { id: string; t: number } | null = null

  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!name.endsWith('.jsonl')) continue
      if (st.mtimeMs + 5000 < notBeforeMs) continue
      // Filename often ends with -<uuid>.jsonl
      const fromName = name.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      )
      let sessionId = fromName?.[1] || ''
      let cwd = ''
      try {
        const head = readFileSync(full, 'utf8').slice(0, 4000)
        const line = head.split(/\r?\n/).find((l) => l.includes('session_meta'))
        if (line) {
          const j = JSON.parse(line) as {
            payload?: { session_id?: string; id?: string; cwd?: string }
          }
          sessionId = j.payload?.session_id || j.payload?.id || sessionId
          cwd = j.payload?.cwd || ''
        }
      } catch {
        /* ignore parse */
      }
      if (!sessionId) continue
      if (cwd && normRoot(cwd) !== projectRootNorm) continue
      // Prefer cwd match; if no cwd in meta, still accept recent files
      const score = st.mtimeMs
      if (!best || score > best.t) best = { id: sessionId, t: score }
    }
  }

  walk(base, 0)
  return best
}

/**
 * Async-friendly discover used after spawn (non-blocking loop via setTimeout in caller).
 * Single-pass scan (no sleep).
 */
export function tryDiscoverCodexSessionId(
  projectRoot: string,
  notBeforeMs: number
): string | null {
  return scanCodexSessions(normRoot(projectRoot), notBeforeMs)?.id || null
}

/** Claude project dir encoding: C:\foo\bar → C--foo-bar under ~/.claude/projects */
export function tryDiscoverClaudeSessionId(
  projectRoot: string,
  notBeforeMs: number
): string | null {
  const encoded = projectRoot
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d: string) => `${d.toUpperCase()}--`)
    .replace(/\//g, '-')
  const dir = join(homedir(), '.claude', 'projects', encoded)
  if (!existsSync(dir)) {
    // try alternate casing
    const alt = join(
      homedir(),
      '.claude',
      'projects',
      projectRoot.replace(/\\/g, '-').replace(':', '')
    )
    if (!existsSync(alt)) return null
  }
  const useDir = existsSync(dir) ? dir : join(homedir(), '.claude', 'projects')
  // Prefer exact project folder
  const candidates: string[] = []
  try {
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (name.endsWith('.jsonl')) candidates.push(join(dir, name))
      }
    }
  } catch {
    return null
  }
  let best: { id: string; t: number } | null = null
  for (const full of candidates) {
    try {
      const st = statSync(full)
      if (st.mtimeMs + 5000 < notBeforeMs) continue
      const base = full.split(/[/\\]/).pop() || ''
      const id = base.replace(/\.jsonl$/i, '')
      if (!/^[0-9a-f-]{20,}$/i.test(id)) continue
      if (!best || st.mtimeMs > best.t) best = { id, t: st.mtimeMs }
    } catch {
      /* ignore */
    }
  }
  return best?.id || null
}

export function resumeLatestKey(agentId: string, projectRoot: string): string {
  return `${agentId.toLowerCase()}|${normRoot(projectRoot)}`
}
