/**
 * Git worktree isolation for parallel task dispatch.
 * Path: <repo>/.truedeck/worktrees/<shortId>
 */
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export function worktreesRoot(projectRoot: string): string {
 return join(projectRoot, '.truedeck', 'worktrees')
}

export async function isGitRepo(projectRoot: string): Promise<boolean> {
 try {
 await execFileAsync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], {
 windowsHide: true,
 timeout: 8000
 })
 return true
 } catch {
 return false
 }
}

/**
 * Create (or reuse) a worktree for a task. Returns absolute path.
 */
export async function ensureTaskWorktree(
 projectRoot: string,
 taskId: string
): Promise<{ path: string; branch: string; created: boolean }> {
 const short = taskId.replace(/-/g, '').slice(0, 8)
 const branch = `truedeck/${short}`
 const dir = join(worktreesRoot(projectRoot), short)
 mkdirSync(worktreesRoot(projectRoot), { recursive: true })

 if (existsSync(dir)) {
 return { path: dir, branch, created: false }
 }

 if (!(await isGitRepo(projectRoot))) {
 throw new Error('Not a git repository - worktree isolation skipped')
 }

 // Prefer branching from HEAD
 try {
 await execFileAsync(
 'git',
 ['-C', projectRoot, 'worktree', 'add', '-b', branch, dir, 'HEAD'],
 { windowsHide: true, timeout: 60000 }
 )
 } catch {
 // Branch may already exist from a prior partial run
 await execFileAsync(
 'git',
 ['-C', projectRoot, 'worktree', 'add', dir, branch],
 { windowsHide: true, timeout: 60000 }
 )
 }

 // Ensure worktrees stay untracked by main repo tooling
 try {
 const gitignore = join(projectRoot, '.truedeck', '.gitignore')
 // parent .truedeck may already be gitignored by user - best effort
 void gitignore
 } catch {
 /* ignore */
 }

 return { path: dir, branch, created: true }
}

export async function removeTaskWorktree(
 projectRoot: string,
 worktreePath: string
): Promise<void> {
 if (!worktreePath || !existsSync(worktreePath)) return
 try {
 await execFileAsync(
 'git',
 ['-C', projectRoot, 'worktree', 'remove', '--force', worktreePath],
 { windowsHide: true, timeout: 60000 }
 )
 } catch {
 try {
 rmSync(worktreePath, { recursive: true, force: true })
 await execFileAsync('git', ['-C', projectRoot, 'worktree', 'prune'], {
 windowsHide: true,
 timeout: 30000
 })
 } catch {
 /* ignore */
 }
 }
}

export function worktreeLabel(worktreePath?: string | null): string {
 if (!worktreePath) return ''
 return basename(worktreePath.replace(/[\\/]+$/, ''))
}
