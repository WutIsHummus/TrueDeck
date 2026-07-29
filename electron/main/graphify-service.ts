/**
 * Graphify integration - lifecycle + sync for project knowledge graphs.
 * Does not reimplement extraction; shells out to graphifyy / `graphify` CLI.
 */
import {
 existsSync,
 mkdirSync,
 readFileSync,
 writeFileSync,
 statSync
} from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { spawn, execFileSync, type ChildProcess } from 'child_process'

export interface GraphifyStatus {
 projectRoot: string
 available: boolean
 ready: boolean
 stale: boolean
 building: boolean
 lastSyncAt: number | null
 nodeCount?: number
 edgeCount?: number
 error?: string
 graphJsonPath?: string
 reportPath?: string
 htmlPath?: string
 detail: string
}

const building = new Map<string, ChildProcess>()
const lastSync = new Map<string, number>()
const lastError = new Map<string, string>()

function normRoot(root: string): string {
 return root.replace(/[\\/]+$/, '').toLowerCase()
}

export function graphifyOutDir(projectRoot: string): string {
 return join(projectRoot, 'graphify-out')
}

export function graphJsonPath(projectRoot: string): string {
 return join(graphifyOutDir(projectRoot), 'graph.json')
}

export function graphReportPath(projectRoot: string): string {
 return join(graphifyOutDir(projectRoot), 'GRAPH_REPORT.md')
}

export function graphHtmlPath(projectRoot: string): string {
 return join(graphifyOutDir(projectRoot), 'graph.html')
}

/** Resolve a Python that can `import graphify`, or a graphify CLI on PATH. */
export function resolveGraphifyRunner(): {
 kind: 'cli' | 'python' | 'missing'
 command: string
 argsPrefix: string[]
 detail: string
} {
 const isWin = process.platform === 'win32'
 // 1) graphify on PATH
 try {
 const which = isWin ? 'where.exe' : 'which'
 const out = execFileSync(which, ['graphify'], {
 encoding: 'utf8',
 windowsHide: true,
 timeout: 4000
 })
 const line = out
 .split(/\r?\n/)
 .map((l) => l.trim())
 .find(Boolean)
 if (line && existsSync(line)) {
 return { kind: 'cli', command: line, argsPrefix: [], detail: `cli:${line}` }
 }
 } catch {
 // continue
 }

 // 2) uv tool python for graphifyy
 const uvCandidates = [
 join(homedir(), '.local', 'share', 'uv', 'tools', 'graphifyy', 'Scripts', 'python.exe'),
 join(homedir(), '.local', 'share', 'uv', 'tools', 'graphifyy', 'bin', 'python')
 ]
 for (const py of uvCandidates) {
 if (existsSync(py) && canImportGraphify(py)) {
 return {
 kind: 'python',
 command: py,
 argsPrefix: ['-m', 'graphify'],
 detail: `python:${py}`
 }
 }
 }

 // 3) bare python / python3
 for (const cmd of isWin ? ['python', 'py'] : ['python3', 'python']) {
 try {
 const pyCmd = cmd === 'py' ? 'py' : cmd
 const checkArgs =
 cmd === 'py' ? ['-3', '-c', 'import graphify; print("ok")'] : ['-c', 'import graphify; print("ok")']
 const out = execFileSync(pyCmd, checkArgs, {
 encoding: 'utf8',
 windowsHide: true,
 timeout: 8000
 })
 if (String(out).includes('ok')) {
 const prefix = cmd === 'py' ? ['-3', '-m', 'graphify'] : ['-m', 'graphify']
 return {
 kind: 'python',
 command: pyCmd,
 argsPrefix: prefix,
 detail: `python:${pyCmd}`
 }
 }
 } catch {
 // try next
 }
 }

 return {
 kind: 'missing',
 command: '',
 argsPrefix: [],
 detail: 'graphify not found (install: pip install graphifyy or uv tool install graphifyy)'
 }
}

function canImportGraphify(pythonPath: string): boolean {
 try {
 const out = execFileSync(pythonPath, ['-c', 'import graphify; print("ok")'], {
 encoding: 'utf8',
 windowsHide: true,
 timeout: 8000
 })
 return String(out).includes('ok')
 } catch {
 return false
 }
}

function readGraphCounts(projectRoot: string): { nodes?: number; edges?: number; mtime?: number } {
 const p = graphJsonPath(projectRoot)
 if (!existsSync(p)) return {}
 try {
 const st = statSync(p)
 const raw = JSON.parse(readFileSync(p, 'utf8')) as {
 nodes?: unknown[]
 edges?: unknown[]
 graph?: { nodes?: unknown[]; edges?: unknown[] }
 }
 const nodes = Array.isArray(raw.nodes)
 ? raw.nodes.length
 : Array.isArray(raw.graph?.nodes)
 ? raw.graph!.nodes!.length
 : undefined
 const edges = Array.isArray(raw.edges)
 ? raw.edges.length
 : Array.isArray(raw.graph?.edges)
 ? raw.graph!.edges!.length
 : undefined
 return { nodes, edges, mtime: st.mtimeMs }
 } catch {
 try {
 return { mtime: statSync(p).mtimeMs }
 } catch {
 return {}
 }
 }
}

