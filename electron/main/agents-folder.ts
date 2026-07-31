/**
 * Unified project agent folder: `.agents/`
 *
 * One place for multi-CLI instructions + project MCP instead of scattering
 * TrueDeck writes across AGENTS.md, CLAUDE.md, .cursor/, .vscode/, etc.
 *
 * Layout:
 *   .agents/AGENTS.md   — canonical agent instructions + TrueDeck memory pointer
 *   .agents/mcp.json    — project MCP map (mcpServers)
 *   AGENTS.md / CLAUDE.md at repo root — thin bridges that point at .agents/
 *
 * User-home CLI configs (~/.cursor, ~/.claude, …) still receive MCP inject so
 * each product can load servers; project-local vendor folders are no longer
 * the source of truth.
 *
 * Agent injection (injectMemoryForAgent / onAgentSpawnFast) always ensures this
 * folder and exports TRUEDECK_AGENTS_* env so every spawned CLI can find it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

export const AGENTS_DIR = '.agents'
export const AGENTS_MD = 'AGENTS.md'
export const AGENTS_MCP = 'mcp.json'
export const POINTER_MARK = 'truedeck-memory'

export function agentsDir(projectRoot: string): string {
  return join(projectRoot, AGENTS_DIR)
}

export function agentsMdPath(projectRoot: string): string {
  return join(agentsDir(projectRoot), AGENTS_MD)
}

export function agentsMcpPath(projectRoot: string): string {
  return join(agentsDir(projectRoot), AGENTS_MCP)
}

/** Global user-level TrueDeck agent notes (replaces per-CLI ~/.codex, ~/.grok, …). */
export function globalAgentsDir(): string {
  return join(homedir(), AGENTS_DIR)
}

export function globalAgentsMemoryNotePath(): string {
  return join(globalAgentsDir(), 'truedeck-memory.md')
}

function memoryPointerBlock(): string {
  return [
    '',
    `<!-- ${POINTER_MARK} -->`,
    '## TrueDeck memory (automatic)',
    'At session start, read `.truedeck/auto-context.md` for project memory.',
    'Durable facts: `.memory/context/` or `.memory/decisions/`; MemPalace MCP for search/recall.',
    'Project agent rules and MCP live under **`.agents/`** (unified for all CLIs).',
    'Canonical instructions: `.agents/AGENTS.md`. Project MCP: `.agents/mcp.json` (mirrored to root `.mcp.json`).',
    'TrueDeck hub (`truedeck-hub`): `truedeck_show`, `truedeck_launch`, MCP config tools — app must be running.',
    'Do not ask the user to manage memory, Graphify, or MCP wiring.',
    `<!-- /${POINTER_MARK} -->`,
    ''
  ].join('\n')
}

function canonicalAgentsBody(): string {
  return [
    '# Agent instructions',
    '',
    'This file is the **canonical** multi-agent guide for this repo (TrueDeck `.agents/` folder).',
    'All coding CLIs (Claude, Cursor, Codex, Grok, Gemini, …) should treat this as the shared source of truth.',
    '',
    memoryPointerBlock().trim(),
    '',
    '## Project MCP',
    'Project MCP servers: `.agents/mcp.json` (also mirrored to root `.mcp.json` for tools that only read the root).',
    ''
  ].join('\n')
}

function rootBridgeBody(kind: 'AGENTS' | 'CLAUDE'): string {
  const title = kind === 'CLAUDE' ? '# Claude Code' : '# Agent instructions'
  return [
    title,
    '',
    '> **Canonical agent config:** [`.agents/AGENTS.md`](.agents/AGENTS.md)',
    '>',
    '> TrueDeck keeps a unified `.agents/` folder for all CLIs. Prefer that file over vendor-specific roots.',
    '',
    memoryPointerBlock().trim(),
    ''
  ].join('\n')
}

/** True when content already has the current unified `.agents` pointer. */
function hasCurrentAgentsPointer(content: string): boolean {
  return (
    content.includes(POINTER_MARK) &&
    content.includes('.agents/') &&
    (content.includes('.agents/AGENTS.md') || content.includes('**`.agents/`**'))
  )
}

