/**
 * One git worktree per task so parallel agents do not share a checkout.
 * Returns null when the folder is not a git repo or git cannot add the worktree.
 */
import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

function slug(agentId: string): string {
  return (
    agentId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'agent'
  )
}

export async function taskWorktree(
  projectRoot: string,
  agentId: string,
  taskKey: string
): Promise<{ path: string; branch: string } | null> {
  try {
    await execFileAsync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], {
      windowsHide: true,
      timeout: 8000
    })
  } catch {
    return null
  }

  const short = taskKey.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'task'
  const branch = `truedeck/${slug(agentId)}-${short}`
  const dir = join(projectRoot, '.truedeck', 'worktrees', `${slug(agentId)}-${short}`)
  mkdirSync(join(projectRoot, '.truedeck', 'worktrees'), { recursive: true })
  if (existsSync(dir)) return { path: dir, branch }

  try {
    await execFileAsync('git', ['-C', projectRoot, 'worktree', 'add', '-b', branch, dir, 'HEAD'], {
      windowsHide: true,
      timeout: 60000
    })
  } catch {
    try {
      await execFileAsync('git', ['-C', projectRoot, 'worktree', 'add', dir, branch], {
        windowsHide: true,
        timeout: 60000
      })
    } catch {
      return null
    }
  }
  return { path: dir, branch }
}
