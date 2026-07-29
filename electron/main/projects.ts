import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
 existsSync,
 mkdirSync,
 readFileSync,
 writeFileSync,
 readdirSync,
 statSync
} from 'fs'
import { dirname, basename, normalize, join } from 'path'
import { homedir } from 'os'
import { getProjectsStorePath, getGlobalDataDir } from './paths'
import type { ProjectConfig, ProjectOnOpenCommand } from '../shared/types'
import { ensureRepoMemory } from './memory'

const execFileAsync = promisify(execFile)

/** Stable unique id from full path (never truncate - short slice collided under C:\Users\…). */
export function projectIdFromRoot(root: string): string {
 const key = normalizeRootKey(root)
 return createHash('sha256').update(key).digest('hex').slice(0, 24)
}

function normalizeRootKey(root: string): string {
 try {
 return normalize(root).replace(/[\\/]+$/, '').toLowerCase()
 } catch {
 return String(root || '')
 .replace(/\//g, '\\')
 .replace(/[\\/]+$/, '')
 .toLowerCase()
 }
}

function displayNameFromRoot(root: string): string {
 const base = basename(root.replace(/[\\/]+$/, ''))
 return base || root
}

function loadRaw(): ProjectConfig[] {
 const path = getProjectsStorePath()
 try {
 if (existsSync(path)) {
 const raw = JSON.parse(readFileSync(path, 'utf8')) as ProjectConfig[]
 return Array.isArray(raw) ? raw : []
 }
 } catch {
 // ignore
 }
 return []
}

/**
 * Fix legacy short base64 ids (collisions) and sticky wrong names.
 * One project per root; id = hash(root); name = folder basename.
 */
function migrateProjects(projects: ProjectConfig[]): {
 list: ProjectConfig[]
 changed: boolean
} {
 const byRoot = new Map<string, ProjectConfig>()
 let changed = false

 for (const p of projects) {
 if (!p?.root || typeof p.root !== 'string') {
 changed = true
 continue
 }
 const key = normalizeRootKey(p.root)
 const id = projectIdFromRoot(p.root)
 const name = displayNameFromRoot(p.root)
 if (p.id !== id || p.name !== name) changed = true

 const next: ProjectConfig = {
 ...p,
 id,
 name,
 root: p.root,
 onOpenCommands: Array.isArray(p.onOpenCommands) ? p.onOpenCommands : [],
 defaultAgents: Array.isArray(p.defaultAgents) ? p.defaultAgents : []
 }

 const prev = byRoot.get(key)
 if (!prev) {
 byRoot.set(key, next)
 } else {
 // Dedupe: keep the more recently opened, merge on-open commands
 changed = true
 const prefer =
 (next.lastOpened || 0) >= (prev.lastOpened || 0) ? next : prev
 const other = prefer === next ? prev : next
 byRoot.set(key, {
 ...prefer,
 id,
 name,
 onOpenCommands:
 prefer.onOpenCommands?.length > 0
 ? prefer.onOpenCommands
 : other.onOpenCommands || [],
 defaultAgents:
 prefer.defaultAgents?.length > 0
 ? prefer.defaultAgents
 : other.defaultAgents || []
 })
 }
 }

 const list = [...byRoot.values()]
 if (list.length !== projects.length) changed = true
 return { list, changed }
}

function loadAll(): ProjectConfig[] {
 const raw = loadRaw()
 const { list, changed } = migrateProjects(raw)
 if (changed) {
 try {
 saveAll(list)
 console.log(
 `[projects] migrated ${raw.length} → ${list.length} project(s) (unique ids + folder names)`
 )
 } catch {
 // ignore write failures
 }
 }
 return list
}

function saveAll(projects: ProjectConfig[]): void {
 const path = getProjectsStorePath()
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(projects, null, 2), 'utf8')
}

export function listProjects(): ProjectConfig[] {
 return loadAll().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
}

export function upsertProject(root: string, patch?: Partial<ProjectConfig>): ProjectConfig {
 const projects = loadAll()
 const key = normalizeRootKey(root)
 const existing = projects.find((p) => normalizeRootKey(p.root) === key)
 const id = projectIdFromRoot(root)

 // Name: explicit patch wins; else always folder basename (no sticky wrong labels)
 const name =
 patch?.name !== undefined && patch.name.trim()
 ? patch.name.trim()
 : displayNameFromRoot(root)

 const next: ProjectConfig = {
 id,
 name,
 root: existing?.root || root,
 lastOpened: Date.now(),
 onOpenCommands: patch?.onOpenCommands ?? existing?.onOpenCommands ?? [],
 defaultAgents: patch?.defaultAgents ?? existing?.defaultAgents ?? [],
 color: patch?.color !== undefined ? patch.color : existing?.color
 }

 const filtered = projects.filter((p) => normalizeRootKey(p.root) !== key)
 filtered.push(next)
 saveAll(filtered)
 ensureRepoMemory(next.root)
 return next
}

export function removeProject(id: string): void {
 saveAll(loadAll().filter((p) => p.id !== id && normalizeRootKey(p.root) !== normalizeRootKey(id)))
}

export function getProject(id: string): ProjectConfig | undefined {
 const all = loadAll()
 const byId = all.find((p) => p.id === id)
 if (byId) return byId
 // Resolve by root path (callers sometimes pass a folder path)
 const byRoot = all.find((p) => normalizeRootKey(p.root) === normalizeRootKey(id))
 if (byRoot) return byRoot
 // Legacy: id was truncated base64 of path prefix - match if root hashes to different id
 return undefined
}