/**
 * Insert or replace the TrueDeck memory pointer block so it always mentions
 * the unified `.agents/` folder (upgrades legacy root-only pointers).
 */
function upsertPointerBlock(content: string): string {
  const block = memoryPointerBlock().trim()
  if (content.includes(`<!-- ${POINTER_MARK} -->`)) {
    const replaced = content.replace(
      new RegExp(
        `<!-- ${POINTER_MARK} -->[\\s\\S]*?<!-- /${POINTER_MARK} -->`,
        'm'
      ),
      block
    )
    if (replaced !== content) return replaced
    if (hasCurrentAgentsPointer(content)) return content
    // Malformed / partial mark — append current block
    return content.trimEnd() + '\n\n' + block + '\n'
  }
  if (hasCurrentAgentsPointer(content)) return content
  return content.trimEnd() + '\n\n' + block + '\n'
}

function ensureFile(path: string, fullBodyIfMissing: string, force = false): string {
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) {
    writeFileSync(path, fullBodyIfMissing, 'utf8')
    return path
  }
  const cur = readFileSync(path, 'utf8')
  if (!force && hasCurrentAgentsPointer(cur) && cur.includes('.agents/AGENTS.md')) {
    return path
  }
  // Existing user/root file: upgrade pointer in place; if it is a TrueDeck-only
  // bridge (no real content beyond title), rewrite to current bridge body.
  const isThinBridge =
    cur.includes('Canonical agent config') ||
    cur.includes('truedeck-memory') ||
    cur.trim().length < 80
  if (force && isThinBridge) {
    writeFileSync(path, fullBodyIfMissing, 'utf8')
    return path
  }
  const next = upsertPointerBlock(cur)
  if (next !== cur) writeFileSync(path, next, 'utf8')
  return path
}

/**
 * Ensure project has unified `.agents/` + thin root bridges.
 * Returns paths written/touched.
 *
 * Called from agent inject, auto-context, project open, and agent spawn.
 */
export function ensureUnifiedAgentsFolder(
  projectRoot: string,
  opts?: { force?: boolean }
): string[] {
  if (!projectRoot || !existsSync(projectRoot)) return []
  const force = Boolean(opts?.force)
  const written: string[] = []
  const dir = agentsDir(projectRoot)
  mkdirSync(dir, { recursive: true })

  // Canonical instructions
  const canonical = agentsMdPath(projectRoot)
  if (!existsSync(canonical)) {
    writeFileSync(canonical, canonicalAgentsBody(), 'utf8')
  } else {
    const cur = readFileSync(canonical, 'utf8')
    if (force || !hasCurrentAgentsPointer(cur)) {
      // Prefer full canonical body when file is still TrueDeck-managed / thin
      const thin =
        !cur.trim() ||
        cur.includes('TrueDeck `.agents/` folder') ||
        (cur.includes(POINTER_MARK) && cur.length < 1200)
      if (force && thin) {
        writeFileSync(canonical, canonicalAgentsBody(), 'utf8')
      } else {
        const next = upsertPointerBlock(cur)
        if (next !== cur) writeFileSync(canonical, next, 'utf8')
      }
    }
  }
  written.push(canonical)

  // Thin root bridges for tools that only load repo-root AGENTS.md / CLAUDE.md
  written.push(ensureFile(join(projectRoot, 'AGENTS.md'), rootBridgeBody('AGENTS'), force))
  written.push(ensureFile(join(projectRoot, 'CLAUDE.md'), rootBridgeBody('CLAUDE'), force))

  // README so humans know the folder
  const readme = join(dir, 'README.md')
  if (!existsSync(readme) || force) {
    writeFileSync(
      readme,
      [
        '# `.agents/` — unified multi-CLI config',
        '',
        'TrueDeck uses this folder for **all** coding agents instead of separate',
        '`.cursor/`, Claude-only, or vendor trees for project instructions.',
        '',
        '| File | Purpose |',
        '|------|---------|',
        '| `AGENTS.md` | Canonical agent instructions + memory pointer |',
        '| `mcp.json` | Project MCP server map |',
        '',
        'Root `AGENTS.md` / `CLAUDE.md` are thin bridges that point here.',
        'Agent inject and spawn always ensure this folder exists.',
        ''
      ].join('\n'),
      'utf8'
    )
    written.push(readme)
  }

  return [...new Set(written)]
}

