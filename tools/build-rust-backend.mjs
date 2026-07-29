/**
 * Build crates/truedeck-backend → resources/bin/truedeck-backend(.exe)
 * Skips cleanly if cargo is missing (app uses TS + node-pty fallback).
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'crates', 'truedeck-backend')
const isWin = process.platform === 'win32'
const exe = isWin ? 'truedeck-backend.exe' : 'truedeck-backend'

function findCargo() {
 const which = isWin ? 'where.exe' : 'which'
 const r = spawnSync(which, ['cargo'], { encoding: 'utf8', windowsHide: true })
 if (r.status === 0) {
 const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
 if (line) return line
 }
 const candidates = [
 join(homedir(), '.cargo', 'bin', isWin ? 'cargo.exe' : 'cargo'),
 join(process.env.USERPROFILE || '', '.cargo', 'bin', 'cargo.exe')
 ]
 for (const c of candidates) {
 if (c && existsSync(c)) return c
 }
 return null
}

const cargo = findCargo()
if (!cargo) {
 console.warn('[build:backend] cargo not found - skipping (TS/node-pty fallback).')
 console.warn(' Install https://rustup.rs then: npm run build:backend')
 process.exit(0)
}

if (!existsSync(crate)) {
 console.error('[build:backend] crate missing:', crate)
 process.exit(0)
}

console.log('[build:backend] cargo build --release')
const build = spawnSync(cargo, ['build', '--release'], {
 cwd: crate,
 encoding: 'utf8',
 windowsHide: true,
 env: { ...process.env },
 stdio: 'inherit'
})
if (build.status !== 0) {
 console.error('[build:backend] failed - using fallback')
 process.exit(0)
}

const built = join(crate, 'target', 'release', exe)
if (!existsSync(built)) {
 console.error('[build:backend] binary missing:', built)
 process.exit(0)
}

const outDir = join(root, 'resources', 'bin')
mkdirSync(outDir, { recursive: true })
const dest = join(outDir, exe)
copyFileSync(built, dest)
console.log('[build:backend] →', dest)