/** Heuristic: graph older than newest .ts/.tsx/.md under root (shallow sample). */
function isStale(projectRoot: string, graphMtime?: number): boolean {
 if (!graphMtime) return true
 // If we synced recently in-process, not stale
 const ls = lastSync.get(normRoot(projectRoot))
 if (ls && Date.now() - ls < 60_000) return false
 // Cheap: compare to package.json / src mtime if present
 for (const rel of ['package.json', 'src', 'electron', 'README.md']) {
 const full = join(projectRoot, rel)
 try {
 if (existsSync(full) && statSync(full).mtimeMs > graphMtime + 2000) return true
 } catch {
 // ignore
 }
 }
 return false
}

export function getGraphifyStatus(projectRoot: string | null | undefined): GraphifyStatus {
 if (!projectRoot || !existsSync(projectRoot)) {
 return {
 projectRoot: projectRoot || '',
 available: false,
 ready: false,
 stale: false,
 building: false,
 lastSyncAt: null,
 detail: 'No project open'
 }
 }
 const runner = resolveGraphifyRunner()
 const key = normRoot(projectRoot)
 const gpath = graphJsonPath(projectRoot)
 const counts = readGraphCounts(projectRoot)
 const ready = existsSync(gpath)
 const buildingNow = building.has(key)
 return {
 projectRoot,
 available: runner.kind !== 'missing',
 ready,
 stale: ready ? isStale(projectRoot, counts.mtime) : false,
 building: buildingNow,
 lastSyncAt: lastSync.get(key) ?? counts.mtime ?? null,
 nodeCount: counts.nodes,
 edgeCount: counts.edges,
 error: lastError.get(key),
 graphJsonPath: ready ? gpath : undefined,
 reportPath: existsSync(graphReportPath(projectRoot)) ? graphReportPath(projectRoot) : undefined,
 htmlPath: existsSync(graphHtmlPath(projectRoot)) ? graphHtmlPath(projectRoot) : undefined,
 detail:
 runner.kind === 'missing'
 ? runner.detail
 : buildingNow
 ? 'Building knowledge graph…'
 : ready
 ? `Graph ready (${counts.nodes ?? '?'} nodes)${isStale(projectRoot, counts.mtime) ? ' · stale' : ''}`
 : 'No graph yet - run Sync graph'
 }
}

export function graphifyEnv(projectRoot: string): Record<string, string> {
 const out = graphifyOutDir(projectRoot)
 const env: Record<string, string> = {
 TRUEDECK_GRAPHIFY_DIR: out
 }
 if (existsSync(graphJsonPath(projectRoot))) {
 env.TRUEDECK_GRAPHIFY_JSON = graphJsonPath(projectRoot)
 }
 if (existsSync(graphReportPath(projectRoot))) {
 env.TRUEDECK_GRAPHIFY_REPORT = graphReportPath(projectRoot)
 }
 return env
}

export function graphifyAutoContextSection(projectRoot: string): string[] {
 const st = getGraphifyStatus(projectRoot)
 const lines = ['## Knowledge graph (Graphify)', '']
 if (!st.available) {
 lines.push(
 'Code knowledge graph not available on this machine yet (optional). TrueDeck will use it automatically when installed.',
 ''
 )
 return lines
 }
 if (!st.ready) {
 lines.push(
 'Project graph is building or not ready yet. TrueDeck refreshes it automatically in the background.',
 ''
 )
 return lines
 }
 lines.push(`- Graph: \`${st.graphJsonPath}\``)
 if (st.reportPath) lines.push(`- Report: \`${st.reportPath}\``)
 if (st.nodeCount != null) lines.push(`- Nodes: ${st.nodeCount}${st.edgeCount != null ? ` · edges: ${st.edgeCount}` : ''}`)
 if (st.stale) lines.push('- Status: **stale** (code may have changed since last sync)')
 lines.push(
 '',
 'Use the graph for architecture questions (what calls X, how modules connect). Prefer `graphify query` / TrueDeck hub graph tools when available.',
 ''
 )
 // Short report head
 if (st.reportPath && existsSync(st.reportPath)) {
 try {
 const head = readFileSync(st.reportPath, 'utf8').slice(0, 1200).trim()
 if (head) {
 lines.push('### Report excerpt', '', '```', head, '```', '')
 }
 } catch {
 // ignore
 }
 }
 return lines
}

