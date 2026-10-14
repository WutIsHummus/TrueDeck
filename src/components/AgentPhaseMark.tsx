import { useAgentPhase } from '../lib/agent-activity'

interface Props {
  sessionId: string
  exited?: boolean
}

/** Compact T3-style status: a timer while working, Done when the turn stops, Wait when blocked. */
export function AgentPhaseMark({ sessionId, exited = false }: Props): JSX.Element | null {
  const snap = useAgentPhase(sessionId)
  if (exited) {
    return (
      <span className="tab-phase exited" title="Agent exited">
        Exit
      </span>
    )
  }
  if (!snap.label) return null
  return (
    <span
      className={`tab-phase ${snap.phase}${snap.unseen ? ' unseen' : ''}`}
      title={snap.title}
    >
      <span className="tab-phase-dot" aria-hidden />
      {snap.label}
    </span>
  )
}
