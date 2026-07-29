/**
 * Git review snapshot for Review panel.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { GitReviewFile, GitReviewSnapshot } from '../shared/types'

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
