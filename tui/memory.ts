import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFileSync, spawn } from 'child_process'

export function repoMemoryDir(project: string): string {
  return join(project, '.memory')
}

export function globalMemoryDir(): string {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.config'))
  return join(base, 'truedeck', 'data', 'memory')
}

export function ensureFileMemory(project?: string): { repo?: string; global: string } {
  const global = globalMemoryDir()
  mkdirSync(join(global, 'context'), { recursive: true })
  if (!existsSync(join(global, 'INDEX.md'))) {
    writeFileSync(
      join(global, 'INDEX.md'),
      '# Global TrueMemory\n\nCross-project agent memory.\n',
      'utf8'
    )
  }
  let repo: string | undefined
  if (project) {
    repo = repoMemoryDir(project)
    mkdirSync(join(repo, 'context'), { recursive: true })
    if (!existsSync(join(repo, 'INDEX.md'))) {
      writeFileSync(
        join(repo, 'INDEX.md'),
        '# Repo TrueMemory\n\nProject-specific agent memory. Commit with the repo.\n',
        'utf8'
      )
    }
  }
  return { global, repo }
}

export function mempalaceStatus(): string {
  const cli = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'mempalace.exe' : 'mempalace')
  const palace = join(homedir(), '.mempalace', 'palace')
  if (!existsSync(cli)) return 'MemPalace: not installed (uv tool install mempalace)'
  try {
    execFileSync(cli, ['status', '--palace', palace], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return `MemPalace: native OK (${palace})`
  } catch {
    return `MemPalace: installed (${palace})`
  }
}

export function mineProject(project: string, wing?: string): void {
  const cli = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'mempalace.exe' : 'mempalace')
  const palace = join(homedir(), '.mempalace', 'palace')
  if (!existsSync(cli)) return
  const w = wing || project.split(/[/\\]/).filter(Boolean).pop() || 'project'
  const child = spawn(cli, ['mine', project, '--wing', w, '--palace', palace], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

export function detectOnOpen(project: string): { label: string; command: string }[] {
  const cmds: { label: string; command: string }[] = []
  if (
    existsSync(join(project, 'default.project.json')) ||
    existsSync(join(project, 'dev.project.json'))
  ) {
    cmds.push({ label: 'Rojo', command: 'rojo serve' })
  }
  if (existsSync(join(project, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      if (pkg.scripts?.dev) cmds.push({ label: 'npm-dev', command: 'npm run dev' })
    } catch {
      // ignore
    }
  }
  return cmds
}
