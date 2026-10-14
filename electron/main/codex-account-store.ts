/**
 * Switch Codex between ChatGPT accounts and workspaces.
 *
 * Codex CLI stores one login under CODEX_HOME (default ~/.codex).
 * Each workspace here gets its own home so signing into another account
 * does not log the others out. New Codex tabs use the active workspace.
 * A tab that is already running keeps the home it started with.
 */
import { execFileSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { profileLabel } from '../shared/codex-label'
import type {
  CodexAccountProfile,
  CodexAccountsState,
  CodexWorkspaceProfile
} from '../shared/types'

const SEED_CONFIG = `# TrueDeck Codex profile. Local to this account workspace.
approval_policy = "never"
sandbox_mode = "danger-full-access"

[windows]
sandbox = "elevated"

[notice]
hide_full_access_warning = true
`

export interface CodexIdentity {
  signedIn: boolean
  email?: string
  plan?: string
  accountId?: string
  workspaceTitle?: string
}

export function identityFromAuthJson(raw: string): CodexIdentity {
  try {
    const parsed = JSON.parse(raw) as {
      tokens?: { id_token?: unknown; account_id?: unknown }
      OPENAI_API_KEY?: unknown
    }
    const token = parsed.tokens?.id_token
    if (typeof token !== 'string' || !token.includes('.')) {
      if (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.trim()) {
        return { signedIn: true, workspaceTitle: 'API key' }
      }
      return { signedIn: false }
    }
    const payload = decodeJwtPayload(token)
    if (!payload) return { signedIn: false }
    const auth = asRecord(payload['https://api.openai.com/auth'])
    const orgs = Array.isArray(auth?.organizations) ? auth.organizations : []
    const org =
      orgs.map(asRecord).find((row) => row?.is_default === true) ||
      asRecord(orgs[0])
    const accountFromToken =
      typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : undefined
    const accountFromFile =
      typeof parsed.tokens?.account_id === 'string' ? parsed.tokens.account_id : undefined
    return {
      signedIn: true,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      plan: typeof auth?.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined,
      accountId: accountFromToken || accountFromFile,
      workspaceTitle: typeof org?.title === 'string' ? org.title : undefined
    }
  } catch {
    return { signedIn: false }
  }
}

export function defaultTrueDeckDataDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'truedeck', 'data')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'truedeck', 'data')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'truedeck', 'data')
}

export function readActiveCodexHome(dataDir: string): string | null {
  const file = accountsPath(dataDir)
  if (!existsSync(file)) return null
  try {
    const state = JSON.parse(readFileSync(file, 'utf8')) as CodexAccountsState
    for (const account of state.accounts || []) {
      for (const workspace of account.workspaces || []) {
        if (workspace.id === state.activeWorkspaceId && workspace.home) return workspace.home
      }
    }
  } catch {
    return null
  }
  return null
}

export function loadCodexAccounts(dataDir: string, defaultHome: string): CodexAccountsState {
  const file = accountsPath(dataDir)
  mkdirSync(dataDir, { recursive: true })
  let state: CodexAccountsState
  let previous = ''
  if (!existsSync(file)) {
    state = seedState(defaultHome, homesRoot(dataDir))
  } else {
    previous = readFileSync(file, 'utf8')
    state = parseState(previous, defaultHome, dataDir)
  }
  refreshIdentities(state)
  ensureHomes(state, defaultHome)
  const next = JSON.stringify(state, null, 2)
  if (next !== previous.trim()) writeFileSync(file, next + '\n', 'utf8')
  return state
}

export function setActiveCodexWorkspace(
  dataDir: string,
  defaultHome: string,
  workspaceId: string
): CodexAccountsState {
  const state = loadCodexAccounts(dataDir, defaultHome)
  if (!findWorkspace(state, workspaceId)) {
    throw new Error('That Codex workspace is not in the switcher.')
  }
  state.activeWorkspaceId = workspaceId
  writeState(dataDir, state)
  return state
}

