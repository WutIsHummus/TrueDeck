/**
 * Bind each agent tab to a real CLI conversation id, and restore with that id only.
 *
 * - New tabs: allocate / create a session id and pass it into the CLI when supported.
 * - Restore: ` --resume <id>` / `codex resume <id>` only. Never `--last` or bare `--continue`.
 * - Codex cannot take a pre-chosen id → discover from ~/.codex after spawn (cwd match).
 * - OpenCode `--session` continues an existing `ses_*` id. A UUID is not a valid OpenCode
 *   id and the CLI exits with `Error: Invalid session ID: unknown error`.
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
      a === '--session' ||
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

/** OpenCode conversation ids look like `ses_fd3b42016ffeLS205A1U1s2tpa`. */
export function isOpenCodeSessionId(id: string): boolean {
  return /^ses_[A-Za-z0-9]{8,}$/.test((id || '').trim())
}

/**
 * Map palette / custom ids onto the resume family we know how to spawn.
 * "OpenCode (direct)" is a custom preset (`custom-opencode`) with the same binary
 * as builtin OpenCode — it must use the same `--session` rules, not `--resume`.
 */
export function resumeAgentKind(agentId: string, command?: string): string {
  const id = (agentId || '').toLowerCase().replace(/^cmd-/, '')
  const cmd = (command || '').toLowerCase().replace(/\\/g, '/')
  const base = (cmd.split('/').pop() || cmd).replace(/\.exe$|\.cmd$|\.bat$/i, '')
  if (
    id === 'opencode' ||
    id.startsWith('custom-opencode') ||
    /(^|-)opencode$/.test(id) ||
    base === 'opencode'
  ) {
    return 'opencode'
  }
  return id
}

/** Env bag for CLI session bind. Never pass a UUID to OpenCode. */
export function cliSessionEnv(
  agentId: string,
  token: string | null | undefined,
  command?: string
): Record<string, string> {
  const t = (token || '').trim()
  if (!t) return {}
  if (resumeAgentKind(agentId, command) === 'opencode' && !isOpenCodeSessionId(t)) {
    return {}
  }
  return { TRUEDECK_CLI_SESSION: t }
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
  const id = resumeAgentKind(agentId, cliCommand)
  if (id === 'shell' || id.startsWith('cmd')) {
    return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
  }
  if (alreadyHasSessionFlags(baseArgs)) {
    if (id === 'opencode') {
      const hasValidSes = baseArgs.some((a, i) => {
        const prev = i > 0 ? baseArgs[i - 1].toLowerCase() : ''
        return (prev === '--session' || prev === '-s') && isOpenCodeSessionId(a)
      })
      if (hasValidSes) {
        return { args: [...baseArgs], resumeToken: null, needsDiscover: false }
      }
      const stripped: string[] = []
      for (let i = 0; i < baseArgs.length; i++) {
        const low = baseArgs[i].toLowerCase()
        if (low === '--session' || low === '-s') {
          const next = baseArgs[i + 1]
          if (next && !next.startsWith('-')) i++
          continue
        }
        stripped.push(baseArgs[i])
      }
      return { args: stripped, resumeToken: null, needsDiscover: true }
    }
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
    case 'opencode':
      // OpenCode assigns `ses_*` ids itself. `--session` is continue-only and
      // rejects a pre-chosen UUID (`Error: Invalid session ID: unknown error`).
      // Start unbound (same as Codex/Cursor); bind a real id only on restore.
      return { args: [...baseArgs], resumeToken: null, needsDiscover: true }
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
  sessionId: string,
  cliCommand?: string
): string[] | null {
  const token = (sessionId || '').trim()
  if (!token) return null
  const id = resumeAgentKind(agentId, cliCommand)
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
      // Ignore leftover UUID tokens from older TrueDeck builds.
      if (!isOpenCodeSessionId(token)) return null
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
  timeoutMs = 5000,
  codexHome?: string | null
): Promise<string | null> {
  const root = normRoot(projectRoot)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = scanCodexSessions(root, notBeforeMs, codexHome)
    if (hit) return hit.id
    await sleep(200)
  }
  // Last chance: any recent session for this cwd (slightly older)
  return scanCodexSessions(root, notBeforeMs - 30_000, codexHome)?.id || null
}

