import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, basename } from 'path'
import { getProjectsStorePath } from './paths'
import type { ProjectConfig, ProjectOnOpenCommand } from '../shared/types'
import { ensureRepoMemory } from './memory'

function loadAll(): ProjectConfig[] {
  const path = getProjectsStorePath()
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8')) as ProjectConfig[]
    }
  } catch {
    // ignore
  }
  return []
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
  const existing = projects.find((p) => p.root === root)
  const next: ProjectConfig = {
    id: existing?.id || Buffer.from(root).toString('base64url').slice(0, 16),
    name: patch?.name || existing?.name || basename(root),
    root,
    lastOpened: Date.now(),
    onOpenCommands: patch?.onOpenCommands ?? existing?.onOpenCommands ?? [],
    defaultAgents: patch?.defaultAgents ?? existing?.defaultAgents ?? ['shell'],
    color: patch?.color ?? existing?.color
  }
  const filtered = projects.filter((p) => p.root !== root)
  filtered.push(next)
  saveAll(filtered)
  ensureRepoMemory(root)
  return next
}

export function removeProject(id: string): void {
  saveAll(loadAll().filter((p) => p.id !== id))
}

export function getProject(id: string): ProjectConfig | undefined {
  return loadAll().find((p) => p.id === id)
}

export function setOnOpenCommands(id: string, commands: ProjectOnOpenCommand[]): ProjectConfig | undefined {
  const projects = loadAll()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx < 0) return undefined
  projects[idx] = { ...projects[idx], onOpenCommands: commands }
  saveAll(projects)
  return projects[idx]
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
  // generic package.json scripts are left for the user to enable
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
