import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const electronPath = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const port = Number(process.env.TRUDECK_DEMO_DEBUG_PORT || 9222)

if (!existsSync(electronPath)) throw new Error(`Electron was not found: ${electronPath}`)

spawn(electronPath, [`--remote-debugging-port=${port}`, root], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: false
}).unref()

console.log(`Opened TrueDeck for recording on debug port ${port}. Frame this window in FocuSee, then run npm run demo:playwright.`)
