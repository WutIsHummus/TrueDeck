/**
 * Codex stops on a folder-trust screen until the project is marked trusted.
 * The interactive "Trust and continue" choice writes this same config entry.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { homedir } from 'os'

function codexKey(dir: string): string {
  return resolve(dir).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function gitText(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

function trustPaths(cwd: string): string[] {
  const keys = new Set<string>([codexKey(cwd)])
  const top = gitText(cwd, ['rev-parse', '--show-toplevel'])
  if (top) keys.add(codexKey(top))
  const common = gitText(cwd, ['rev-parse', '--git-common-dir'])
  if (common) {
    const abs = isAbsolute(common) ? common : resolve(cwd, common)
    keys.add(codexKey(dirname(abs)))
  }
  return [...keys]
}

export function ensureCodexTrust(cwd: string, codexHome?: string): void {
  const file = join(codexHome || join(homedir(), '.codex'), 'config.toml')
  mkdirSync(dirname(file), { recursive: true })
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lower = current.toLowerCase()
  const blocks: string[] = []
  for (const key of trustPaths(cwd)) {
    const header = `[projects.'${key.replace(/'/g, '')}']`
    if (lower.includes(header.toLowerCase())) continue
    blocks.push(`${header}\ntrust_level = "trusted"\n`)
  }
  if (!blocks.length) return
  const sep = current.endsWith('\n') || current.length === 0 ? '' : '\n'
  writeFileSync(file, `${current}${sep}\n${blocks.join('\n')}`, 'utf8')
}