export function addCodexAccount(
  dataDir: string,
  defaultHome: string,
  label?: string
): CodexAccountsState {
  const state = loadCodexAccounts(dataDir, defaultHome)
  const id = nextId('acct')
  const workspace = blankWorkspace(homesRoot(dataDir), label ? `${label} workspace` : 'Workspace')
  state.accounts.push({
    id,
    label: cleanLabel(label) || `Account ${state.accounts.length + 1}`,
    workspaces: [workspace]
  })
  ensureHomes(state, defaultHome)
  writeState(dataDir, state)
  return state
}

export function addCodexWorkspace(
  dataDir: string,
  defaultHome: string,
  accountId: string,
  label?: string
): CodexAccountsState {
  const state = loadCodexAccounts(dataDir, defaultHome)
  const account = state.accounts.find((row) => row.id === accountId)
  if (!account) throw new Error('That Codex account is not in the switcher.')
  account.workspaces.push(
    blankWorkspace(homesRoot(dataDir), cleanLabel(label) || `Workspace ${account.workspaces.length + 1}`)
  )
  ensureHomes(state, defaultHome)
  writeState(dataDir, state)
  return state
}

export function renameCodexProfile(
  dataDir: string,
  defaultHome: string,
  patch: { accountId?: string; workspaceId?: string; label: string }
): CodexAccountsState {
  const state = loadCodexAccounts(dataDir, defaultHome)
  const label = cleanLabel(patch.label)
  if (!label) throw new Error('Enter a name.')
  if (patch.workspaceId) {
    const hit = findWorkspace(state, patch.workspaceId)
    if (!hit) throw new Error('That Codex workspace is not in the switcher.')
    hit.workspace.label = label
    hit.workspace.labelLocked = true
  } else if (patch.accountId) {
    const account = state.accounts.find((row) => row.id === patch.accountId)
    if (!account) throw new Error('That Codex account is not in the switcher.')
    account.label = label
    account.labelLocked = true
  } else {
    throw new Error('Choose an account or workspace to rename.')
  }
  writeState(dataDir, state)
  return state
}

export function moveCodexWorkspace(
  dataDir: string,
  defaultHome: string,
  workspaceId: string,
  toAccountId: string
): CodexAccountsState {
  const state = loadCodexAccounts(dataDir, defaultHome)
  const from = findWorkspace(state, workspaceId)
  const to = state.accounts.find((row) => row.id === toAccountId)
  if (!from || !to) throw new Error('That Codex account or workspace is not in the switcher.')
  if (from.account.id === to.id) return state
  from.account.workspaces = from.account.workspaces.filter((row) => row.id !== workspaceId)
  to.workspaces.push(from.workspace)
  state.accounts = state.accounts.filter((row) => row.workspaces.length > 0)
  writeState(dataDir, state)
  return state
}

export function removeCodexWorkspace(
  dataDir: string,
  defaultHome: string,
  workspaceId: string
): CodexAccountsState {
  const state = loadCodexAccounts(dataDir, defaultHome)
  const hit = findWorkspace(state, workspaceId)
  if (!hit) throw new Error('That Codex workspace is not in the switcher.')
  if (hit.workspace.builtin) {
    throw new Error('The original Codex login stays on this PC. Add another workspace instead.')
  }
  const total = state.accounts.reduce((n, account) => n + account.workspaces.length, 0)
  if (total <= 1) throw new Error('Keep at least one Codex workspace.')
  hit.account.workspaces = hit.account.workspaces.filter((row) => row.id !== workspaceId)
  state.accounts = state.accounts.filter((row) => row.workspaces.length > 0)
  if (state.activeWorkspaceId === workspaceId) {
    state.activeWorkspaceId = state.accounts[0].workspaces[0].id
  }
  deleteManagedHome(dataDir, hit.workspace.home)
  writeState(dataDir, state)
  return state
}

export function listCodexHomes(dataDir: string, defaultHome: string): string[] {
  try {
    const state = loadCodexAccounts(dataDir, defaultHome)
    const homes = new Set<string>()
    for (const account of state.accounts) {
      for (const workspace of account.workspaces) homes.add(workspace.home)
    }
    if (!homes.size) homes.add(defaultHome)
    return [...homes]
  } catch {
    return [defaultHome]
  }
}

