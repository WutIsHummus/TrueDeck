/**
 * Live phase of a coding-agent terminal.
 *
 * Meanings match T3 Code's sidebar (working / waiting / done):
 * https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/Sidebar.logic.ts
 *
 * Detectors follow the completed MIT patterns in coding-agent-adapters
 * (Claude, Codex, Gemini, OpenCode): https://github.com/HaruHunab1320/coding-agent-adapters
 * Grok, Cursor, and Kiro share the same status-line shape (interrupt line vs idle composer).
 */

export type AgentPhase = 'starting' | 'working' | 'waiting' | 'done'
export type AgentSignal = 'working' | 'waiting' | 'done' | 'unknown'

/** Quiet this long after real work, with no loading line, means the turn stopped. */
export const QUIET_DONE_MS = 20_000

const WAITING_RE =
  /do you want to|needs? your (?:permission|approval|attention)|do you trust|trust this (?:folder|directory)|permission requested|allow (?:once|always)|yes,?\s+allow|waiting for (?:your approval|user confirmation)/i

const LOADING_RE =
  /esc\s+to\s+(?:interrupt|cancel)|ctrl\+c to (?:interrupt|stop)|Reading\s+\d+\s+files|Booting\s+MCP\s+server|Searching\s+the\s+web|Thinking(?:…|\.{3})|(?:Accomplishing|Architecting|Baking|Brewing|Cogitating|Cooking|Crunching|Deliberating|Thinking|Vibing|Working|Wrangling)(?:…|\.{3})|(?:^|\n)\s*[✢✳✶✻✽]\s+[A-Z][a-z]/i

const CLAUDE_DURATION_RE =
  /(?:Baked|Brewed|Churned|Cogitated|Cooked|Crunched|Sautéed|Worked)\s+for\s+\d+(?:h\s+\d{1,2}m\s+\d{1,2}s|m\s+\d{1,2}s|s)/

export function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][AB012]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function isWaiting(end: string): boolean {
  return WAITING_RE.test(end)
}

function isLoading(end: string): boolean {
  return LOADING_RE.test(end)
}

function isDone(agentId: string, recent: string, end: string): boolean {
  const id = agentId.toLowerCase()
  if (id === 'claude') {
    const prompt = /❯/.test(end)
    if (CLAUDE_DURATION_RE.test(recent) && prompt) return true
    if (prompt && /for shortcuts/i.test(recent)) return true
    return false
  }
  if (id === 'codex') {
    const worked = /Worked\s+for\s+\d+/.test(recent)
    const ask = /Ask\s+Codex\s+to\s+do\s+anything/i.test(end)
    const footer = /\?\s+for\s+shortcuts|context\s+left|tab to queue/i.test(end)
    if (ask) return true
    if (worked && (footer || /›/.test(end))) return true
    return false
  }
  if (id === 'gemini') {
    return /type your message/i.test(end) || /◇\s*Ready/.test(end)
  }
  if (id === 'opencode') {
    return /(?:^|\n)\s*>\s*$/.test(end) && !/^>\s+(?:build|plan|chat|run)\b/m.test(end)
  }
  if (/add a follow-up/i.test(end)) return true
  if (/Ask\s+Grok\s+to/i.test(end) || /type a message/i.test(end)) return true
  const prompt = /(?:^|\n)\s*[❯›▸]\s+\S/.test(end)
  if (prompt && /for shortcuts|context left|worked for/i.test(recent)) return true
  return false
}

/** Classify the latest terminal bytes. `unknown` means the screen does not say. */
export function classifyAgentTail(agentId: string, raw: string): AgentSignal {
  const text = stripAnsi(raw)
  if (!text.trim()) return 'unknown'
  const end = text.slice(-180)
  const recent = text.slice(-1500)
  if (isWaiting(end)) return 'waiting'
  if (!isLoading(end) && isDone(agentId, recent, end)) return 'done'
  if (isLoading(end)) return 'working'
  return 'unknown'
}

export function resolveAgentPhase(input: {
  signal: AgentSignal
  sawWork: boolean
  quietMs: number
  /** Already in a turn. A fresh idle prompt must not start the working clock. */
  wasWorking?: boolean
  exited?: boolean
}): AgentPhase {
  if (input.exited) return 'done'
  if (input.signal === 'waiting') return 'waiting'
  // A completion line stays in the scrollback while the agent is still printing.
  // Keep the turn (and its timer) until output has actually stopped.
  if (input.signal === 'done') {
    return input.wasWorking && input.quietMs < 1500 ? 'working' : 'done'
  }
  // A frozen "esc to interrupt" line is not still working once the terminal goes quiet.
  if (input.signal === 'working') return input.quietMs >= QUIET_DONE_MS ? 'done' : 'working'
  if (!input.sawWork) return 'starting'
  if (input.quietMs < QUIET_DONE_MS) return 'working'
  return 'done'
}

/** An agent can take a new task when it is not mid-turn and not blocked on the user. */
export function canTakeTask(phase: AgentPhase): boolean {
  return phase === 'done' || phase === 'starting'
}

export function formatWorkingElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`
}
