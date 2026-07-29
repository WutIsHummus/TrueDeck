#!/usr/bin/env node
/**
 * TrueDeck MCP Hub — tools for agents to edit the unified MCP config.
 * Changes are written to TrueDeck's store and synced to Cursor / Claude /
 * Grok / Codex / Gemini / project .mcp.json files.
 *
 * stdio JSON-RPC (Content-Length framed), MCP protocol subset.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, platform } from 'node:os'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_NAME = 'truedeck-hub'
const SERVER_VERSION = '1.0.0'

// ── Paths ───────────────────────────────────────────────────────────────────

function dataDir() {
  if (process.env.TRUEDECK_DATA_DIR) return process.env.TRUEDECK_DATA_DIR
  if (platform() === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'TrueDeck', 'data')
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'TrueDeck', 'data')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'TrueDeck', 'data')
}

function storePath() {
  return join(dataDir(), 'mcp-servers.json')
}

function tasksPath() {
  return join(dataDir(), 'tasks.json')
}

function deckQueuePath() {
  return join(dataDir(), 'deck-command-queue.json')
}

function rolesPath() {
  return join(dataDir(), 'roles.json')
}

function pipelinesPath() {
  return join(dataDir(), 'pipelines.json')
}

function agentsPath() {
  return join(dataDir(), 'agents.json')
}

function loadTasks() {
  try {
    if (!existsSync(tasksPath())) return []
    const raw = JSON.parse(readFileSync(tasksPath(), 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveTasks(list) {
  writeJson(tasksPath(), list)
}

function listTasksFor(projectRoot) {
  const all = loadTasks()
  if (!projectRoot) return all.sort((a, b) => b.updatedAt - a.updatedAt)
  const root = String(projectRoot).replace(/\\/g, '/').toLowerCase()
  return all
    .filter((t) => String(t.projectRoot || '').replace(/\\/g, '/').toLowerCase() === root)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function createTaskRecord(input) {
  const now = Date.now()
  const task = {
    id: randomUUID(),
    projectRoot: input.projectRoot,
    title: (input.title || 'Untitled').trim(),
    body: (input.body || '').trim(),
    status: input.status || 'backlog',
    assigneeAgentId: input.assigneeAgentId,
    roleId: input.roleId,
    worktreePath: input.isolate ? '' : undefined,
    runIds: [],
    createdAt: now,
    updatedAt: now
  }
  const all = loadTasks()
  all.push(task)
  saveTasks(all)
  // Also write task file for agents
  try {
    const dir = join(input.projectRoot, '.truedeck', 'tasks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${task.id.slice(0, 8)}.md`),
      `# ${task.title}\n\n${task.body || ''}\n\nTask id: ${task.id}\n`,
      'utf8'
    )
  } catch {
    /* ignore */
  }
  return task
}

function updateTaskRecord(id, patch) {
  const all = loadTasks()
  const idx = all.findIndex((t) => t.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() }
  saveTasks(all)
  return all[idx]
}

function deleteTaskRecord(id) {
  const all = loadTasks()
  const next = all.filter((t) => t.id !== id)
  if (next.length === all.length) return false
  saveTasks(next)
  return true
}

function defaultRoles() {
  return [
    { id: 'implementer', label: 'Implementer', agentId: 'claude', color: '#22c55e' },
    { id: 'reviewer', label: 'Reviewer', agentId: 'codex', color: '#3b82f6' },
    { id: 'tester', label: 'Tester', agentId: 'shell', color: '#f59e0b' },
    { id: 'docs', label: 'Docs', agentId: 'grok', color: '#a855f7' },
    { id: 'explorer', label: 'Explorer', agentId: 'claude', color: '#06b6d4' }
  ]
}

function listRolesLocal() {
  try {
    if (!existsSync(rolesPath())) return defaultRoles()
    const raw = JSON.parse(readFileSync(rolesPath(), 'utf8'))
    if (!Array.isArray(raw) || !raw.length) return defaultRoles()
    return raw.map((r) => ({
      id: String(r.id),
      label: String(r.label || r.id),
      agentId: String(r.agentId || 'shell'),
      color: String(r.color || '#6b7280')
    }))
  } catch {
    return defaultRoles()
  }
}

