import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync
} from 'fs'
import { join, relative, basename } from 'path'
import { getGlobalMemoryDir, getRepoMemoryDir } from './paths'
import type { MemoryNote, MemoryScope } from '../shared/types'

const INDEX_TEMPLATE = `# Memory Index

Durable notes for AI agents. Commit repo memory with your project.

## How agents should use this

1. Read this INDEX first, then relevant notes under context/, patterns/, decisions/.
2. When you learn something durable, write a short markdown note.
3. Session logs go under sessions/ (optional to commit).

## Layout

| Path | Purpose |
|------|---------|
| context/ | Always-true facts |
| patterns/ | How-tos and conventions |
| decisions/ | Architecture decisions |
| sessions/ | Day logs |
`

function ensureTree(root: string): void {
  for (const sub of ['context', 'patterns', 'decisions', 'sessions']) {
    mkdirSync(join(root, sub), { recursive: true })
  }
  const index = join(root, 'INDEX.md')
  if (!existsSync(index)) {
    writeFileSync(index, INDEX_TEMPLATE, 'utf8')
  }
}

export function ensureGlobalMemory(): string {
  const dir = getGlobalMemoryDir()
  ensureTree(dir)
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# TrueDeck Global Memory

Cross-project memory shared by every agent in every repo.

Use this for:
- Your personal coding preferences
- Tools you always have installed
- Patterns that apply everywhere

Repo-specific facts belong in each project's \`.memory/\` folder.
`,
      'utf8'
    )
  }
  return dir
}

export function ensureRepoMemory(projectRoot: string): string {
  const dir = getRepoMemoryDir(projectRoot)
  ensureTree(dir)
  return dir
}

function walkMarkdown(root: string, base = root): MemoryNote[] {
  if (!existsSync(root)) return []
  const out: MemoryNote[] = []
  for (const name of readdirSync(root)) {
    const full = join(root, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue
      out.push(...walkMarkdown(full, base))
    } else if (name.endsWith('.md')) {
      const content = readFileSync(full, 'utf8')
      const title =
        content
          .split(/\r?\n/)
          .find((l) => l.startsWith('# '))
          ?.replace(/^#\s+/, '')
          .trim() || basename(name, '.md')
      out.push({
        id: relative(base, full).replace(/\\/g, '/'),
        path: full,
        relativePath: relative(base, full).replace(/\\/g, '/'),
        title,
        content,
        mtime: st.mtimeMs
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export function listMemory(scope: MemoryScope, projectRoot?: string): MemoryNote[] {
  if (scope === 'global') {
    const root = ensureGlobalMemory()
    return walkMarkdown(root).map((n) => ({ ...n, scope: 'global' as const }))
  }
  if (!projectRoot) return []
  const root = ensureRepoMemory(projectRoot)
  return walkMarkdown(root).map((n) => ({ ...n, scope: 'repo' as const }))
}

export function readMemoryNote(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

export function writeMemoryNote(opts: {
  scope: MemoryScope
  projectRoot?: string
  relativePath: string
  content: string
}): MemoryNote {
  const root =
    opts.scope === 'global'
      ? ensureGlobalMemory()
      : ensureRepoMemory(opts.projectRoot || process.cwd())
  const safe = opts.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const full = join(root, safe)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, opts.content, 'utf8')
  const st = statSync(full)
  const title =
    opts.content
      .split(/\r?\n/)
      .find((l) => l.startsWith('# '))
      ?.replace(/^#\s+/, '')
      .trim() || basename(safe, '.md')
  return {
    id: safe,
    path: full,
    relativePath: safe,
    title,
    content: opts.content,
    mtime: st.mtimeMs,
    scope: opts.scope
  }
}

export function deleteMemoryNote(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath)
}

export function buildAgentBootstrapPrompt(projectRoot?: string): string {
  const globalDir = ensureGlobalMemory()
  const parts: string[] = [
    'You are running inside TrueDeck, a multi-agent coding workbench.',
    '',
    '## Memory protocol',
    `- Global (cross-project) memory: ${globalDir}`,
    '  Read INDEX.md and relevant notes. Write durable personal prefs here.',
  ]
  if (projectRoot) {
    const repoDir = ensureRepoMemory(projectRoot)
    parts.push(
      `- Repo memory: ${repoDir}`,
      '  Project-specific facts, decisions, patterns. Commit with the repo when useful.',
      '',
      'At session start: skim both INDEX.md files for relevant context.',
      'When you learn something durable, write a short markdown note (do not dump secrets).'
    )
  }
  return parts.join('\n')
}