export interface CodexLaunchContext {
  env: Record<string, string>
  fields: { codexWorkspaceId?: string; codexLabel?: string }
  home: string | null
}

export function codexLaunchContext(
  dataDir: string,
  defaultHome: string,
  opts: {
    agentId: string
    projectRoot: string
    workspaceId?: string | null
    /** Tabs saved before the switcher existed belong to the original ~/.codex login. */
    fallback?: 'active' | 'builtin'
  }
): CodexLaunchContext {
  if (opts.agentId !== 'codex') return { env: {}, fields: {}, home: null }
  const state = loadCodexAccounts(dataDir, defaultHome)
  const builtin = findBuiltin(state)
  const picked =
    (opts.workspaceId && findWorkspace(state, opts.workspaceId)) ||
    (opts.fallback === 'builtin' && builtin) ||
    findWorkspace(state, state.activeWorkspaceId) ||
    builtin ||
    findWorkspace(state, state.accounts[0]?.workspaces[0]?.id || '')
  if (!picked) return { env: {}, fields: {}, home: null }
  ensureHomes(state, defaultHome)
  try {
    ensureCodexTrust(opts.projectRoot, picked.workspace.home)
  } catch {
    /* Codex can still ask on its own trust screen */
  }
  return {
    env: { CODEX_HOME: picked.workspace.home },
    fields: {
      codexWorkspaceId: picked.workspace.id,
      codexLabel: profileLabel(picked.account, picked.workspace)
    },
    home: picked.workspace.home
  }
}

function seedState(defaultHome: string, homes: string): CodexAccountsState {
  const identity = readIdentity(defaultHome)
  const primary: CodexWorkspaceProfile = {
    id: 'ws-default',
    label: identity.workspaceTitle || 'Workspace',
    home: defaultHome,
    builtin: true,
    signedIn: identity.signedIn,
    email: identity.email,
    plan: identity.plan,
    accountId: identity.accountId,
    workspaceTitle: identity.workspaceTitle
  }
  const second = blankWorkspace(homes, 'Second workspace', 'ws-default-2')
  const account2 = blankWorkspace(homes, 'Workspace', 'ws-account-2')
  const account3 = blankWorkspace(homes, 'Workspace', 'ws-account-3')
  return {
    version: 1,
    activeWorkspaceId: primary.id,
    accounts: [
      {
        id: 'acct-1',
        label: identity.email || 'Account 1',
        workspaces: [primary, second]
      },
      {
        id: 'acct-2',
        label: 'Account 2',
        workspaces: [account2]
      },
      {
        id: 'acct-3',
        label: 'Account 3',
        workspaces: [account3]
      }
    ]
  }
}

function blankWorkspace(homes: string, label: string, id = nextId('ws')): CodexWorkspaceProfile {
  return {
    id,
    label,
    home: join(homes, id),
    signedIn: false
  }
}

function parseState(raw: string, defaultHome: string, dataDir: string): CodexAccountsState {
  try {
    const parsed = JSON.parse(raw) as CodexAccountsState
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      return seedState(defaultHome, homesRoot(dataDir))
    }
    const accounts = parsed.accounts
      .map((account) => sanitizeAccount(account, dataDir))
      .filter((account): account is CodexAccountProfile => Boolean(account))
    if (!accounts.length) return seedState(defaultHome, homesRoot(dataDir))
    const known = new Set(accounts.flatMap((account) => account.workspaces.map((ws) => ws.id)))
    const active = known.has(parsed.activeWorkspaceId)
      ? parsed.activeWorkspaceId
      : accounts[0].workspaces[0].id
    return { version: 1, activeWorkspaceId: active, accounts }
  } catch {
    return seedState(defaultHome, homesRoot(dataDir))
  }
}

function sanitizeAccount(raw: CodexAccountProfile, dataDir: string): CodexAccountProfile | null {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.workspaces)) return null
  const workspaces = raw.workspaces
    .map((workspace) => sanitizeWorkspace(workspace, dataDir))
    .filter((workspace): workspace is CodexWorkspaceProfile => Boolean(workspace))
  if (!workspaces.length) return null
  return {
    id: raw.id,
    label: cleanLabel(raw.label) || 'Account',
    labelLocked: Boolean(raw.labelLocked),
    workspaces
  }
}

