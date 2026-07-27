import { useMemo, useState } from 'react'
import type { ProjectConfig } from '../../electron/shared/types'

type StepId = 'welcome' | 'chrome' | 'repo' | 'agent' | 'done'

interface Props {
  open: boolean
  projects: ProjectConfig[]
  hasActiveProject: boolean
  hasSessions: boolean
  onAddProject: () => Promise<void>
  onOpenProject: (p: ProjectConfig) => Promise<void>
  onLaunchAgent: (id: string) => Promise<void>
  onComplete: (skipped?: boolean) => void
  shortPath: (p: string) => string
}

const STEPS: StepId[] = ['welcome', 'chrome', 'repo', 'agent', 'done']

/**
 * First-run walkthrough: explain chrome, connect a repo, launch an agent.
 */
export function Onboarding({
  open,
  projects,
  hasActiveProject,
  hasSessions,
  onAddProject,
  onOpenProject,
  onLaunchAgent,
  onComplete,
  shortPath
}: Props): JSX.Element | null {
  const [step, setStep] = useState<StepId>('welcome')
  const [busy, setBusy] = useState(false)

  const idx = STEPS.indexOf(step)
  const progress = ((idx + 1) / STEPS.length) * 100

  const canNext = useMemo(() => {
    if (step === 'repo') return hasActiveProject || projects.length > 0
    if (step === 'agent') return hasSessions
    return true
  }, [step, hasActiveProject, hasSessions, projects.length])

  if (!open) return null

  const go = (s: StepId): void => setStep(s)
  const next = (): void => {
    const i = STEPS.indexOf(step)
    if (i < STEPS.length - 1) go(STEPS[i + 1])
  }
  const back = (): void => {
    const i = STEPS.indexOf(step)
    if (i > 0) go(STEPS[i - 1])
  }

  return (
    <div className="onboard-backdrop">
      <div className="onboard" role="dialog" aria-label="Welcome to TrueDeck">
        <div className="onboard-progress">
          <div className="onboard-progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <header className="onboard-header">
          <div className="onboard-logo">TRUEDECK</div>
          <button type="button" className="onboard-skip" onClick={() => onComplete(true)}>
            Skip
          </button>
        </header>

        <div className="onboard-body">
          {step === 'welcome' && (
            <div className="onboard-step">
              <h1>Your agent deck</h1>
              <p className="onboard-lead">
                TrueDeck is a terminal-first workspace for AI coding agents — Grok, Codex, Cursor,
                Claude — with <strong>automatic memory</strong>. No Docker memory setup. No note
                panels to babysit.
              </p>
              <ul className="onboard-bullets">
                <li>Connect a local repo (folder)</li>
                <li>Open agents as tabs</li>
                <li>Drag tabs, split, ship code</li>
              </ul>
              <button type="button" className="onboard-primary" onClick={next}>
                Get started →
              </button>
            </div>
          )}

          {step === 'chrome' && (
            <div className="onboard-step">
              <h1>Quick map of the app</h1>
              <p className="onboard-lead">
                Nothing to click on this screen — just read, then hit <strong>Next</strong>.
              </p>

              <ol className="onboard-guide">
                <li>
                  <div className="onboard-guide-label">
                    <span className="onboard-sample">mem·auto</span>
                  </div>
                  <div>
                    <strong>Status only</strong> — not a button. Means memory is automatic for your
                    agents. You can ignore it.
                  </div>
                </li>
                <li>
                  <div className="onboard-guide-label">
                    <span className="onboard-sample primary">+ agent</span>
                  </div>
                  <div>
                    <strong>Start an AI agent here</strong> — opens a list (Grok, Codex, Cursor,
                    Claude…). Also <kbd>Ctrl+Shift+A</kbd>.
                  </div>
                </li>
                <li>
                  <div className="onboard-guide-label">
                    <span className="onboard-sample">⚙</span>
                  </div>
                  <div>
                    <strong>Settings</strong> — font size, theme, on-open commands (like{' '}
                    <code>rojo serve</code>). Also <kbd>Ctrl+Shift+S</kbd>.
                  </div>
                </li>
                <li>
                  <div className="onboard-guide-label">
                    <span className="onboard-sample">project chip</span>
                  </div>
                  <div>
                    <strong>Your folder</strong> — shows the connected repo path. Click it (or use{' '}
                    <kbd>Ctrl+Shift+O</kbd>) to open a different one.
                  </div>
                </li>
              </ol>

              <p className="muted" style={{ marginBottom: 16 }}>
                Next step: connect a real project folder. After that you can launch an agent.
              </p>

              <div className="onboard-nav">
                <button type="button" onClick={back}>
                  ← Back
                </button>
                <button type="button" className="onboard-primary" onClick={next}>
                  Got it — Next →
                </button>
              </div>
            </div>
          )}

          {step === 'repo' && (
            <div className="onboard-step">
              <h1>Connect a repo</h1>
              <p className="onboard-lead">
                TrueDeck works on <strong>local folders</strong> (git repos). Pick one to open —
                agents run inside that directory.
              </p>

              {projects.length > 0 && (
                <div className="onboard-repo-list">
                  <div className="onboard-label">Your projects</div>
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`onboard-repo ${hasActiveProject ? '' : ''}`}
                      disabled={busy}
                      onClick={() => {
                        void (async () => {
                          setBusy(true)
                          try {
                            await onOpenProject(p)
                          } finally {
                            setBusy(false)
                          }
                        })()
                      }}
                    >
                      <span className="name">{p.name}</span>
                      <span className="path">{shortPath(p.root)}</span>
                      <span className="cta">Open →</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="onboard-primary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true)
                    try {
                      await onAddProject()
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                {busy ? 'Opening…' : 'Browse for a folder…'}
              </button>

              {hasActiveProject && (
                <p className="onboard-ok">✓ Project connected — continue when ready.</p>
              )}

              <div className="onboard-nav">
                <button type="button" onClick={back}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="onboard-primary"
                  disabled={!hasActiveProject}
                  onClick={next}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {step === 'agent' && (
            <div className="onboard-step">
              <h1>Launch an agent</h1>
              <p className="onboard-lead">
                Open a coding agent in a tab. You can run several at once and drag tabs to reorder
                or split.
              </p>

              <div className="onboard-agent-grid">
                {(
                  [
                    { id: 'cursor', label: 'Cursor', hint: 'cursor-agent' },
                    { id: 'grok', label: 'Grok', hint: 'Grok Build' },
                    { id: 'codex', label: 'Codex', hint: 'OpenAI CLI' },
                    { id: 'claude', label: 'Claude', hint: 'Claude Code' },
                    { id: 'shell', label: 'Shell', hint: 'plain terminal' }
                  ] as const
                ).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="onboard-agent-card"
                    disabled={busy || !hasActiveProject}
                    onClick={() => {
                      void (async () => {
                        setBusy(true)
                        try {
                          await onLaunchAgent(a.id)
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }}
                  >
                    <span className="name">{a.label}</span>
                    <span className="hint">{a.hint}</span>
                  </button>
                ))}
              </div>

              {hasSessions && (
                <p className="onboard-ok">✓ Agent tab open — you’re ready to code.</p>
              )}

              <div className="onboard-nav">
                <button type="button" onClick={back}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="onboard-primary"
                  disabled={!hasSessions}
                  onClick={next}
                >
                  Finish →
                </button>
              </div>
              {!hasSessions && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Launch any agent above to continue (or skip if tools aren’t installed yet).
                </p>
              )}
              <button type="button" className="onboard-skip-inline" onClick={next}>
                Skip agent for now
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="onboard-step">
              <h1>You’re set</h1>
              <p className="onboard-lead">Quick map:</p>
              <ul className="onboard-bullets">
                <li>
                  All shortcuts: hold <strong>Ctrl+Shift</strong>, then a letter
                </li>
                <li>
                  <strong>A</strong> agents · <strong>O</strong> project · <strong>W</strong> close ·{' '}
                  <strong>S</strong> settings · <strong>T</strong> next tab
                </li>
                <li>
                  <code>mem·auto</code> = automatic memory (status only, not a button)
                </li>
              </ul>
              <p className="muted">
                Example: hold Ctrl and Shift, tap <strong>A</strong> → agent list. Works even while
                an agent terminal is focused.
              </p>
              <button type="button" className="onboard-primary" onClick={() => onComplete(false)}>
                Enter TrueDeck →
              </button>
            </div>
          )}
        </div>

        <footer className="onboard-footer">
          Step {idx + 1} of {STEPS.length}
          {canNext ? '' : ''}
        </footer>
      </div>
    </div>
  )
}