function scanCodexSessions(
  projectRootNorm: string,
  notBeforeMs: number,
  codexHome?: string | null
): { id: string; t: number } | null {
  const base = join(codexHome || join(homedir(), '.codex'), 'sessions')
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
  notBeforeMs: number,
  codexHome?: string | null
): string | null {
  return scanCodexSessions(normRoot(projectRoot), notBeforeMs, codexHome)?.id || null
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


/** Encode project root the way Grok names session dirs (e.g. C%3A%5CSPTS). */
export function grokSessionProjectDir(projectRoot: string): string {
  const normalized = projectRoot.replace(/\//g, '\\')
  return join(homedir(), '.grok', 'sessions', encodeURIComponent(normalized))
}

export type DiscoveredSession = { id: string; mtimeMs: number }

/**
 * List Grok conversation ids under ~/.grok/sessions/<encoded-cwd>/ (newest first).
 * Only includes dirs that look like UUIDs and have some chat history when present.
 */
export function listGrokSessionIds(projectRoot: string): DiscoveredSession[] {
  const dir = grokSessionProjectDir(projectRoot)
  if (!existsSync(dir)) return []
  const out: DiscoveredSession[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
        continue
      }
      const full = join(dir, name)
      try {
        const st = statSync(full)
        if (!st.isDirectory()) continue
        // Prefer sessions that actually have history
        const hist = join(full, 'chat_history.jsonl')
        let score = st.mtimeMs
        if (existsSync(hist)) {
          try {
            const hs = statSync(hist)
            if (hs.size > 32) score = Math.max(score, hs.mtimeMs)
            else score -= 1e12 // empty history sinks
          } catch {
            /* ignore */
          }
        }
        out.push({ id: name, mtimeMs: score })
      } catch {
        /* ignore */
      }
    }
  } catch {
    return []
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * Pick the newest Grok session for this project not already claimed.
 * Used when a saved tab has no resumeToken so multi-Grok restore still reattaches chats.
 */
export function claimGrokSessionId(
  projectRoot: string,
  claimed: Set<string>
): string | null {
  for (const s of listGrokSessionIds(projectRoot)) {
    if (claimed.has(s.id)) continue
    claimed.add(s.id)
    return s.id
  }
  return null
}
export function resumeLatestKey(agentId: string, projectRoot: string): string {
  return `${agentId.toLowerCase()}|${normRoot(projectRoot)}`
}

function openCodeDataRoots(): string[] {
  const extra = process.env.OPENCODE_DATA || process.env.XDG_DATA_HOME
  const dirs = [
    join(homedir(), '.local', 'share', 'opencode'),
    join(homedir(), '.opencode'),
    process.env.APPDATA ? join(process.env.APPDATA, 'opencode') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'opencode') : '',
    extra ? join(extra, 'opencode') : ''
  ]
  const out: string[] = []
  const seen: Record<string, true> = {}
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i]
    if (!d || seen[d] || !existsSync(d)) continue
    seen[d] = true
    out.push(d)
  }
  return out
}

/**
 * Newest `ses_*` id under OpenCode's local data dir, optionally matching cwd.
 * Used after an unbound spawn so restore can reattach with `--session`.
 */
export function tryDiscoverOpenCodeSessionId(
  projectRoot: string,
  notBeforeMs: number
): string | null {
  const want = normRoot(projectRoot)
  const state: { best: { id: string; t: number; cwdHit: boolean } | null } = {
    best: null
  }

  const consider = (id: string, t: number, cwd: string): void => {
    if (!isOpenCodeSessionId(id)) return
    if (t + 8000 < notBeforeMs) return
    const cwdHit = Boolean(cwd) && normRoot(cwd) === want
    const cur = state.best
    if (
      !cur ||
      (cwdHit && !cur.cwdHit) ||
      (cwdHit === cur.cwdHit && t > cur.t)
    ) {
      state.best = { id, t, cwdHit }
    }
  }

  const walk = (dir: string, depth: number): void => {
    if (depth > 7) return
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        const fromDir = name.match(/ses_[A-Za-z0-9]{8,}/)
        if (fromDir) consider(fromDir[0], st.mtimeMs, '')
        walk(full, depth + 1)
        continue
      }
      const fromName = name.match(/ses_[A-Za-z0-9]{8,}/)
      if (fromName) consider(fromName[0], st.mtimeMs, '')
      if (!/\.(json|jsonl)$/i.test(name)) continue
      if (st.size > 400_000) continue
      try {
        const head = readFileSync(full, 'utf8').slice(0, 8000)
        const idMatch = head.match(/ses_[A-Za-z0-9]{8,}/)
        if (!idMatch) continue
        const cwdMatch =
          head.match(/"cwd"\s*:\s*"([^"]+)"/) ||
          head.match(/"directory"\s*:\s*"([^"]+)"/) ||
          head.match(/"project"\s*:\s*"([^"]+)"/)
        consider(idMatch[0], st.mtimeMs, cwdMatch?.[1] || '')
      } catch {
        /* ignore */
      }
    }
  }

  for (const root of openCodeDataRoots()) walk(root, 0)
  return state.best ? state.best.id : null
}

export async function discoverOpenCodeSessionId(
  projectRoot: string,
  notBeforeMs: number,
  timeoutMs = 4000
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = tryDiscoverOpenCodeSessionId(projectRoot, notBeforeMs)
    if (hit) return hit
    await sleep(200)
  }
  return tryDiscoverOpenCodeSessionId(projectRoot, notBeforeMs - 30_000)
}