function sanitizeWorkspace(
  raw: CodexWorkspaceProfile,
  dataDir: string
): CodexWorkspaceProfile | null {
  if (!raw || typeof raw.id !== 'string') return null
  const home = fitCodexHome(
    dataDir,
    raw.id,
    typeof raw.home === 'string' && raw.home.trim() ? raw.home : join(homesRoot(dataDir), raw.id)
  )
  return {
    id: raw.id,
    label: cleanLabel(raw.label) || 'Workspace',
    labelLocked: Boolean(raw.labelLocked),
    home,
    builtin: Boolean(raw.builtin),
    signedIn: Boolean(raw.signedIn),
    email: typeof raw.email === 'string' ? raw.email : undefined,
    plan: typeof raw.plan === 'string' ? raw.plan : undefined,
    accountId: typeof raw.accountId === 'string' ? raw.accountId : undefined,
    workspaceTitle: typeof raw.workspaceTitle === 'string' ? raw.workspaceTitle : undefined
  }
}

function refreshIdentities(state: CodexAccountsState): void {
  for (const account of state.accounts) {
    for (const workspace of account.workspaces) {
      const identity = readIdentity(workspace.home)
      workspace.signedIn = identity.signedIn
      workspace.email = identity.email
      workspace.plan = identity.plan
      workspace.accountId = identity.accountId
      workspace.workspaceTitle = identity.workspaceTitle
      if (!workspace.labelLocked && identity.workspaceTitle) {
        workspace.label = identity.workspaceTitle
      }
    }
    if (account.labelLocked) continue
    const emails = [
      ...new Set(account.workspaces.map((ws) => ws.email).filter((email): email is string => Boolean(email)))
    ]
    if (emails.length === 1) account.label = emails[0]
  }
}

function readIdentity(home: string): CodexIdentity {
  const file = join(home, 'auth.json')
  if (!existsSync(file)) return { signedIn: false }
  try {
    return identityFromAuthJson(readFileSync(file, 'utf8'))
  } catch {
    return { signedIn: false }
  }
}

function ensureHomes(state: CodexAccountsState, defaultHome: string): void {
  for (const account of state.accounts) {
    for (const workspace of account.workspaces) {
      mkdirSync(workspace.home, { recursive: true })
      if (samePath(workspace.home, defaultHome)) continue
      const config = join(workspace.home, 'config.toml')
      if (!existsSync(config)) writeFileSync(config, SEED_CONFIG, 'utf8')
    }
  }
}

