import { useMemo, useState } from 'react'
import type { AgentPreset, AgentProbe, SessionInfo } from '../../electron/shared/types'
import { canTakeTask, type AgentPhase } from '../lib/agent-phase'
import {
  markAgentWorking,
  readAgentPhase,
  taskKeystrokes,
  useAgentRevision
} from '../lib/agent-activity'
import { sameProjectRoot } from '../lib/paths'
import { useDeck } from '../store'

interface Props {
  projectRoot: string | null
  agents: AgentPreset[]
  probes: Record<string, AgentProbe>
  onClose: () => void
}

type Mode = 'swarm' | 'one'

function phaseWord(phase: AgentPhase): string {
  if (phase === 'working') return 'working'
  if (phase === 'waiting') return 'waiting'
  if (phase === 'done') return 'stopped'
  return 'idle'
}

/**
 * Assign one brief to a swarm, or to a single agent that is not waiting and not mid-turn.
 * A free open terminal receives the text. An agent with no terminal is started.
 */
export function AssignTaskForm({ projectRoot, agents, probes, onClose }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>('swarm')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [oneTarget, setOneTarget] = useState('')
  const revision = useAgentRevision()
  const sessions = useDeck((s) => s.sessions)
  const setStatus = useDeck((s) => s.setStatus)
  const patchSession = useDeck((s) => s.patchSession)

  const installed = useMemo(
    () =>
      agents.filter((a) => {
        if (a.id === 'shell' || a.id === 't3') return false
        return probes[a.id]?.available === true
      }),
    [agents, probes]
  )

  const live = useMemo(() => {
    if (!projectRoot) return [] as SessionInfo[]
    return sessions.filter((s) => {
      if (s.status !== 'running') return false
      if (!sameProjectRoot(s.projectRoot, projectRoot)) return false
      if (s.kind === 'document' || s.kind === 'command' || s.kind === 'web') return false
      if (!s.agentId || s.agentId === 'shell' || s.agentId === 't3' || s.agentId === 'document') {
        return false
      }
      return true
    })
  }, [projectRoot, revision, sessions])

  const swarmIds = picked ?? installed.map((a) => a.id)

  const oneOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string; disabled: boolean }> = []
    for (const s of live) {
      const phase = readAgentPhase(s.id)
      const free = canTakeTask(phase)
      const lane = s.worktreeLabel ? ` · ${s.worktreeLabel}` : ''
      opts.push({
        id: `session:${s.id}`,
        label: `${s.agentName || s.agentId}${lane} · ${phaseWord(phase)}`,
        disabled: !free
      })
    }
    for (const a of installed) {
      if (live.some((s) => s.agentId === a.id)) continue
      opts.push({ id: `new:${a.id}`, label: `New ${a.name}`, disabled: false })
    }
    return opts
  }, [installed, live])

  const chosenOne = oneOptions.some((o) => o.id === oneTarget && !o.disabled)
    ? oneTarget
    : oneOptions.find((o) => !o.disabled)?.id || ''

  const toggle = (id: string): void => {
    const cur = new Set(swarmIds)
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    setPicked(Array.from(cur))
  }

  const submit = async (): Promise<void> => {
    if (!projectRoot) {
      setStatus('Pick a project first (Ctrl+O)')
      return
    }
    const brief = text.trim()
    if (!brief || busy) return
    const nl = brief.indexOf('\n')
    const title = (nl === -1 ? brief : brief.slice(0, nl)).trim().slice(0, 140)
    const body = nl === -1 ? '' : brief.slice(nl + 1).trim()
    const targets = mode === 'swarm' ? swarmIds : chosenOne ? [chosenOne] : []
    if (!targets.length) {
      setStatus('Pick an agent that is not waiting')
      return
    }

    setBusy(true)
    onClose()
    const injected: string[] = []
    const spawnIds: string[] = []
    const skipped: string[] = []

    try {
      if (mode === 'one' && chosenOne.startsWith('session:')) {
        const id = chosenOne.slice('session:'.length)
        const session = live.find((s) => s.id === id)
        const phase = session ? readAgentPhase(session.id) : 'working'
        if (!session || !canTakeTask(phase)) {
          setStatus(
            phase === 'waiting'
              ? 'That agent is waiting on you'
              : 'That agent is still working'
          )
          return
        }
        await window.truedeck.writeSession(session.id, taskKeystrokes(brief))
        markAgentWorking(session.id, session.agentId)
        patchSession(session.id, {
          focusTitle: title.slice(0, 80),
          focusIdea: (body || title).slice(0, 160)
        })
        setText('')
        setStatus(`Assigned to ${session.agentName || session.agentId}`)
        return
      }

      if (mode === 'one' && chosenOne.startsWith('new:')) {
        const agentId = chosenOne.slice('new:'.length)
        const created = (await window.truedeck.createTask({
          projectRoot,
          title,
          body,
          status: 'ready',
          assigneeAgentId: agentId
        })) as { id: string }
        await window.truedeck.dispatchTask(created.id, agentId)
        setText('')
        setStatus(`Assigned to a new ${agentId} terminal`)
        return
      }

      for (const agentId of targets) {
        const agent = installed.find((a) => a.id === agentId)
        const name = agent?.name || agentId
        const mine = live.filter((s) => s.agentId === agentId)
        const free = mine.find((s) => canTakeTask(readAgentPhase(s.id)))
        if (free) {
          await window.truedeck.writeSession(free.id, taskKeystrokes(brief))
          markAgentWorking(free.id, free.agentId)
          patchSession(free.id, {
            focusTitle: title.slice(0, 80),
            focusIdea: (body || title).slice(0, 160)
          })
          injected.push(name)
          continue
        }
        if (mine.length) {
          const phase = readAgentPhase(mine[0].id)
          skipped.push(`${name} ${phaseWord(phase)}`)
          continue
        }
        spawnIds.push(agentId)
      }

      let opened: string[] = []
      if (spawnIds.length) {
        try {
          const result = await window.truedeck.fanoutTask({
            projectRoot,
            title,
            body,
            agentIds: spawnIds
          })
          opened = result.lanes.filter((l) => l.sessionId).map((l) => l.agentName || l.agentId)
          for (const lane of result.lanes) {
            if (lane.error) skipped.push(`${lane.agentName || lane.agentId}: ${lane.error}`)
          }
        } catch (e) {
          skipped.push(e instanceof Error ? e.message : String(e))
        }
      }

      if (!injected.length && !opened.length) {
        setStatus(skipped.length ? `Nothing assigned · ${skipped.join(', ')}` : 'Nothing assigned')
        return
      }
      const parts = [
        injected.length ? `sent to ${injected.join(', ')}` : '',
        opened.length ? `opened ${opened.join(', ')}` : ''
      ].filter(Boolean)
      setText('')
      setStatus(
        `Swarm · ${parts.join(' · ')}${skipped.length ? ` · skipped ${skipped.join(', ')}` : ''}`
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="palette-fanout"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="palette-assign-modes" role="group" aria-label="Who gets the task">
        <button
          type="button"
          className={mode === 'swarm' ? 'on' : ''}
          onClick={() => setMode('swarm')}
        >
          Swarm
        </button>
        <button
          type="button"
          className={mode === 'one' ? 'on' : ''}
          onClick={() => setMode('one')}
        >
          One agent
        </button>
      </div>
      <label className="palette-fanout-label" htmlFor="palette-fanout-input">
        {mode === 'swarm' ? 'Assign to a swarm' : 'Assign to one agent that is not waiting'}
      </label>
      <textarea
        id="palette-fanout-input"
        className="palette-fanout-input"
        rows={3}
        placeholder="First line is the task. Extra lines are the details."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {mode === 'swarm' ? (
        <div className="palette-assign-agents">
          {installed.map((a) => {
            const mine = live.filter((s) => s.agentId === a.id)
            const free = mine.find((s) => canTakeTask(readAgentPhase(s.id)))
            const blocked = mine[0] ? readAgentPhase(mine[0].id) : null
            const hint = !mine.length ? 'new' : free ? phaseWord(readAgentPhase(free.id)) : phaseWord(blocked || 'working')
            return (
              <label key={a.id} className="palette-assign-agent">
                <input
                  type="checkbox"
                  checked={swarmIds.includes(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <span>{a.name}</span>
                <span className="palette-assign-hint">{hint}</span>
              </label>
            )
          })}
          {installed.length === 0 && (
            <span className="palette-fanout-hint">Waiting for installed agents</span>
          )}
        </div>
      ) : (
        <select
          className="palette-assign-select"
          value={chosenOne}
          onChange={(e) => setOneTarget(e.target.value)}
          aria-label="Agent that is not waiting"
        >
          {oneOptions.length === 0 && <option value="">No agents installed</option>}
          {oneOptions.map((o) => (
            <option key={o.id} value={o.id} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <div className="palette-fanout-row">
        <span className="palette-fanout-hint">
          {mode === 'swarm'
            ? 'Working and waiting agents are skipped · Ctrl+Enter'
            : 'Only an idle or stopped agent · Ctrl+Enter'}
        </span>
        <button
          type="submit"
          className="palette-fanout-go"
          disabled={busy || !text.trim() || (mode === 'swarm' ? swarmIds.length === 0 : !chosenOne)}
        >
          {busy ? 'Assigning…' : mode === 'swarm' ? 'Assign swarm' : 'Assign'}
        </button>
      </div>
    </form>
  )
}
