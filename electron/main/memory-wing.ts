/**
 * MemPalace wing names must be unique per project *path*, not just folder name.
 * Otherwise C:\SPTS and C:\Users\…\SPTS both become wing "spts" and share memory.
 */
import { basename } from 'path'
import { createHash } from 'crypto'

/** Stable short id from absolute path (Windows-insensitive). */
function pathHash(projectRoot: string): string {
  const norm = projectRoot
    .replace(/\//g, '\\')
    .replace(/[\\/]+$/, '')
    .toLowerCase()
  return createHash('sha256').update(norm).digest('hex').slice(0, 8)
}

/**
 * Wing for MemPalace mine / wake-up / env.
 * Example: `spts-a1b2c3d4` for two different SPTS checkouts.
 */
export function wingName(projectRoot: string): string {
  const base =
    basename(projectRoot || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  if (!projectRoot) return base
  return `${base}-${pathHash(projectRoot)}`
}