function ensureCodexTrust(cwd: string, codexHome: string): void {
  const file = join(codexHome, 'config.toml')
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
  const sepCh = current.endsWith('\n') || current.length === 0 ? '' : '\n'
  writeFileSync(file, `${current}${sepCh}\n${blocks.join('\n')}`, 'utf8')
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

function deleteManagedHome(dataDir: string, home: string): void {
  const target = resolve(home)
  const linked = junctionTarget(target)
  const real = linked ? resolve(linked) : target
  if (!managedCodexHome(dataDir, real) && !managedCodexHome(dataDir, target)) return
  const legacy = join(legacyHomesRoot(dataDir), basename(real))
  const legacyLink = junctionTarget(legacy)
  if (legacyLink && samePath(legacyLink, real)) rmSync(legacy, { force: true })
  if (linked) rmSync(real, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
}

function managedCodexHome(dataDir: string, home: string): boolean {
  const target = resolve(home).toLowerCase()
  for (const root of [homesRoot(dataDir), join(dataDir, 'codex-homes')]) {
    const prefix = resolve(root).toLowerCase()
    const withSep = prefix.endsWith(sep) ? prefix : prefix + sep
    if (target.startsWith(withSep)) return true
  }
  return false
}

function findBuiltin(
  state: CodexAccountsState
): { account: CodexAccountProfile; workspace: CodexWorkspaceProfile } | null {
  for (const account of state.accounts) {
    const workspace = account.workspaces.find((row) => row.builtin)
    if (workspace) return { account, workspace }
  }
  return null
}

function findWorkspace(
  state: CodexAccountsState,
  workspaceId: string
): { account: CodexAccountProfile; workspace: CodexWorkspaceProfile } | null {
  for (const account of state.accounts) {
    const workspace = account.workspaces.find((row) => row.id === workspaceId)
    if (workspace) return { account, workspace }
  }
  return null
}

function writeState(dataDir: string, state: CodexAccountsState): void {
  const file = accountsPath(dataDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function accountsPath(dataDir: string): string {
  return join(dataDir, 'codex-accounts.json')
}

/**
 * Windows AF_UNIX paths must be shorter than SUN_LEN (108). Codex appends
 * \app-server-control\app-server-control.sock to CODEX_HOME, then canonicalizes
 * it. A junction under ~/tdcx still resolves to %APPDATA%\...\codex-homes\...,
 * and that path is too long. The files themselves have to live at ~/tdcx.
 */
const CONTROL_SOCKET_TAIL = `${sep}app-server-control${sep}app-server-control.sock`
const UNIX_SOCKET_MAX = 107

function homesRoot(_dataDir: string): string {
  return join(homedir(), 'tdcx')
}

function legacyHomesRoot(dataDir: string): string {
  return join(dataDir, 'codex-homes')
}

function fitCodexHome(dataDir: string, id: string, home: string): string {
  if (socketByteLength(home) <= UNIX_SOCKET_MAX) return home
  const short = join(homesRoot(dataDir), id)
  mkdirSync(dirname(short), { recursive: true })
  materializeShortHome(dataDir, home, short)
  return short
}

function socketByteLength(home: string): number {
  return Buffer.byteLength(canonicalPath(home) + CONTROL_SOCKET_TAIL)
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function realDirFits(path: string): boolean {
  return existsSync(path) && !junctionTarget(path) && socketByteLength(path) <= UNIX_SOCKET_MAX
}

/**
 * Move a Codex home onto `short` so canonicalize() stays under SUN_LEN.
 * A junction the other way is not enough: Codex resolves it before bind.
 */
function materializeShortHome(dataDir: string, home: string, short: string): void {
  if (realDirFits(short)) return
  const link = junctionTarget(short)
  const source = link ? resolve(link) : canonicalPath(home)
  if (link && !samePath(source, canonicalPath(home)) && !samePath(resolve(home), short)) return
  if (samePath(source, short)) {
    if (!existsSync(short)) mkdirSync(short, { recursive: true })
    return
  }
  if (!existsSync(source)) {
    if (!existsSync(short)) mkdirSync(short, { recursive: true })
    return
  }

  const stamp = `${short}.moving-${Date.now().toString(36)}`
  const backlink = isLegacyHome(dataDir, source)
  renameSync(source, stamp)
  try {
    if (link) rmSync(short, { force: true })
    if (existsSync(short)) {
      renameSync(stamp, source)
      return
    }
    renameSync(stamp, short)
  } catch (error) {
    if (!existsSync(source) && existsSync(stamp)) {
      try {
        renameSync(stamp, source)
      } catch {
        /* stamp keeps the files if the move back fails */
      }
    }
    throw error
  }
  if (backlink && !existsSync(source)) {
    mkdirSync(dirname(source), { recursive: true })
    symlinkSync(short, source, 'junction')
  }
}

function isLegacyHome(dataDir: string, home: string): boolean {
  const target = resolve(home).toLowerCase()
  const prefix = resolve(legacyHomesRoot(dataDir)).toLowerCase()
  const withSep = prefix.endsWith(sep) ? prefix : prefix + sep
  return target.startsWith(withSep)
}

function junctionTarget(path: string): string | null {
  try {
    if (!lstatSync(path).isSymbolicLink()) return null
    return readlinkSync(path)
  } catch {
    return null
  }
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function cleanLabel(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function samePath(a: string, b: string): boolean {
  return resolve(a).replace(/[\\/]+$/, '').toLowerCase() === resolve(b).replace(/[\\/]+$/, '').toLowerCase()
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  const pad = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4)
  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