function defaultPipelines() {
  return [
    { id: 'feature', name: 'Feature', steps: 2 },
    { id: 'bugfix', name: 'Bugfix', steps: 3 },
    { id: 'docs', name: 'Docs', steps: 2 },
    { id: 'graph-aware', name: 'Graph-aware explore → implement', steps: 2 }
  ]
}

function listPipelinesLocal() {
  try {
    if (!existsSync(pipelinesPath())) return defaultPipelines()
    const raw = JSON.parse(readFileSync(pipelinesPath(), 'utf8'))
    if (!Array.isArray(raw) || !raw.length) return defaultPipelines()
    return raw.map((p) => ({
      id: String(p.id),
      name: String(p.name || p.id),
      steps: Array.isArray(p.steps) ? p.steps.length : 0
    }))
  } catch {
    return defaultPipelines()
  }
}

function listAgentsLocal() {
  const fallback = [
    { id: 'grok', name: 'Grok' },
    { id: 'codex', name: 'Codex' },
    { id: 'cursor', name: 'Cursor Agent' },
    { id: 'claude', name: 'Claude' },
    { id: 'gemini', name: 'Gemini' },
    { id: 'shell', name: 'Shell' },
    { id: 'opencode', name: 'OpenCode' },
    { id: 'aider', name: 'Aider' }
  ]
  try {
    if (!existsSync(agentsPath())) return fallback
    const raw = JSON.parse(readFileSync(agentsPath(), 'utf8'))
    if (!Array.isArray(raw) || !raw.length) return fallback
    return raw.map((a) => ({
      id: String(a.id),
      name: String(a.name || a.id),
      description: a.description ? String(a.description) : undefined
    }))
  } catch {
    return fallback
  }
}

