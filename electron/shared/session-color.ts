/**
 * Distinct identity colors for parallel terminals / tasks.
 *
 * Agent brand colors (especially Grok #f5f5f5) collide when two sessions of
 * the same CLI sit side by side. Claude exposes `/color` for this; Grok and
 * Cursor Agent do not, so TrueDeck assigns a hue and applies it to chrome,
 * xterm, and (for Claude) a seeded `/color` command.
 */

export type SessionColor = {
  hex: string
  /** Claude `/color` name (and generic CLI hint). */
  cliName: string
  /** Short label for switcher chips. */
  label: string
}

/** Spread-apart hues that stay readable as tab accents on the dark studio. */
export const SESSION_COLOR_PALETTE: SessionColor[] = [
  { hex: '#f97316', cliName: 'orange', label: 'Orange' },
  { hex: '#eab308', cliName: 'yellow', label: 'Yellow' },
  { hex: '#22c55e', cliName: 'green', label: 'Green' },
  { hex: '#14b8a6', cliName: 'teal', label: 'Teal' },
  { hex: '#3b82f6', cliName: 'blue', label: 'Blue' },
  { hex: '#8b5cf6', cliName: 'purple', label: 'Purple' },
  { hex: '#ec4899', cliName: 'pink', label: 'Pink' },
  { hex: '#f43f5e', cliName: 'red', label: 'Red' },
  { hex: '#06b6d4', cliName: 'cyan', label: 'Cyan' },
  { hex: '#a3e635', cliName: 'green', label: 'Lime' },
  { hex: '#fb7185', cliName: 'magenta', label: 'Rose' },
  { hex: '#818cf8', cliName: 'blue', label: 'Indigo' }
]

const BRAND_FALLBACK: Record<string, string> = {
  grok: '#f5f5f5',
  cursor: '#f54e00',
  claude: '#d97757',
  codex: '#10a37f',
  gemini: '#4796e3',
  kiro: '#993ff5',
  shell: '#5391fe',
  opencode: '#cfcecd',
  aider: '#0088ff',
  t3: '#8b7cff'
}

function fnv1a(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function normHex(c: string | null | undefined): string {
  const t = String(c || '')
    .trim()
    .toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(t)) return t
  if (/^#[0-9a-f]{3}$/.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  }
  return ''
}

/** True when the color is the agent brand (or near-white Grok mark) — not a unique identity. */
export function isBrandOrNeutralColor(
  color: string | null | undefined,
  agentId?: string | null
): boolean {
  const hex = normHex(color)
  if (!hex) return true
  if (hex === '#f5f5f5' || hex === '#ffffff' || hex === '#e8e8e8') return true
  if (hex === '#6cb6ff' || hex === '#22d3ee' || hex === '#3b82f6') return true
  const brand = agentId ? normHex(BRAND_FALLBACK[agentId]) : ''
  return Boolean(brand && brand === hex)
}

export function colorFromPalette(index: number): SessionColor {
  const n = SESSION_COLOR_PALETTE.length
  return SESSION_COLOR_PALETTE[((index % n) + n) % n]
}

export function pickSessionColor(opts: {
  agentId?: string | null
  taskId?: string | null
  resumeToken?: string | null
  seed?: string | null
  taken?: string[] | null
}): SessionColor {
  const taken = new Set((opts.taken || []).map((c) => normHex(c)).filter(Boolean))
  const key =
    (opts.taskId && `task:${opts.taskId}`) ||
    (opts.resumeToken && `tok:${opts.resumeToken}`) ||
    (opts.seed && `seed:${opts.seed}`) ||
    `agent:${opts.agentId || 'shell'}:${Date.now().toString(36)}`
  const start = fnv1a(key) % SESSION_COLOR_PALETTE.length
  for (let i = 0; i < SESSION_COLOR_PALETTE.length; i++) {
    const c = colorFromPalette(start + i)
    if (!taken.has(c.hex)) return c
  }
  return colorFromPalette(start)
}

export function ensureSessionColor(
  current: string | null | undefined,
  opts: {
    agentId?: string | null
    taskId?: string | null
    resumeToken?: string | null
    seed?: string | null
    taken?: string[] | null
  }
): SessionColor {
  const hex = normHex(current)
  if (hex && !isBrandOrNeutralColor(hex, opts.agentId)) {
    const named = SESSION_COLOR_PALETTE.find((c) => c.hex === hex)
    return named || { hex, cliName: 'blue', label: 'Custom' }
  }
  return pickSessionColor(opts)
}

function mixHex(hex: string, onto: string, amount: number): string {
  const parse = (h: string): [number, number, number] => {
    const n = normHex(h) || '#000000'
    return [
      parseInt(n.slice(1, 3), 16),
      parseInt(n.slice(3, 5), 16),
      parseInt(n.slice(5, 7), 16)
    ]
  }
  const a = parse(hex)
  const b = parse(onto)
  const t = Math.max(0, Math.min(1, amount))
  const ch = (i: number): string =>
    Math.round(a[i] * t + b[i] * (1 - t))
      .toString(16)
      .padStart(2, '0')
  return `#${ch(0)}${ch(1)}${ch(2)}`
}

/** xterm.js theme tinted by the session identity color. */
export function xtermThemeFromSessionColor(color: string): {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
} {
  const accent = normHex(color) || '#22d3ee'
  const background = mixHex(accent, '#05070a', 0.07)
  return {
    background,
    foreground: '#e2e8f0',
    cursor: accent,
    cursorAccent: background,
    selectionBackground: `${accent}66`,
    selectionForeground: '#f8fafc',
    black: '#0f172a',
    red: '#f87171',
    green: '#34d399',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e2e8f0',
    brightBlack: '#64748b',
    brightRed: '#fca5a5',
    brightGreen: '#6ee7b7',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#f8fafc'
  }
}

/** Env overlay so Grok follows OS appearance; identity color is TrueDeck chrome. */
export function agentColorEnv(
  agentId: string,
  color: SessionColor
): Record<string, string> {
  const env: Record<string, string> = {
    TRUEDECK_SESSION_COLOR: color.hex,
    TRUEDECK_SESSION_COLOR_NAME: color.cliName,
    COLORTERM: 'truecolor'
  }
  if (agentId === 'grok') {
    env.GROK_THEME = 'auto'
    env.LC_GROK_THEME = 'auto'
  }
  return env
}

export function claudeColorSeed(cliName: string): string {
  const name = cliName.replace(/[^a-z]/gi, '').toLowerCase() || 'blue'
  return `/color ${name}`
}
