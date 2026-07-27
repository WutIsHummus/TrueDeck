import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'

export function getGlobalDataDir(): string {
  return join(app.getPath('userData'), 'data')
}

export function getGlobalMemoryDir(): string {
  return join(getGlobalDataDir(), 'memory')
}

export function getProjectsStorePath(): string {
  return join(getGlobalDataDir(), 'projects.json')
}

export function getSettingsPath(): string {
  return join(getGlobalDataDir(), 'settings.json')
}

export function getAgentsConfigPath(): string {
  return join(getGlobalDataDir(), 'agents.json')
}

export function getRepoMemoryDir(projectRoot: string): string {
  return join(projectRoot, '.memory')
}

export function getHomeTrueDeckDir(): string {
  return join(homedir(), '.truedeck')
}
