/**
 * Plain-text shaping for the phone page. The desktop PTY is a full-screen TUI;
 * the phone shows the latest cleared frame with cursor noise removed.
 */

const CLEAR_MARKERS = ['\u001b[2J', '\u001b[3J', '\u001bc']

export function visibleText(raw: string): string {
  let cut = 0
  for (const marker of CLEAR_MARKERS) {
    const at = raw.lastIndexOf(marker)
    if (at >= 0) cut = Math.max(cut, at + marker.length)
  }
  const stripped = raw
    .slice(cut)
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

  let line = ''
  const lines: string[] = []
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch === '\n') {
      lines.push(line.replace(/[ \t]+$/g, ''))
      line = ''
    } else if (ch === '\r') {
      line = ''
    } else {
      line += ch
    }
  }
  lines.push(line.replace(/[ \t]+$/g, ''))
  const text = lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (text.length <= 8000) return text
  return text.slice(text.length - 8000)
}

/** True when the session has turned on bracketed paste (xterm 2004). */
export function sessionAllowsPaste(raw: string): boolean {
  return raw.includes('\u001b[?2004h')
}

/**
 * Bytes to paste into the CLI. Enter is not included: a TUI that receives
 * the prompt and the return in one write inserts a newline and does not submit.
 * The caller writes this, waits, then writes promptEnter().
 */
export function promptPayload(text: string, bracketedPaste: boolean): string {
  const body = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!body) return ''
  if (body.includes('\n') && bracketedPaste) {
    return `\u001b[200~${body.replace(/\n/g, '\r')}\u001b[201~`
  }
  return body.replace(/\n+/g, ' ').trim()
}

/** Enter key, matching xterm with windowsMode off. */
export function promptEnter(): string {
  return '\r'
}

export function normCode(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

export function formatCode(token: string): string {
  const t = normCode(token)
  if (t.length <= 4) return t
  return `${t.slice(0, 4)}-${t.slice(4)}`
}

export type Ipv4Kind = 'wifi' | 'tailscale' | 'virtual' | 'other' | 'skip'

export function ipv4Kind(ip: string): Ipv4Kind {
  const parts = ip.split('.').map((x) => Number(x))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 'skip'
  }
  if (ip.startsWith('169.254.')) return 'skip'
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return 'tailscale'
  if (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168)) return 'wifi'
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'virtual'
  return 'other'
}

export function kindLabel(kind: Exclude<Ipv4Kind, 'skip'>): string {
  if (kind === 'wifi') return 'Wi-Fi'
  if (kind === 'tailscale') return 'Tailscale'
  if (kind === 'virtual') return 'Virtual'
  return 'Network'
}

export function kindRank(kind: Exclude<Ipv4Kind, 'skip'>): number {
  if (kind === 'wifi') return 0
  if (kind === 'tailscale') return 1
  if (kind === 'virtual') return 2
  return 3
}
