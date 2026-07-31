/**
 * Detect filesystem paths in terminal text for click → Document view.
 * Local absolute (Win/Unix), UNC, and project-relative code paths.
 *
 * Also covers agent TUI edit lines, e.g.:
 *   ◆ Edit ReplicatedStorage\Shared\Modules\GuideBeamStyle.luau
 */

/** File-ish extensions we treat as openable documents (not random words). */
const PATH_EXT =
  '(?:md|mdx|markdown|txt|json|jsonc|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|cpp|cc|c|h|hpp|css|scss|less|html|htm|xml|yaml|yml|toml|ini|cfg|conf|sh|bash|ps1|bat|cmd|sql|graphql|gql|env|log|lock|svg|vue|svelte|rb|php|swift|luau|lua|zig|nim|ex|exs|erl|hs|r|dart|proto|gradle|cmake|make|mk|dockerfile|gitignore|gitattributes|editorconfig|npmrc|eslintrc|prettierrc|rbxl|rbxm)'

/** Absolute Windows: C:\foo\bar.ts  or  C:/foo/bar.ts */
const WIN_ABS =
  /(?:[A-Za-z]:(?:\\|\/)(?:[^\s"'`<>|*?\r\n\\/]+(?:\\|\/)?)*[^\s"'`<>|*?\r\n\\/.,;:)\]]+)/g

/** UNC: \\server\share\path */
const UNC = /(?:\\\\[^\s"'`<>|*?\r\n]+(?:\\[^\s"'`<>|*?\r\n]+)+)/g

/**
 * Unix absolute with multi-segment path.
 * Negative lookbehind avoids eating relative paths like src/foo/bar.ts
 * (which would otherwise match only /foo/bar.ts).
 */
const UNIX_ABS =
  /(?<![\w.@+-./])(\/(?:[\w.@+-]+\/)+[\w.@+-]+(?:\.[A-Za-z0-9]+)?)/g

/**
 * Relative project paths with / or \ :
 *   src/foo.ts, ./lib/a.tsx, .memory/context/x.md
 *   ReplicatedStorage\Shared\Modules\GuideBeamStyle.luau
 * Require a separator and a file extension to reduce false positives.
 */
const REL_CODE = new RegExp(
  `(?:\\.?\\.?[\\\\/])?(?:[\\w.@+-]+[\\\\/])+[\\w.@+-]+\\.${PATH_EXT}\\b`,
  'gi'
)

/**
 * Agent tool lines: "Edit path", "Write path", "Create path", "Read path"
 * after a leading symbol (◆, ●, •, -, *). Captures the path group.
 */
const AGENT_EDIT_LINE = new RegExp(
  `(?:^|[\\s\\|])(?:[◆●•▪▸►★☆✓✔✗✘+\\-*]+\\s+)?(?:Edit|Write|Create|Read|Update|Delete|Open|View|Show|Apply|Patch|Touch)\\s+(\\.?[\\\\/]?(?:[\\w.@+-]+[\\\\/])+[\\w.@+-]+\\.${PATH_EXT})\\b`,
  'gi'
)

export type PathMatch = {
  text: string
  start: number
  end: number
}

function pushMatches(re: RegExp, line: string, out: PathMatch[]): void {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    let text = m[0]
    // Trim trailing punctuation often stuck to paths
    text = text.replace(/[.,;:)+\]}>]+$/g, '')
    if (text.length < 3) continue
    const start = m.index
    const end = start + text.length
    // Skip if overlaps an earlier match
    if (out.some((x) => !(end <= x.start || start >= x.end))) continue
    out.push({ text, start, end })
  }
}

/** Push capture-group paths (group 1) when present, else full match. */
function pushCaptureMatches(re: RegExp, line: string, out: PathMatch[]): void {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const full = m[0]
    const captured = (m[1] || full).trim()
    let text = captured.replace(/[.,;:)+\]}>]+$/g, '')
    if (text.length < 3) continue
    // Align start to the path within the full match
    const offsetInMatch = full.indexOf(captured)
    const start = m.index + (offsetInMatch >= 0 ? offsetInMatch : 0)
    const end = start + text.length
    if (out.some((x) => !(end <= x.start || start >= x.end))) continue
    out.push({ text, start, end })
  }
}

