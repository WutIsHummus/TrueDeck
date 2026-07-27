import { spawn } from 'child_process'
import { loadAgents } from './agents'
import { resolveCommand } from './resolve'

/** Open a full Windows Terminal multi-pane grid (true multi-agent terminal UI). */
export function openWindowsTerminalGrid(project: string, agentIds?: string[]): void {
  if (process.platform !== 'win32') {
    console.error('Grid via Windows Terminal is Windows-only. Use attach mode (Enter) instead.')
    return
  }

  const agents = loadAgents().filter((a) => !agentIds || agentIds.includes(a.id))
  // Prefer coding agents first; include rojo if present
  const pick =
    agents.length > 0
      ? agents.filter((a) => ['grok', 'codex', 'claude', 'cursor', 'gemini', 'shell'].includes(a.id))
      : agents

  const list = pick.length ? pick : agents.slice(0, 4)
  if (!list.length) return

  const first = resolveCommand(list[0].id, list[0].command, list[0].args)
  const wtArgs: string[] = [
    '-d',
    project,
    '--title',
    'TrueDeck',
    'new-tab',
    '--title',
    list[0].name,
    'powershell',
    '-NoExit',
    '-Command',
    `& '${first.command}' ${first.args.map((a) => `'${a}'`).join(' ')}`.trim()
  ]

  for (let i = 1; i < list.length; i++) {
    const a = list[i]
    const r = resolveCommand(a.id, a.command, a.args)
    const split = i % 2 === 1 ? '-H' : '-V'
    const cmd = `& '${r.command}' ${r.args.map((x) => `'${x}'`).join(' ')}`.trim()
    wtArgs.push(
      ';',
      'split-pane',
      split,
      '-d',
      project,
      '--title',
      a.name,
      'powershell',
      '-NoExit',
      '-Command',
      cmd
    )
  }

  // Also rojo if Roblox project
  spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore' }).unref()
}