export type GraphifySyncMode = 'full' | 'update'

/**
 * Run graphify build or incremental update for a project.
 * Non-blocking spawn; status flips via building map.
 */
export async function syncGraphify(
 projectRoot: string,
 mode: GraphifySyncMode = 'update'
): Promise<GraphifyStatus> {
 if (!projectRoot || !existsSync(projectRoot)) {
 throw new Error('Project path missing')
 }
 const key = normRoot(projectRoot)
 if (building.has(key)) {
 return getGraphifyStatus(projectRoot)
 }

 const runner = resolveGraphifyRunner()
 if (runner.kind === 'missing') {
 lastError.set(key, runner.detail)
 return getGraphifyStatus(projectRoot)
 }

 mkdirSync(graphifyOutDir(projectRoot), { recursive: true })
 const hasGraph = existsSync(graphJsonPath(projectRoot))
 const effective: GraphifySyncMode = mode === 'update' && !hasGraph ? 'full' : mode

 // Prefer CLI: `graphify .` or `graphify . --update`
 // Python module: `python -m graphify` may not exist - try `graphify` entry via -c script
 const args: string[] =
 runner.kind === 'cli'
 ? effective === 'update'
 ? ['.', '--update']
 : ['.', '--no-viz']
 : effective === 'update'
 ? [...runner.argsPrefix, '.', '--update']
 : [...runner.argsPrefix, '.', '--no-viz']

 // Many installs expose only `graphify` script; python -m graphify can fail.
 // Fallback: run structural-only tip via writing a marker and using CLI path.
 return new Promise((resolve) => {
 let settled = false
 const finish = (): void => {
 if (settled) return
 settled = true
 building.delete(key)
 resolve(getGraphifyStatus(projectRoot))
 }

 try {
 const child = spawn(runner.command, args, {
 cwd: projectRoot,
 windowsHide: true,
 stdio: ['ignore', 'pipe', 'pipe'],
 env: { ...process.env, PYTHONUTF8: '1' }
 })
 building.set(key, child)
 let errBuf = ''
 child.stderr?.on('data', (d) => {
 errBuf += String(d)
 if (errBuf.length > 4000) errBuf = errBuf.slice(-4000)
 })
 child.stdout?.on('data', () => {
 // drain
 })
 child.on('error', (e) => {
 lastError.set(key, e.message)
 finish()
 })
 child.on('close', (code) => {
 if (code === 0 || existsSync(graphJsonPath(projectRoot))) {
 lastSync.set(key, Date.now())
 lastError.delete(key)
 // Touch a small status file for auto-context
 try {
 writeFileSync(
 join(graphifyOutDir(projectRoot), '.truedeck-sync.json'),
 JSON.stringify(
 {
 at: Date.now(),
 mode: effective,
 exitCode: code,
 runner: runner.detail
 },
 null,
 2
 ),
 'utf8'
 )
 } catch {
 // ignore
 }
 } else {
 lastError.set(
 key,
 errBuf.trim() ||
 `graphify exited ${code}. Try: pip install graphifyy && graphify .`
 )
 }
 finish()
 })
 // Safety timeout 10 min
 setTimeout(() => {
 if (building.get(key) === child) {
 try {
 child.kill()
 } catch {
 // ignore
 }
 lastError.set(key, 'graphify timed out')
 finish()
 }
 }, 10 * 60 * 1000)
 } catch (e) {
 lastError.set(key, e instanceof Error ? e.message : String(e))
 finish()
 }
 })
}

/**
 * Fully automatic - no user toggles.
 * - Missing graph → background full build (if graphify installed)
 * - Existing graph → background update when stale
 * Failures stay silent in status; agents still get env when ready.
 */
/** Best-effort background sync (never throws). */
export function scheduleGraphifySync(
 projectRoot: string,
 mode: GraphifySyncMode = 'update'
): void {
 if (!projectRoot || resolveGraphifyRunner().kind === 'missing') return
 void syncGraphify(projectRoot, mode).catch(() => {
 // ignore
 })
}

/** On project open: keep graph warm under the hood (never blocks UI). */
export async function onProjectOpenGraphify(projectRoot: string): Promise<GraphifyStatus> {
 if (resolveGraphifyRunner().kind === 'missing') {
 return getGraphifyStatus(projectRoot)
 }
 const has = existsSync(graphJsonPath(projectRoot))
 if (!has) {
 scheduleGraphifySync(projectRoot, 'full')
 return getGraphifyStatus(projectRoot)
 }
 // Stale or not - cheap update in background; dedupe via `building` map
 scheduleGraphifySync(projectRoot, 'update')
 return getGraphifyStatus(projectRoot)
}
