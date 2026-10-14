/**
 * Electron entry for the Codex account switcher.
 * Paths come from the TrueDeck user-data dir. Token files stay inside each CODEX_HOME.
 */
import { homedir } from 'os'
import { join } from 'path'
import { getGlobalDataDir } from './paths'
import {
  addCodexAccount,
  addCodexWorkspace,
  codexLaunchContext,
  listCodexHomes,
  loadCodexAccounts,
  moveCodexWorkspace,
  removeCodexWorkspace,
  renameCodexProfile,
  setActiveCodexWorkspace,
  type CodexLaunchContext
} from './codex-account-store'
import type { CodexAccountsState } from '../shared/types'

function dataDir(): string {
  return getGlobalDataDir()
}

function defaultHome(): string {
  return join(homedir(), '.codex')
}

export function getCodexAccounts(): CodexAccountsState {
  return loadCodexAccounts(dataDir(), defaultHome())
}

export function setActiveCodexWorkspaceId(workspaceId: string): CodexAccountsState {
  return setActiveCodexWorkspace(dataDir(), defaultHome(), workspaceId)
}

export function createCodexAccount(label?: string): CodexAccountsState {
  return addCodexAccount(dataDir(), defaultHome(), label)
}

export function createCodexWorkspace(accountId: string, label?: string): CodexAccountsState {
  return addCodexWorkspace(dataDir(), defaultHome(), accountId, label)
}

export function renameCodex(patch: {
  accountId?: string
  workspaceId?: string
  label: string
}): CodexAccountsState {
  return renameCodexProfile(dataDir(), defaultHome(), patch)
}

export function moveCodexWorkspaceTo(workspaceId: string, toAccountId: string): CodexAccountsState {
  return moveCodexWorkspace(dataDir(), defaultHome(), workspaceId, toAccountId)
}

export function deleteCodexWorkspace(workspaceId: string): CodexAccountsState {
  return removeCodexWorkspace(dataDir(), defaultHome(), workspaceId)
}

export function codexHomes(): string[] {
  return listCodexHomes(dataDir(), defaultHome())
}

export function codexSpawnContext(opts: {
  agentId: string
  projectRoot: string
  workspaceId?: string | null
  fallback?: 'active' | 'builtin'
}): CodexLaunchContext {
  return codexLaunchContext(dataDir(), defaultHome(), opts)
}
