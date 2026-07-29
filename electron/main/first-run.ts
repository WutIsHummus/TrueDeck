import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getGlobalDataDir } from './paths'
import { upsertProject, listProjects, suggestOnOpenCommands } from './projects'
import type { ProjectConfig } from '../shared/types'

function flagPath(): string {
 return join(getGlobalDataDir(), 'first-run.json')
}

interface FirstRunState {
 completed: boolean
 seededProjects: string[]
 completedAt?: number
}

function loadState(): FirstRunState {
 try {
 if (existsSync(flagPath())) {
 return JSON.parse(readFileSync(flagPath(), 'utf8')) as FirstRunState
 }
 } catch {
 // ignore
 }
 return { completed: false, seededProjects: [] }
}

function saveState(state: FirstRunState): void {
 mkdirSync(getGlobalDataDir(), { recursive: true })
 writeFileSync(flagPath(), JSON.stringify(state, null, 2), 'utf8')
}

/** Candidate project folders to auto-add on first launch. */
function discoverCandidates(): string[] {
 const home = homedir()
 const candidates = [
 join(home, 'SPTS'),
 join(home, 'Documents', 'SPTS'),
 join(home, 'source', 'repos', 'SPTS'),
 join(home, 'dev', 'SPTS'),
 join(home, 'projects', 'SPTS'),
 // TrueDeck itself (useful for dogfooding)
 join(home, 'TrueDeck')
 ]
 return candidates.filter(
 (p) =>
 existsSync(p) &&
 (existsSync(join(p, '.git')) ||
 existsSync(join(p, 'default.project.json')) ||
 existsSync(join(p, 'package.json')) ||
 existsSync(join(p, 'CLAUDE.md')))
 )
}

/**
 * On first run (or when forced), seed known local projects with sensible
 * on-open commands. Safe to call every launch - only mutates once unless force.
 */
export function runFirstRunSeed(force = false): {
 seeded: ProjectConfig[]
 firstRun: boolean
} {
 const state = loadState()
 if (state.completed && !force) {
 return { seeded: [], firstRun: false }
 }

 const existing = new Set(listProjects().map((p) => p.root.toLowerCase()))
 const seeded: ProjectConfig[] = []

 for (const root of discoverCandidates()) {
 if (existing.has(root.toLowerCase())) continue
 // Prefer folders that look like real projects
 const hasMarker =
 existsSync(join(root, 'default.project.json')) ||
 existsSync(join(root, 'package.json')) ||
 existsSync(join(root, 'CLAUDE.md')) ||
 existsSync(join(root, '.memory'))
 if (!hasMarker && !existsSync(join(root, '.git'))) continue

 const onOpen = suggestOnOpenCommands(root)
 // SPTS / Rojo: default agent tabs lean coding agents
 const isRojo = existsSync(join(root, 'default.project.json'))
 const project = upsertProject(root, {
 onOpenCommands: onOpen,
 defaultAgents: []
 })
 seeded.push(project)
 existing.add(root.toLowerCase())
 }

 saveState({
 completed: true,
 seededProjects: [...(state.seededProjects || []), ...seeded.map((s) => s.root)],
 completedAt: Date.now()
 })

 return { seeded, firstRun: true }
}