/** Find path-like spans in a single terminal line (string indices). */
export function findPathMatchesInLine(line: string): PathMatch[] {
  if (!line || line.length < 3) return []
  const out: PathMatch[] = []
  pushMatches(WIN_ABS, line, out)
  pushMatches(UNC, line, out)
  pushMatches(UNIX_ABS, line, out)
  pushMatches(REL_CODE, line, out)
  // Agent edit lines as a backup (same paths often already caught by REL_CODE)
  pushCaptureMatches(AGENT_EDIT_LINE, line, out)
  out.sort((a, b) => a.start - b.start)
  return out
}

/**
 * Read an xterm buffer line cell-by-cell so match ranges map to columns
 * (wide/empty cells would desync a naive string index).
 */
export type TerminalLineRead = {
  text: string
  /** string index → 0-based cell column */
  strToCell: number[]
}

export function readTerminalLineCells(getChars: (col: number) => string, cols: number): TerminalLineRead {
  let text = ''
  const strToCell: number[] = []
  const n = Math.max(0, cols | 0)
  for (let col = 0; col < n; col++) {
    const ch = getChars(col) || ''
    if (!ch) {
      text += ' '
      strToCell.push(col)
      continue
    }
    for (let i = 0; i < ch.length; i++) {
      text += ch[i]
      strToCell.push(col)
    }
  }
  // Trim only trailing spaces for matching, keep map for in-range columns
  return { text, strToCell }
}

/** Convert a string-index match into 0-based inclusive cell columns. */
export function matchToCellRange(
  match: PathMatch,
  strToCell: number[]
): { startCol: number; endCol: number } | null {
  if (!strToCell.length) return null
  const s = Math.max(0, Math.min(strToCell.length - 1, match.start))
  const e = Math.max(0, Math.min(strToCell.length - 1, Math.max(match.start, match.end - 1)))
  return { startCol: strToCell[s], endCol: strToCell[e] }
}

/**
 * Path under a 0-based cell column on a terminal line, if any.
 * Returns the raw matched path text.
 */
export function findPathAtColumn(lineText: string, col: number, strToCell?: number[]): string | null {
  const matches = findPathMatchesInLine(lineText)
  if (!matches.length) return null
  for (const m of matches) {
    if (strToCell && strToCell.length) {
      const range = matchToCellRange(m, strToCell)
      if (!range) continue
      if (col >= range.startCol && col <= range.endCol) return m.text
    } else if (col >= m.start && col < m.end) {
      return m.text
    }
  }
  return null
}

/** Resolve a path text against a project root (relative → absolute). */
export function resolvePathCandidate(
  raw: string,
  projectRoot?: string | null
): string {
  let p = (raw || '').trim().replace(/^['"`]+|['"`]+$/g, '')
  if (!p) return ''
  // Normalize mixed separators for Windows abs detection
  if (/^[A-Za-z]:\//.test(p)) p = p.replace(/\//g, '\\')
  if (/^[A-Za-z]:\\/.test(p) || p.startsWith('\\\\') || p.startsWith('/')) {
    return p
  }
  if (projectRoot) {
    const root = projectRoot.replace(/[\\/]+$/, '')
    const rel = p
      .replace(/^\.[\\/]/, '')
      .replace(/\//g, '\\')
      .replace(/^\\+/, '')
    return `${root}\\${rel}`.replace(/\\+/g, '\\')
  }
  return p
}

/** HTTP(S) only — “non-local” path; open externally, not document tab. */
export function isHttpUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim())
}