/** Whether unified agent instructions exist (setup status). */
export function hasUnifiedAgentsFolder(projectRoot: string): boolean {
  try {
    const p = agentsMdPath(projectRoot)
    if (existsSync(p) && hasCurrentAgentsPointer(readFileSync(p, 'utf8'))) return true
    // Legacy: root AGENTS.md still counts if it mentions .agents or old pointer
    const root = join(projectRoot, 'AGENTS.md')
    if (!existsSync(root)) return false
    const cur = readFileSync(root, 'utf8')
    return hasCurrentAgentsPointer(cur) || cur.includes(POINTER_MARK)
  } catch {
    return false
  }
}

/**
 * Env bag every agent process should inherit for the unified `.agents/` folder.
 * Merged into memoryEnv / spawn env by memory-service.
 *
 * Paths only — do **not** mkdir/write here (spawn critical path). Callers that
 * need files on disk should run ensureUnifiedAgentsFolder in the background.
 */
export function agentsEnv(projectRoot: string): Record<string, string> {
  if (!projectRoot) return {}
  const dir = agentsDir(projectRoot)
  return {
    TRUEDECK_AGENTS_DIR: dir,
    TRUEDECK_AGENTS_MD: agentsMdPath(projectRoot),
    TRUEDECK_AGENTS_MCP: agentsMcpPath(projectRoot),
    TRUEDECK_GLOBAL_AGENTS: globalAgentsDir(),
    TRUEDECK_GLOBAL_AGENTS_NOTE: globalAgentsMemoryNotePath()
  }
}

/**
 * Write project MCP into `.agents/mcp.json` and mirror to root `.mcp.json`
 * (many CLIs only auto-load the root file).
 */
export function writeProjectMcpMap(
  projectRoot: string,
  servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>
): string[] {
  const written: string[] = []
  mkdirSync(agentsDir(projectRoot), { recursive: true })
  const body = JSON.stringify({ mcpServers: servers }, null, 2) + '\n'
  const agentsMcp = agentsMcpPath(projectRoot)
  writeFileSync(agentsMcp, body, 'utf8')
  written.push(agentsMcp)
  // Mirror root for Codex/generic loaders
  const rootMcp = join(projectRoot, '.mcp.json')
  writeFileSync(rootMcp, body, 'utf8')
  written.push(rootMcp)
  return written
}

/** Single global note for all CLIs under ~/.agents/ */
export function writeGlobalAgentsMemoryNote(
  palace: string,
  projectRoot?: string
): string | null {
  try {
    mkdirSync(globalAgentsDir(), { recursive: true })
    const body = [
      '# TrueDeck memory (automatic)',
      '',
      'Shared note for every coding CLI under TrueDeck.',
      '',
      'When running under TrueDeck:',
      '- Read project `.truedeck/auto-context.md` at session start.',
      '- Project agent rules: `.agents/AGENTS.md` (unified folder).',
      `- MemPalace palace: \`${palace}\``,
      '- Durable notes: `.memory/` in the repo.',
      '- MCP is injected by TrueDeck (see project `.agents/mcp.json` + root `.mcp.json`).',
      projectRoot ? `- Last project: \`${projectRoot}\`` : '',
      '- Env (when spawned by TrueDeck): `TRUEDECK_AGENTS_DIR`, `TRUEDECK_AGENTS_MD`, `TRUEDECK_AGENTS_MCP`.',
      '- Do not ask the user to manage memory, Graphify, or MCP wiring.',
      ''
    ]
      .filter(Boolean)
      .join('\n')
    const note = globalAgentsMemoryNotePath()
    writeFileSync(note, body, 'utf8')
    return note
  } catch {
    return null
  }
}
