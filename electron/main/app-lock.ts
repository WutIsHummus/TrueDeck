/**
 * Live-app lock so truedeck-hub MCP only connects while TrueDeck is open.
 * MCP reads the same path under the shared data dir.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { getGlobalDataDir } from './paths'

export function appLockPath(): string {
  return join(getGlobalDataDir(), 'app.lock')
}

export function writeAppLock(): void {
  const p = appLockPath()
  mkdirSync(dirname(p), { recursive: true })
  const body = {
    pid: process.pid,
    startedAt: Date.now(),
    version: process.env.npm_package_version || undefined
  }
  writeFileSync(p, JSON.stringify(body, null, 2) + '\n', 'utf8')
}

export function clearAppLock(): void {
  const p = appLockPath()
  try {
    if (!existsSync(p)) return
    // Only remove if we own it (same pid)
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { pid?: number }
      if (raw.pid != null && raw.pid !== process.pid) return
    } catch {
      /* remove anyway on quit best-effort */
    }
    unlinkSync(p)
  } catch {
    /* ignore */
  }
}
