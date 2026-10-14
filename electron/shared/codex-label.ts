import type { CodexAccountProfile, CodexWorkspaceProfile } from './types'

/** Tab and title-bar label. Emails show the part before @. */
export function profileLabel(account: CodexAccountProfile, workspace: CodexWorkspaceProfile): string {
  const ws = workspace.label.trim() || 'Workspace'
  const short = shortName(account.label)
  if (account.workspaces.length > 1) return `${short} · ${ws}`
  return short || ws
}

function shortName(label: string): string {
  const text = label.trim()
  if (!text) return 'Codex'
  const at = text.indexOf('@')
  const short = at > 0 ? text.slice(0, at) : text
  return short.length > 22 ? `${short.slice(0, 21)}…` : short
}
