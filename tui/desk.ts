/**
 * One chat bar. A follow-up stays with the agent already doing that work.
 * A new task goes only to the agents the user names.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentPreset } from './agents'
import { canLaunch } from './resolve'
import type { Session } from './sessions'

const SKIP = new Set([
  'the',
  'a',
  'an',
  'to',
  'and',
  'or',
  'for',
  'with',
  'this',
  'that',
  'it',
  'on',
  'in',
  'of',
  'is',
  'be',
  'please',
  'just'
])

export function codingAgents(agents: AgentPreset[]): AgentPreset[] {
  return agents.filter(
    (a) => a.id !== 'shell' && !a.id.startsWith('cmd-') && canLaunch(a.id, a.command, a.args || [])
  )
}

export function activityLine(buf: string): string {
  const clean = buf
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b./g, '')
    .replace(/\r/g, '\n')
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2)
  return (lines[lines.length - 1] || '').slice(0, 120)
}

/**
 * Replay a PTY buffer into a fixed screen.
 * The last raw line is often just the cwd. The live frame is what the agent painted.
 */
export function screenFrame(buf: string, rows: number, cols: number): string {
  const height = Math.max(1, Math.min(80, rows || 1))
  const width = Math.max(1, Math.min(220, cols || 1))
  const src = buf.length > 120_000 ? buf.slice(-120_000) : buf
  const blank = (): string => ' '.repeat(width)
  let grid = Array.from({ length: height }, blank)
  let row = 0
  let col = 0

  const clamp = (): void => {
    if (row < 0) row = 0
    if (col < 0) col = 0
    if (col >= width) col = width - 1
    if (row >= height) {
      const extra = row - (height - 1)
      for (let n = 0; n < extra; n++) {
        grid.shift()
        grid.push(blank())
      }
      row = height - 1
    }
  }
  const clearAll = (): void => {
    grid = Array.from({ length: height }, blank)
    row = 0
    col = 0
  }
  const put = (ch: string): void => {
    if (col >= width) {
      col = 0
      row++
      clamp()
    }
    const line = grid[row] || blank()
    grid[row] = (line.slice(0, col) + ch + line.slice(col + 1)).slice(0, width).padEnd(width, ' ')
    col++
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\x1b') {
      const next = src[i + 1]
      if (next === '[') {
        i += 2
        let priv = false
        if (src[i] === '?') {
          priv = true
          i++
        }
        const start = i
        while (i < src.length && (src[i] < '@' || src[i] > '~')) i++
        if (i >= src.length) break
        const final = src[i]
        const body = src.slice(start, i)
        i++
        const nums = body.split(';').map((part) => {
          const n = parseInt(part.replace(/[^0-9]/g, ''), 10)
          return Number.isFinite(n) ? n : 0
        })
        const a = nums[0] || 0
        const b = nums[1] || 0
        if (final === 'A') row = Math.max(0, row - (a || 1))
        else if (final === 'B') {
          row += a || 1
          clamp()
        } else if (final === 'C') col = Math.min(width - 1, col + (a || 1))
        else if (final === 'D') col = Math.max(0, col - (a || 1))
        else if (final === 'G') col = Math.max(0, Math.min(width - 1, (a || 1) - 1))
        else if (final === 'H' || final === 'f') {
          row = Math.max(0, Math.min(height - 1, (a || 1) - 1))
          col = Math.max(0, Math.min(width - 1, (b || 1) - 1))
        } else if (final === 'J') {
          if (a === 2 || a === 3) clearAll()
          else if (a === 0) {
            const line = grid[row] || blank()
            grid[row] = line.slice(0, col).padEnd(width, ' ')
            for (let r = row + 1; r < height; r++) grid[r] = blank()
          }
        } else if (final === 'K') {
          const line = grid[row] || blank()
          if (a === 2) grid[row] = blank()
          else if (a === 1) grid[row] = (' '.repeat(Math.min(width, col)) + line.slice(col)).slice(0, width)
          else grid[row] = line.slice(0, col).padEnd(width, ' ')
        } else if (priv && final === 'h' && (a === 1049 || a === 47 || a === 1047)) {
          clearAll()
        }
        continue
      }
      if (next === ']') {
        i += 2
        while (i < src.length && src[i] !== '\x07') {
          if (src[i] === '\x1b' && src[i + 1] === '\\') {
            i += 2
            break
          }
          i++
        }
        if (src[i] === '\x07') i++
        continue
      }
      i += next ? 2 : 1
      continue
    }
    if (ch === '\r') {
      col = 0
      i++
      continue
    }
    if (ch === '\n') {
      col = 0
      row++
      clamp()
      i++
      continue
    }
    if (ch === '\b') {
      col = Math.max(0, col - 1)
      i++
      continue
    }
    if (ch === '\t') {
      col = Math.min(width - 1, col + (8 - (col % 8)))
      i++
      continue
    }
    if (ch < ' ') {
      i++
      continue
    }
    put(ch)
    i++
  }

  return grid
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '')
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !SKIP.has(t))
}

/** Send this line to an agent already on that work, instead of opening another chat. */
export function followupSession(text: string, sessions: Session[]): Session | null {
  const working = sessions.filter((s) => s.status === 'running' && s.task)
  if (!working.length) return null
  const cont =
    /^(no|nah|wait|stop|instead|change|also|and|fix that|update that|keep going|continue)\b/i.test(
      text.trim()
    )
  if (cont && working.length === 1) return working[0]
  const mine = tokens(text)
  let best: { session: Session; score: number } | null = null
  for (const session of working) {
    const theirs = new Set(tokens(session.task || ''))
    const score = mine.filter((t) => theirs.has(t)).length
    if (score >= 2 && (!best || score > best.score)) best = { session, score }
  }
  return best?.session || null
}

/** First installed agent that does not already have a live chat. */
export function freeAgent(agents: AgentPreset[], sessions: Session[]): AgentPreset | null {
  const busy = new Set(
    sessions.filter((s) => s.status === 'running').map((s) => s.agentId)
  )
  return codingAgents(agents).find((a) => !busy.has(a.id)) || null
}

export function writeBoard(project: string, sessions: Session[]): string {
  const dir = join(project, '.truedeck', 'desk')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'board.md')
  const lines = ['# Desk', '']
  const working = sessions.filter((s) => s.task)
  if (!working.length) lines.push('No tasks yet.')
  for (const s of working) {
    lines.push(`## ${s.name}`)
    lines.push('')
    lines.push(s.task || '')
    lines.push('')
    if (s.worktree) lines.push(`Worktree: ${s.worktree}`)
    lines.push(`Status: ${s.status}`)
    lines.push('')
  }
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}

export function taskPrompt(
  sessionName: string,
  task: string,
  others: { name: string; task: string | null }[]
): string {
  const peerLines = others
    .filter((s) => s.task && s.name !== sessionName)
    .map((s) => `- ${s.name}: ${s.task}`)
  return [
    `TrueDeck desk. You are ${sessionName}.`,
    'This is your task:',
    task,
    '',
    'Other agents have their own tasks and their own checkouts. Leave their files and chats alone.',
    peerLines.length ? peerLines.join('\n') : 'No other tasks are in flight.',
    'The shared board is .truedeck/desk/board.md',
    `Write your notes in .truedeck/desk/notes-${sessionName.toLowerCase().replace(/[^a-z0-9]+/g, '')}.md`,
    'Do this task now.'
  ].join('\n')
}

export function ptyLine(text: string): string {
  const body = text.replace(/\r?\n/g, '\r')
  return process.platform === 'win32' ? body + '\r' : text + '\n'
}
