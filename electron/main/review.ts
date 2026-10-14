/**
 * Git review snapshot for Review panel.
 */
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { GitActionResult, GitReviewFile, GitReviewSnapshot } from '../shared/types'

const execFileAsync = promisify(execFile)

export async function getGitReview(projectRoot: string): Promise<GitReviewSnapshot> {
  if (!projectRoot) {
    return {
      projectRoot: '',
      branch: null,
      files: [],
      diff: '',
      clean: true,
      error: 'No project'
    }
  }

  try {
    await execFileAsync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], {
      windowsHide: true,
      timeout: 8000
    })
  } catch {
    return {
      projectRoot,
      branch: null,
      files: [],
      diff: '',
      clean: true,
      error: 'Not a git repository'
    }
  }

  let branch: string | null = null
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectRoot, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' }
    )
    branch = (stdout || '').trim() || null
  } catch {
    branch = null
  }

  let statusOut = ''
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectRoot, 'status', '--porcelain', '-u'],
      { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    )
    statusOut = stdout || ''
  } catch (e) {
    return {
      projectRoot,
      branch,
      files: [],
      diff: '',
      clean: true,
      error: e instanceof Error ? e.message : String(e)
    }
  }

  const files: GitReviewFile[] = statusOut
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const st = line.slice(0, 2).trim() || '?'
      const path = line.slice(3).trim()
      return { path, status: st }
    })

  let diff = ''
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectRoot, 'diff', 'HEAD', '--', '.'],
      { windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    )
    diff = (stdout || '').slice(0, 200_000)
    if (!diff) {
      const untracked = files.filter((f) => f.status === '??' || f.status.includes('?'))
      if (untracked.length) {
        diff = untracked.map((f) => `--- untracked: ${f.path}`).join('\n')
      }
    }
  } catch {
    diff = ''
  }

  return {
    projectRoot,
    branch,
    files,
    diff,
    clean: files.length === 0
  }
}

function actionError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    const text = `${err.stderr || ''}\n${err.stdout || ''}`.trim()
    if (text) return text
    if (err.message) return err.message
  }
  return e instanceof Error ? e.message : String(e)
}

async function runGit(projectRoot: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('git', ['-C', projectRoot, ...args], {
    windowsHide: true,
    timeout: 60000,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
  return `${stdout || ''}${stderr || ''}`.trim()
}

export async function commitGitChanges(
  projectRoot: string,
  message: string
): Promise<GitActionResult> {
  const msg = message.trim()
  if (!msg) return { ok: false, output: 'Write a commit message first.' }
  if (msg.startsWith('-')) return { ok: false, output: 'Commit message cannot start with a dash.' }
  try {
    await runGit(projectRoot, ['add', '-A', '--', '.'])
    const output = await runGit(projectRoot, ['commit', '-m', msg])
    return { ok: true, output: output || 'Committed' }
  } catch (e) {
    return { ok: false, output: actionError(e) }
  }
}

export async function pushGitBranch(projectRoot: string): Promise<GitActionResult> {
  try {
    const output = await runGit(projectRoot, ['push', '-u', 'origin', 'HEAD'])
    return { ok: true, output: output || 'Pushed' }
  } catch (e) {
    return { ok: false, output: actionError(e) }
  }
}

export async function createGitPullRequest(
  projectRoot: string,
  title: string,
  body: string
): Promise<GitActionResult> {
  const t = title.trim()
  if (!t) return { ok: false, output: 'Write a title for the pull request.' }
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', t, '--body', body.trim() || t],
      {
        cwd: projectRoot,
        windowsHide: true,
        timeout: 60000,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024
      }
    )
    return { ok: true, output: `${stdout || ''}${stderr || ''}`.trim() || 'Pull request created' }
  } catch (e) {
    return { ok: false, output: actionError(e) }
  }
}

/** package.json script names for the project quick-action row. */
export function listNpmScripts(projectRoot: string): string[] {
  try {
    const path = join(projectRoot, 'package.json')
    if (!existsSync(path)) return []
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { scripts?: Record<string, unknown> }
    if (!raw.scripts || typeof raw.scripts !== 'object') return []
    return Object.keys(raw.scripts)
      .filter((name) => typeof raw.scripts?.[name] === 'string')
      .slice(0, 16)
  } catch {
    return []
  }
}
