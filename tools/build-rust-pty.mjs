/**
 * Build crates/truedeck-pty and copy the binary into resources/bin/.
 * Skips cleanly if cargo is not installed (node-pty fallback remains).
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'crates', 'truedeck-pty')
const isWin = process.platform === 'win32'
const exe = isWin ? 'truedeck-pty.exe' : 'truedeck-pty'

function findCargo() {
 const which = isWin ? 'where.exe' : 'which'
 const r = spawnSync(which, ['cargo'], { encoding: 'utf8', windowsHide: true })
 if (r.status === 0) {
 const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
 if (line) return line
 }
 // Common rustup locations
 const candidates = [
 join(homedir(), '.cargo', 'bin', isWin ? 'cargo.exe' : 'cargo'),
 join(process.env.USERPROFILE || '', '.cargo', 'bin', 'cargo.exe'),
 'C:\\Users\\' + (process.env.USERNAME || '') + '\\.cargo\\bin\\cargo.exe'
 ]
 for (const c of candidates) {
 if (c && existsSync(c)) return c
 }
 return null
}

const cargo = findCargo()
if (!cargo) {
 console.warn('[build:pty] cargo not found - skipping Rust PTY (will use node-pty).')
 console.warn(' Install: https://rustup.rs then run: npm run build:pty')
 process.exit(0)
}

console.log('[build:pty] building release with', cargo)
const build = spawnSync(cargo, ['build', '--release'], {
 cwd: crate,
 encoding: 'utf8',
 windowsHide: true,
 env: { ...process.env },
 stdio: 'inherit'
})
if (build.status !== 0) {
 console.error('[build:pty] cargo build failed - node-pty fallback will be used.')
 process.exit(0) // don't fail dist if rust build fails
}

const built = join(crate, 'target', 'release', exe)
if (!existsSync(built)) {
 console.error('[build:pty] binary missing after build:', built)
 process.exit(0)
}

const outDir = join(root, 'resources', 'bin')
mkdirSync(outDir, { recursive: true })
const dest = join(outDir, exe)
copyFileSync(built, dest)
console.log('[build:pty] copied →', dest)
