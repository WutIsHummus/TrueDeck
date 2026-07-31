/**
 * Lightweight markdown → React for document tabs.
 * No dependency - enough for plans, notes, and README-style docs.
 */

import type { ReactNode } from 'react'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline: `code`, **bold**, *italic*, [text](url) */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index))
    }
    const tok = m[0]
    const k = `${keyPrefix}-i${i++}`
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={k} className="doc-md-code">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(
        <strong key={k}>{tok.slice(2, -2)}</strong>
      )
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>)
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (lm) {
        nodes.push(
          <a
            key={k}
            className="doc-md-link"
            href={lm[2]}
            onClick={(e) => {
              e.preventDefault()
              void window.truedeck?.openExternal?.(lm[2]).catch(() => {
                /* ignore */
              })
            }}
          >
            {lm[1]}
          </a>
        )
      } else {
        nodes.push(tok)
      }
    } else {
      nodes.push(tok)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : [text]
}

export function SimpleMarkdown({ source }: { source: string }): JSX.Element {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let bi = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      i += 1
      const body: string[] = []
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push(
        <pre key={`b${bi++}`} className="doc-md-pre" data-lang={lang || undefined}>
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`b${bi++}`} className="doc-md-hr" />)
      i += 1
      continue
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements
      blocks.push(
        <Tag key={`b${bi++}`} className={`doc-md-h doc-md-h${level}`}>
          {renderInline(h[2], `h${bi}`)}
        </Tag>
      )
      i += 1
      continue
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*[-*+]\s+/, '')
        items.push(
          <li key={`li${bi}-${items.length}`}>{renderInline(item, `li${bi}${items.length}`)}</li>
        )
        i += 1
      }
      blocks.push(
        <ul key={`b${bi++}`} className="doc-md-ul">
          {items}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*\d+\.\s+/, '')
        items.push(
          <li key={`oli${bi}-${items.length}`}>
            {renderInline(item, `oli${bi}${items.length}`)}
          </li>
        )
        i += 1
      }
      blocks.push(
        <ol key={`b${bi++}`} className="doc-md-ol">
          {items}
        </ol>
      )
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(
        <blockquote key={`b${bi++}`} className="doc-md-quote">
          {renderInline(body.join(' '), `q${bi}`)}
        </blockquote>
      )
      continue
    }

    // Blank
    if (!line.trim()) {
      i += 1
      continue
    }

    // Paragraph (merge consecutive non-empty non-special lines)
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+\.\s|\s*>|(-{3,}|\*{3,}|_{3,})\s*$)/.test(
        lines[i]
      )
    ) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={`b${bi++}`} className="doc-md-p">
        {renderInline(para.join(' '), `p${bi}`)}
      </p>
    )
  }

  if (!blocks.length) {
    return <p className="doc-md-empty muted">Empty file</p>
  }

  return <div className="doc-md">{blocks}</div>
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path || '')
}

export function languageHint(path: string): string {
  const base = (path || '').replace(/\\/g, '/').split('/').pop() || ''
  const ext = (base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base).toLowerCase()
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    mts: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JSX',
    mjs: 'JavaScript',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    json: 'JSON',
    jsonc: 'JSON',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    md: 'Markdown',
    mdx: 'MDX',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    sh: 'Shell',
    bash: 'Shell',
    ps1: 'PowerShell',
    lua: 'Lua',
    luau: 'Luau',
    sql: 'SQL',
    java: 'Java',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    rb: 'Ruby',
    php: 'PHP',
    swift: 'Swift',
    txt: 'Text',
    log: 'Log'
  }
  return map[ext] || (ext ? ext.toUpperCase() : 'Text')
}

/** Unused helper kept for potential HTML path */
export function escapeForTitle(s: string): string {
  return escapeHtml(s)
}