export function setOnOpenCommands(
 id: string,
 commands: ProjectOnOpenCommand[]
): ProjectConfig | undefined {
 const projects = loadAll()
 const idx = projects.findIndex(
 (p) => p.id === id || normalizeRootKey(p.root) === normalizeRootKey(id)
 )
 if (idx < 0) return undefined
 projects[idx] = { ...projects[idx], onOpenCommands: commands }
 saveAll(projects)
 return projects[idx]
}

/** Default parent for `git clone` when the user doesn't pick a folder. */
export function getDefaultCloneParent(): string {
 const preferred = join(homedir(), 'Source')
 const alt = join(homedir(), 'repos')
 const fall = join(getGlobalDataDir(), 'repos')
 if (existsSync(preferred)) return preferred
 if (existsSync(alt)) return alt
 try {
 mkdirSync(fall, { recursive: true })
 } catch {
 /* ignore */
 }
 return fall
}

function isGitDir(dir: string): boolean {
 return existsSync(join(dir, '.git'))
}

/** Folder name from git URL (owner/repo or repo.git). */
export function folderNameFromGitUrl(url: string): string {
 const raw = url.trim().replace(/[\\/]+$/, '')
 // git@host:org/repo.git or https://host/org/repo.git
 const m =
 raw.match(/[:/]([^/]+?)(?:\.git)?$/i) ||
 raw.match(/([^/\\]+?)(?:\.git)?$/i)
 let name = (m?.[1] || 'repo').replace(/\.git$/i, '')
 name = name.replace(/[<>:"|?*\x00-\x1f]/g, '-').trim() || 'repo'
 return name
}

function uniqueClonePath(parent: string, base: string): string {
 let dest = join(parent, base)
 if (!existsSync(dest)) return dest
 for (let i = 2; i < 100; i++) {
 dest = join(parent, `${base}-${i}`)
 if (!existsSync(dest)) return dest
 }
 return join(parent, `${base}-${Date.now()}`)
}

/**
 * Clone a remote repository and register it as a TrueDeck project.
 */
export async function cloneRepoAsProject(opts: {
 url: string
 parentDir?: string
 folderName?: string
}): Promise<{ project: ProjectConfig; path: string; cloned: boolean }> {
 const url = (opts.url || '').trim()
 if (!url) throw new Error('Repository URL required')
 if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url) && !/^ssh:\/\//i.test(url)) {
 // Allow local path "import" if they paste a path
 if (existsSync(url) && statSync(url).isDirectory()) {
 const suggested = suggestOnOpenCommands(url)
 const project = upsertProject(url, { onOpenCommands: suggested })
 return { project, path: url, cloned: false }
 }
 throw new Error('URL must be https://…, git@…, or an existing folder path')
 }

 const parent = opts.parentDir?.trim() || getDefaultCloneParent()
 mkdirSync(parent, { recursive: true })
 const base = (opts.folderName || folderNameFromGitUrl(url)).trim() || 'repo'
 const dest = uniqueClonePath(parent, base)

 try {
 await execFileAsync('git', ['clone', '--', url, dest], {
 windowsHide: true,
 timeout: 10 * 60 * 1000,
 maxBuffer: 8 * 1024 * 1024
 })
 } catch (e) {
 const msg = e instanceof Error ? e.message : String(e)
 throw new Error(`git clone failed: ${msg}`)
 }

 if (!existsSync(dest)) throw new Error('Clone finished but folder missing')
 const suggested = suggestOnOpenCommands(dest)
 const project = upsertProject(dest, { onOpenCommands: suggested })
 return { project, path: dest, cloned: true }
}

/**
 * Scan a parent directory for git repos (direct children with `.git`)
 * and register each as a project. Does not recurse deep.
 */
export function importReposFromFolder(parentDir: string): {
 imported: ProjectConfig[]
 skipped: string[]
} {
 if (!parentDir || !existsSync(parentDir)) {
 throw new Error('Folder not found')
 }
 const imported: ProjectConfig[] = []
 const skipped: string[] = []
 let entries: string[] = []
 try {
 entries = readdirSync(parentDir)
 } catch (e) {
 throw new Error(e instanceof Error ? e.message : String(e))
 }

 // Also allow importing the parent itself if it is a repo
 if (isGitDir(parentDir)) {
 const suggested = suggestOnOpenCommands(parentDir)
 imported.push(upsertProject(parentDir, { onOpenCommands: suggested }))
 }

 for (const name of entries) {
 if (name.startsWith('.')) continue
 const full = join(parentDir, name)
 try {
 if (!statSync(full).isDirectory()) continue
 } catch {
 skipped.push(name)
 continue
 }
 if (!isGitDir(full)) {
 skipped.push(name)
 continue
 }
 const suggested = suggestOnOpenCommands(full)
 imported.push(upsertProject(full, { onOpenCommands: suggested }))
 }

 return { imported, skipped }
}

/** Detect sensible defaults when adding a project */
export function suggestOnOpenCommands(root: string): ProjectOnOpenCommand[] {
 const cmds: ProjectOnOpenCommand[] = []
 if (existsSync(`${root}/default.project.json`) || existsSync(`${root}/dev.project.json`)) {
 cmds.push({
 id: 'rojo-serve',
 label: 'Rojo Serve',
 command: 'rojo serve',
 enabled: true
 })
 }
 if (existsSync(`${root}/package.json`)) {
 try {
 const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
 scripts?: Record<string, string>
 }
 if (pkg.scripts?.dev) {
 cmds.push({
 id: 'npm-dev',
 label: 'npm run dev',
 command: 'npm run dev',
 enabled: false
 })
 }
 } catch {
 // ignore
 }
 }
 return cmds
}