function loadDeckQueue() {
  try {
    if (!existsSync(deckQueuePath())) return []
    const raw = JSON.parse(readFileSync(deckQueuePath(), 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveDeckQueue(list) {
  writeJson(deckQueuePath(), list.slice(-80))
}

function enqueueDeckCommand(cmd) {
  const entry = {
    id: randomUUID(),
    createdAt: Date.now(),
    status: 'pending',
    ...cmd
  }
  const all = loadDeckQueue()
  all.push(entry)
  saveDeckQueue(all)
  return entry
}

function getDeckCommand(id) {
  return loadDeckQueue().find((c) => c.id === id)
}

function sleepSync(ms) {
  try {
    if (platform() === 'win32') {
      execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds ${Math.max(50, ms)}"`, {
        stdio: 'ignore',
        windowsHide: true
      })
    } else {
      execSync(`sleep ${Math.max(0.05, ms / 1000)}`, { stdio: 'ignore' })
    }
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {
      /* spin */
    }
  }
}

/** Wait for Electron worker to finish a command (best-effort). */
function waitForCommand(id, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const c = getDeckCommand(id)
    if (!c) return null
    if (c.status === 'done' || c.status === 'error') return c
    sleepSync(250)
  }
  return getDeckCommand(id)
}

function memoryProvidersPath() {
  return join(dataDir(), 'memory-providers.json')
}

function settingsPath() {
  return join(dataDir(), 'settings.json')
}

// ── JSON helpers ────────────────────────────────────────────────────────────

function readJson(path) {
  try {
    if (!existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function slugId(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return base || `mcp-${Date.now().toString(36)}`
}

function isDockerCommand(cmd) {
  if (typeof cmd !== 'string') return false
  const c = cmd.toLowerCase().replace(/\\/g, '/')
  return (
    c === 'docker' ||
    c.endsWith('/docker') ||
    c.endsWith('/docker.exe') ||
    c.includes('docker.exe')
  )
}

// ── User MCP store ──────────────────────────────────────────────────────────

function loadUserServers() {
  try {
    if (!existsSync(storePath())) return []
    const raw = JSON.parse(readFileSync(storePath(), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw
      .filter((s) => s && s.id && s.command)
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || s.id),
        enabled: s.enabled !== false,
        source: 'user',
        command: String(s.command),
        args: Array.isArray(s.args) ? s.args.map(String) : [],
        env: s.env && typeof s.env === 'object' ? s.env : undefined,
        description: s.description ? String(s.description) : undefined
      }))
  } catch {
    return []
  }
}

function saveUserServers(list) {
  const cleaned = list.map((s) => ({
    id: s.id,
    name: s.name,
    enabled: s.enabled !== false,
    source: 'user',
    command: s.command,
    args: s.args || [],
    ...(s.env ? { env: s.env } : {}),
    ...(s.description ? { description: s.description } : {})
  }))
  writeJson(storePath(), cleaned)
  return cleaned
}

function loadMemoryMcpMap() {
  const out = {}
  try {
    if (!existsSync(memoryProvidersPath())) return out
    const list = JSON.parse(readFileSync(memoryProvidersPath(), 'utf8'))
    if (!Array.isArray(list)) return out
    for (const p of list) {
      if (!p?.enabled || !p.command || p.kind === 'truememory') continue
      if (isDockerCommand(p.command)) continue
      if (p.kind === 'mempalace' && String(p.command).includes('docker')) continue
      out[p.id] = {
        command: p.command,
        args: p.args || [],
        ...(p.env ? { env: p.env } : {})
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

function buildUnifiedMap() {
  const out = { ...loadMemoryMcpMap() }
  for (const s of loadUserServers()) {
    if (!s.enabled || !s.command || isDockerCommand(s.command)) continue
    out[s.id] = {
      command: s.command,
      args: s.args || [],
      ...(s.env ? { env: s.env } : {})
    }
  }
  // Always include this hub server itself (so agents can keep editing)
  const self = selfEntry()
  if (self) out['truedeck-hub'] = self
  return out
}

function findNode() {
  if (process.env.TRUEDECK_NODE) return process.env.TRUEDECK_NODE
  // Prefer the node running this script
  if (process.execPath && !/electron/i.test(process.execPath)) return process.execPath
  return platform() === 'win32' ? 'node.exe' : 'node'
}

function selfScriptPath() {
  return fileURLToPath(import.meta.url)
}

function selfEntry() {
  const script = selfScriptPath()
  if (!existsSync(script)) return null
  return {
    command: findNode(),
    args: [script]
  }
}

// ── Inject to all clients ───────────────────────────────────────────────────

function stripDockerMemory(existing) {
  const map = {}
  const removed = []
  for (const [id, cfg] of Object.entries(existing || {})) {
    const entry = cfg && typeof cfg === 'object' ? cfg : null
    const cmd = entry?.command
    const idLow = id.toLowerCase()
    const isMemoryId =
      idLow === 'mempalace' ||
      idLow === 'truedeck' ||
      idLow === 'openmemory' ||
      idLow.includes('mempalace')
    if (isDockerCommand(cmd) && isMemoryId) {
      removed.push(id)
      continue
    }
    if (isDockerCommand(cmd) && Array.isArray(entry?.args)) {
      const args = entry.args.map(String).join(' ').toLowerCase()
      if (args.includes('mempalace')) {
        removed.push(id)
        continue
      }
    }
    map[id] = cfg
  }
  return { map, removed }
}

function mergeMcpJson(filePath, servers, key = 'mcpServers') {
  const cur = readJson(filePath)
  const raw =
    cur[key] && typeof cur[key] === 'object' && !Array.isArray(cur[key])
      ? { ...cur[key] }
      : {}
  const { map: existing } = stripDockerMemory(raw)
  for (const [id, cfg] of Object.entries(servers)) {
    if (isDockerCommand(cfg.command)) continue
    existing[id] = {
      command: cfg.command,
      args: cfg.args || [],
      ...(cfg.env ? { env: cfg.env } : {})
    }
  }
  writeJson(filePath, { ...cur, [key]: existing })
  return filePath
}

function toGrokToml(servers) {
  const lines = ['# Generated by TrueDeck MCP hub', '']
  for (const [id, cfg] of Object.entries(servers)) {
    const cmd = String(cfg.command).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const args = (cfg.args || [])
      .map((a) => `"${String(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(', ')
    lines.push(`[mcp_servers.${id}]`)
    lines.push(`command = "${cmd}"`)
    lines.push(`args = [${args}]`)
    lines.push('enabled = true')
    lines.push('startup_timeout_sec = 60')
    lines.push('')
  }
  return lines.join('\n')
}

function detectProjects() {
  const roots = []
  try {
    const projectsFile = join(dataDir(), 'projects.json')
    if (existsSync(projectsFile)) {
      const list = JSON.parse(readFileSync(projectsFile, 'utf8'))
      if (Array.isArray(list)) {
        for (const p of list) {
          if (p?.root && existsSync(p.root)) roots.push(p.root)
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (process.env.TRUEDECK_PROJECT && existsSync(process.env.TRUEDECK_PROJECT)) {
    roots.push(process.env.TRUEDECK_PROJECT)
  }
  return [...new Set(roots)]
}

function injectAll(extraProjectRoot) {
  const servers = buildUnifiedMap()
  const written = []
  const home = homedir()
  const projects = detectProjects()
  if (extraProjectRoot && existsSync(extraProjectRoot)) projects.push(extraProjectRoot)

  for (const root of [...new Set(projects)]) {
    try {
      written.push(mergeMcpJson(join(root, '.mcp.json'), servers))
    } catch {
      /* ignore */
    }
    try {
      written.push(mergeMcpJson(join(root, '.cursor', 'mcp.json'), servers))
    } catch {
      /* ignore */
    }
    try {
      written.push(mergeMcpJson(join(root, '.vscode', 'mcp.json'), servers, 'servers'))
    } catch {
      /* ignore */
    }
  }

  try {
    written.push(mergeMcpJson(join(home, '.cursor', 'mcp.json'), servers))
  } catch {
    /* ignore */
  }

  try {
    const claudeJson = join(home, '.claude.json')
    const cur = readJson(claudeJson)
    const raw =
      cur.mcpServers && typeof cur.mcpServers === 'object' ? { ...cur.mcpServers } : {}
    const { map: mcpServers } = stripDockerMemory(raw)
    for (const [id, cfg] of Object.entries(servers)) {
      if (isDockerCommand(cfg.command)) continue
      mcpServers[id] = {
        command: cfg.command,
        args: cfg.args || [],
        ...(cfg.env ? { env: cfg.env } : {})
      }
    }
    writeJson(claudeJson, { ...cur, mcpServers })
    written.push(claudeJson)
  } catch {
    /* ignore */
  }

  try {
    written.push(mergeMcpJson(join(home, '.claude', 'mcp.json'), servers))
  } catch {
    /* ignore */
  }

  try {
    const grokDir = join(home, '.grok')
    mkdirSync(grokDir, { recursive: true })
    writeFileSync(join(grokDir, 'truedeck-mcp.toml'), toGrokToml(servers), 'utf8')
    written.push(join(grokDir, 'truedeck-mcp.toml'))
    written.push(mergeMcpJson(join(grokDir, 'mcp.json'), servers))
  } catch {
    /* ignore */
  }

  try {
    const geminiDir = join(home, '.gemini')
    mkdirSync(geminiDir, { recursive: true })
    written.push(mergeMcpJson(join(geminiDir, 'mcp.json'), servers))
  } catch {
    /* ignore */
  }

  try {
    writeJson(join(dataDir(), 'unified-mcp.json'), {
      version: 1,
      generatedAt: Date.now(),
      mcpServers: servers
    })
    written.push(join(dataDir(), 'unified-mcp.json'))
  } catch {
    /* ignore */
  }

  const unique = [...new Set(written)]
  return {
    ok: true,
    serverCount: Object.keys(servers).length,
    filesWritten: unique,
    message: `Synced ${Object.keys(servers).length} MCP server(s) → ${unique.length} client config(s)`
  }
}

// ── Tool implementations ────────────────────────────────────────────────────

function listAllEntries() {
  const user = loadUserServers()
  const mem = loadMemoryMcpMap()
  const out = []
  for (const [id, cfg] of Object.entries(mem)) {
    out.push({
      id,
      name: id,
      enabled: true,
      source: 'memory',
      command: cfg.command,
      args: cfg.args || [],
      description: 'From TrueDeck memory backends'
    })
  }
  for (const u of user) {
    const i = out.findIndex((x) => x.id === u.id)
    if (i >= 0) out[i] = u
    else out.push(u)
  }
  const self = selfEntry()
  if (self) {
    out.unshift({
      id: 'truedeck-hub',
      name: 'TrueDeck MCP Hub',
      enabled: true,
      source: 'builtin',
      command: self.command,
      args: self.args,
      description: 'Edit TrueDeck MCP servers; syncs to all CLIs'
    })
  }
  return out
}

function toolList() {
  return {
    tools: [
      {
        name: 'truedeck_list_mcp',
        description:
          'List MCP servers in the TrueDeck unified hub (shared by Cursor, Claude, Grok, Codex, Gemini).',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_add_mcp',
        description:
          'Add or update an MCP server in TrueDeck. Auto-syncs to all agent CLIs (Cursor, Claude Code, Grok, etc.). Do not use docker for MemPalace — use native mempalace-mcp.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Stable id (optional; derived from name if omitted)'
            },
            name: { type: 'string', description: 'Human label' },
            command: { type: 'string', description: 'Executable (e.g. npx, node, path to .exe)' },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command arguments'
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Optional environment variables'
            },
            enabled: { type: 'boolean', description: 'Default true' },
            description: { type: 'string' },
            sync: {
              type: 'boolean',
              description: 'Sync to all CLIs after save (default true)'
            }
          },
          required: ['command'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_remove_mcp',
        description: 'Remove a user-managed MCP server from TrueDeck and re-sync all CLIs.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Server id to remove' },
            sync: { type: 'boolean', description: 'Sync after remove (default true)' }
          },
          required: ['id'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_set_mcp_enabled',
        description: 'Enable or disable a user-managed MCP server in TrueDeck; re-syncs CLIs.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            enabled: { type: 'boolean' },
            sync: { type: 'boolean', description: 'Default true' }
          },
          required: ['id', 'enabled'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_apply_mcp',
        description:
          'Force-sync the current TrueDeck MCP hub into every CLI config (Cursor, Claude, Grok, Codex, Gemini, project .mcp.json).',
        inputSchema: {
          type: 'object',
          properties: {
            projectRoot: {
              type: 'string',
              description: 'Optional extra project path to write .mcp.json into'
            }
          },
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_export_mcp',
        description: 'Export the unified MCP map as JSON (Cursor/Claude style).',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_list_agents',
        description:
          'List available TrueDeck agent CLIs (claude, codex, grok, cursor, shell, …). Use ids with truedeck_launch.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_list_roles',
        description:
          'List agent roles/personas (implementer, reviewer, tester, docs, explorer). Optional with truedeck_launch.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_list_pipelines',
        description:
          'List multi-agent pipelines (Feature, Bugfix, Docs, …). Start with truedeck_start_pipeline.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_launch',
        description:
          'PRIMARY deck action: open a real agent CLI in TrueDeck already briefed with a goal. Creates a task and dispatches a live PTY (TrueDeck app must be running). Prefer this over create_task alone.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Goal / what the agent should do'
            },
            body: {
              type: 'string',
              description: 'Optional details, files, constraints'
            },
            projectRoot: {
              type: 'string',
              description: 'Project path (defaults to TRUEDECK_PROJECT env)'
            },
            agentId: {
              type: 'string',
              description: 'Agent CLI id (claude|codex|grok|cursor|shell|…). Default claude or role default.'
            },
            roleId: {
              type: 'string',
              description: 'Optional role: implementer|reviewer|tester|docs|explorer'
            },
            isolate: {
              type: 'boolean',
              description: 'Run in an isolated git worktree (default false)'
            },
            wait: {
              type: 'boolean',
              description: 'Wait up to ~15s for TrueDeck to open the session (default true)'
            }
          },
          required: ['title'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_dispatch',
        description:
          'Dispatch an existing task id to a live agent PTY in TrueDeck (app must be running).',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            agentId: {
              type: 'string',
              description: 'Optional agent override'
            },
            wait: { type: 'boolean', description: 'Default true' }
          },
          required: ['taskId'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_start_pipeline',
        description:
          'Start a multi-agent pipeline in TrueDeck (app must be running). Uses goal title/body for each step.',
        inputSchema: {
          type: 'object',
          properties: {
            pipelineId: {
              type: 'string',
              description: 'e.g. feature | bugfix | docs | graph-aware'
            },
            title: { type: 'string', description: 'Goal title' },
            body: { type: 'string' },
            projectRoot: { type: 'string' },
            wait: { type: 'boolean', description: 'Default true' }
          },
          required: ['pipelineId', 'title'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_list_tasks',
        description:
          'List TrueDeck tasks for a project (or all). Statuses: backlog|ready|running|review|done|blocked.',
        inputSchema: {
          type: 'object',
          properties: {
            projectRoot: {
              type: 'string',
              description: 'Project path (defaults to TRUEDECK_PROJECT env)'
            }
          },
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_create_task',
        description:
          'Create a task record only (no live PTY). Prefer truedeck_launch to open an agent immediately.',
        inputSchema: {
          type: 'object',
          properties: {
            projectRoot: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            status: {
              type: 'string',
              description: 'backlog|ready|running|review|done|blocked'
            },
            assigneeAgentId: {
              type: 'string',
              description: 'claude|codex|grok|cursor|shell|…'
            },
            roleId: { type: 'string' },
            isolate: { type: 'boolean' }
          },
          required: ['title'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_update_task',
        description: 'Update a TrueDeck task (title, body, status, assignee, role).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            status: { type: 'string' },
            assigneeAgentId: { type: 'string' },
            roleId: { type: 'string' }
          },
          required: ['id'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_delete_task',
        description: 'Delete a TrueDeck task by id.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id'],
          additionalProperties: false
        }
      },
      {
        name: 'truedeck_graph_status',
        description:
          'Status of the project Graphify knowledge graph (graphify-out/graph.json). Dual memory (TrueMemory + MemPalace) is separate.',
        inputSchema: {
          type: 'object',
          properties: {
            projectRoot: {
              type: 'string',
              description: 'Project path (defaults to TRUEDECK_PROJECT or TRUEDECK_GRAPHIFY_DIR parent)'
            }
          },
          additionalProperties: false
        }
      }
    ]
  }
}

function callTool(name, args = {}) {
  const sync = args.sync !== false
  switch (name) {
    case 'truedeck_list_mcp': {
      const servers = listAllEntries()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: servers.length, servers }, null, 2)
          }
        ]
      }
    }
    case 'truedeck_add_mcp': {
      if (!args.command) throw new Error('command is required')
      if (isDockerCommand(args.command)) {
        throw new Error(
          'Docker MCP commands are blocked for TrueDeck memory. Use native binaries (e.g. mempalace-mcp).'
        )
      }
      const list = loadUserServers()
      const id = args.id || slugId(args.name || args.command)
      const next = {
        id,
        name: args.name || id,
        enabled: args.enabled !== false,
        source: 'user',
        command: String(args.command),
        args: Array.isArray(args.args) ? args.args.map(String) : [],
        env: args.env && typeof args.env === 'object' ? args.env : undefined,
        description: args.description
      }
      const idx = list.findIndex((s) => s.id === id)
      if (idx >= 0) list[idx] = next
      else list.push(next)
      saveUserServers(list)
      let inject = null
      if (sync) inject = injectAll(process.env.TRUEDECK_PROJECT)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                saved: next,
                inject
              },
              null,
              2
            )
          }
        ]
      }
    }
    case 'truedeck_remove_mcp': {
      if (!args.id) throw new Error('id is required')
      if (args.id === 'truedeck-hub') throw new Error('Cannot remove the TrueDeck hub server')
      const list = loadUserServers().filter((s) => s.id !== args.id)
      saveUserServers(list)
      let inject = null
      if (sync) inject = injectAll(process.env.TRUEDECK_PROJECT)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, removed: args.id, inject }, null, 2)
          }
        ]
      }
    }
    case 'truedeck_set_mcp_enabled': {
      if (!args.id) throw new Error('id is required')
      const list = loadUserServers().map((s) =>
        s.id === args.id ? { ...s, enabled: Boolean(args.enabled) } : s
      )
      saveUserServers(list)
      let inject = null
      if (sync) inject = injectAll(process.env.TRUEDECK_PROJECT)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: true, id: args.id, enabled: Boolean(args.enabled), inject },
              null,
              2
            )
          }
        ]
      }
    }
    case 'truedeck_apply_mcp': {
      const inject = injectAll(args.projectRoot || process.env.TRUEDECK_PROJECT)
      return {
        content: [{ type: 'text', text: JSON.stringify(inject, null, 2) }]
      }
    }
    case 'truedeck_export_mcp': {
      const map = buildUnifiedMap()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ mcpServers: map }, null, 2)
          }
        ]
      }
    }
    case 'truedeck_list_agents': {
      const agents = listAgentsLocal()
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: agents.length, agents }, null, 2) }]
      }
    }
    case 'truedeck_list_roles': {
      const roles = listRolesLocal()
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: roles.length, roles }, null, 2) }]
      }
    }
    case 'truedeck_list_pipelines': {
      const pipelines = listPipelinesLocal()
      return {
        content: [
          { type: 'text', text: JSON.stringify({ count: pipelines.length, pipelines }, null, 2) }
        ]
      }
    }
    case 'truedeck_launch': {
      const projectRoot = args.projectRoot || process.env.TRUEDECK_PROJECT
      if (!projectRoot) throw new Error('projectRoot required (or TRUEDECK_PROJECT env)')
      if (!args.title) throw new Error('title is required')
      const cmd = enqueueDeckCommand({
        type: 'launch',
        projectRoot: String(projectRoot),
        title: String(args.title),
        body: args.body != null ? String(args.body) : undefined,
        agentId: args.agentId ? String(args.agentId) : undefined,
        roleId: args.roleId ? String(args.roleId) : undefined,
        isolate: Boolean(args.isolate)
      })
      const shouldWait = args.wait !== false
      const finished = shouldWait ? waitForCommand(cmd.id) : cmd
      const status = finished?.status || cmd.status
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: status === 'done',
                queued: true,
                commandId: cmd.id,
                status,
                result: finished?.result,
                error: finished?.error,
                hint:
                  status === 'done'
                    ? 'Agent session opened in TrueDeck.'
                    : status === 'error'
                      ? `Dispatch failed: ${finished?.error || 'unknown'}`
                      : 'Queued. Keep TrueDeck running — it opens the agent CLI when the queue is processed. Retry truedeck_launch or open TrueDeck if still pending.'
              },
              null,
              2
            )
          }
        ]
      }
    }
    case 'truedeck_dispatch': {
      if (!args.taskId) throw new Error('taskId is required')
      const cmd = enqueueDeckCommand({
        type: 'dispatch',
        taskId: String(args.taskId),
        agentId: args.agentId ? String(args.agentId) : undefined
      })
      const shouldWait = args.wait !== false
      const finished = shouldWait ? waitForCommand(cmd.id) : cmd
      const status = finished?.status || cmd.status
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: status === 'done',
                commandId: cmd.id,
                status,
                result: finished?.result,
                error: finished?.error
              },
              null,
              2
            )
          }
        ]
      }
    }
    case 'truedeck_start_pipeline': {
      const projectRoot = args.projectRoot || process.env.TRUEDECK_PROJECT
      if (!projectRoot) throw new Error('projectRoot required (or TRUEDECK_PROJECT env)')
      if (!args.pipelineId) throw new Error('pipelineId is required')
      if (!args.title) throw new Error('title is required')
      const cmd = enqueueDeckCommand({
        type: 'pipeline',
        pipelineId: String(args.pipelineId),
        projectRoot: String(projectRoot),
        title: String(args.title),
        body: args.body != null ? String(args.body) : undefined
      })
      const shouldWait = args.wait !== false
      const finished = shouldWait ? waitForCommand(cmd.id, 20000) : cmd
      const status = finished?.status || cmd.status
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: status === 'done',
                commandId: cmd.id,
                status,
                result: finished?.result,
                error: finished?.error,
                hint:
                  status === 'done'
                    ? 'Pipeline started — agents open as steps run in TrueDeck.'
                    : 'Queued for TrueDeck. App must be running.'
              },
              null,
              2
            )
          }
        ]
      }
    }
    case 'truedeck_list_tasks': {
      const root = args.projectRoot || process.env.TRUEDECK_PROJECT
      const tasks = listTasksFor(root)
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: tasks.length, tasks }, null, 2) }]
      }
    }
    case 'truedeck_create_task': {
      const projectRoot = args.projectRoot || process.env.TRUEDECK_PROJECT
      if (!projectRoot) throw new Error('projectRoot required (or TRUEDECK_PROJECT env)')
      if (!args.title) throw new Error('title is required')
      const task = createTaskRecord({
        projectRoot,
        title: args.title,
        body: args.body,
        status: args.status || 'ready',
        assigneeAgentId: args.assigneeAgentId,
        roleId: args.roleId,
        isolate: args.isolate
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                task,
                hint: 'Task created. Call truedeck_dispatch or truedeck_launch to open a live agent (TrueDeck must be running).'
              },
              null,
              2
            )
          }
        ]
      }
    }
    case 'truedeck_update_task': {
      if (!args.id) throw new Error('id is required')
      const patch = {}
      if (args.title != null) patch.title = args.title
      if (args.body != null) patch.body = args.body
      if (args.status != null) patch.status = args.status
      if (args.assigneeAgentId != null) patch.assigneeAgentId = args.assigneeAgentId
      if (args.roleId != null) patch.roleId = args.roleId
      const task = updateTaskRecord(args.id, patch)
      if (!task) throw new Error(`Task not found: ${args.id}`)
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, task }, null, 2) }]
      }
    }
    case 'truedeck_delete_task': {
      if (!args.id) throw new Error('id is required')
      const ok = deleteTaskRecord(args.id)
      if (!ok) throw new Error(`Task not found: ${args.id}`)
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, deleted: args.id }, null, 2) }]
      }
    }
    case 'truedeck_graph_status': {
      const root =
        args.projectRoot ||
        process.env.TRUEDECK_PROJECT ||
        (process.env.TRUEDECK_GRAPHIFY_DIR
          ? join(process.env.TRUEDECK_GRAPHIFY_DIR, '..')
          : '')
      if (!root) throw new Error('projectRoot or TRUEDECK_PROJECT required')
      const gdir = join(String(root), 'graphify-out')
      const gjson = join(gdir, 'graph.json')
      const report = join(gdir, 'GRAPH_REPORT.md')
      const ready = existsSync(gjson)
      let nodeCount
      let edgeCount
      if (ready) {
        try {
          const raw = JSON.parse(readFileSync(gjson, 'utf8'))
          nodeCount = Array.isArray(raw.nodes)
            ? raw.nodes.length
            : Array.isArray(raw.graph?.nodes)
              ? raw.graph.nodes.length
              : undefined
          edgeCount = Array.isArray(raw.edges)
            ? raw.edges.length
            : Array.isArray(raw.graph?.edges)
              ? raw.graph.edges.length
              : undefined
        } catch {
          /* ignore */
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectRoot: root,
                ready,
                graphJsonPath: ready ? gjson : null,
                reportPath: existsSync(report) ? report : null,
                nodeCount,
                edgeCount,
                hint: ready
                  ? 'Read GRAPH_REPORT.md or graph.json for architecture. TrueDeck refreshes this graph automatically.'
                  : 'Graph not ready yet. TrueDeck builds it in the background when graphify is installed — do not ask the user to sync.'
              },
              null,
              2
            )
          }
        ]
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── MCP stdio (Content-Length framing) ──────────────────────────────────────

function send(msg) {
  const body = JSON.stringify(msg)
  const buf = Buffer.from(body, 'utf8')
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`)
  process.stdout.write(buf)
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return

  // notifications — no response
  if (msg.method && msg.id === undefined) {
    if (msg.method === 'notifications/initialized') return
    return
  }

  const id = msg.id
  try {
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
        }
      })
      return
    }
    if (msg.method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} })
      return
    }
    if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: toolList() })
      return
    }
    if (msg.method === 'tools/call') {
      const name = msg.params?.name
      const args = msg.params?.arguments || {}
      const result = callTool(name, args)
      send({ jsonrpc: '2.0', id, result })
      return
    }
    // Unknown method
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${msg.method}` }
    })
  } catch (e) {
    const errText = e instanceof Error ? e.message : String(e)
    if (msg.method === 'tools/call') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${errText}` }],
          isError: true
        }
      })
    } else {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: errText }
      })
    }
  }
}

// Frame parser
let buffer = Buffer.alloc(0)

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) {
      // Also accept newline-delimited JSON (some clients)
      const nl = buffer.indexOf('\n')
      if (nl >= 0) {
        const line = buffer.slice(0, nl).toString('utf8').trim()
        buffer = buffer.slice(nl + 1)
        if (!line || line.toLowerCase().startsWith('content-length')) continue
        try {
          handleMessage(JSON.parse(line))
        } catch {
          /* ignore partial */
        }
        continue
      }
      break
    }
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const len = parseInt(match[1], 10)
    const start = headerEnd + 4
    if (buffer.length < start + len) break
    const body = buffer.slice(start, start + len).toString('utf8')
    buffer = buffer.slice(start + len)
    try {
      handleMessage(JSON.parse(body))
    } catch (e) {
      // ignore parse errors
    }
  }
}

process.stdin.on('data', onData)
process.stdin.on('end', () => process.exit(0))

// Keep alive
process.stdin.resume()
