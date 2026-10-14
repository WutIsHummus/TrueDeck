import { useEffect, useRef, useState } from 'react'
import { profileLabel } from '../../electron/shared/codex-label'
import type { CodexAccountsState } from '../../electron/shared/types'

interface PanelProps {
  projectRoot: string | null
  onStatus: (msg: string) => void
  onSignedIn?: () => void
}

interface SwitcherProps {
  onStatus: (msg: string) => void
  onManage: () => void
}

function accountMeta(account: CodexAccountsState['accounts'][number]): string {
  const emails = [
    ...new Set(account.workspaces.map((ws) => ws.email).filter((email): email is string => Boolean(email)))
  ]
  const plans = [
    ...new Set(account.workspaces.map((ws) => ws.plan).filter((plan): plan is string => Boolean(plan)))
  ]
  return [emails[0], plans[0]].filter(Boolean).join(' · ')
}

export function CodexAccountsPanel({ projectRoot, onStatus, onSignedIn }: PanelProps): JSX.Element {
  const [state, setState] = useState<CodexAccountsState | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const next = await window.truedeck.getCodexAccounts()
    setState(next)
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      onStatus(err instanceof Error ? err.message : String(err))
    })
  }, [onStatus])

  const run = async (work: () => Promise<CodexAccountsState | void>): Promise<void> => {
    setBusy(true)
    try {
      const next = await work()
      if (next) setState(next)
      else await refresh()
    } catch (err) {
      onStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <section className="settings-section">
        <h3>Codex accounts</h3>
        <p className="hint">Loading accounts…</p>
      </section>
    )
  }

  return (
    <section className="settings-section">
      <h3>Codex accounts</h3>
      <p className="hint">
        Three ChatGPT logins. The signed-in account starts with two workspaces. The other two
        accounts start with one. Sign in on an empty workspace and choose its workspace in the
        browser. Each one keeps its own Codex folder, so switching does not sign the others out.
        New Codex tabs use the workspace selected in the title bar. A tab that is already open
        stays on the workspace it started with. The Codex desktop app still uses the original
        login in your home folder. If the extra workspace belongs on a different account, use the
        account menu on that row to move it.
      </p>
      {state.accounts.map((account) => (
        <div key={account.id} className="codex-account">
          <label className="codex-account-name">
            <span>Account</span>
            <input
              defaultValue={account.label}
              key={`${account.id}:${account.label}`}
              disabled={busy}
              onBlur={(e) => {
                const label = e.target.value.trim()
                if (!label || label === account.label) return
                void run(() => window.truedeck.renameCodexProfile({ accountId: account.id, label }))
              }}
            />
          </label>
          {accountMeta(account) && <p className="hint">{accountMeta(account)}</p>}
          {account.workspaces.map((workspace) => {
            const active = workspace.id === state.activeWorkspaceId
            return (
              <div key={workspace.id} className={`codex-workspace${active ? ' active' : ''}`}>
                <input
                  defaultValue={workspace.label}
                  key={`${workspace.id}:${workspace.label}`}
                  disabled={busy}
                  aria-label="Workspace name"
                  onBlur={(e) => {
                    const label = e.target.value.trim()
                    if (!label || label === workspace.label) return
                    void run(() =>
                      window.truedeck.renameCodexProfile({ workspaceId: workspace.id, label })
                    )
                  }}
                />
                <span className="meta">{workspace.signedIn ? 'Signed in' : 'Not signed in'}</span>
                <select
                  aria-label="Move workspace to account"
                  disabled={busy}
                  value={account.id}
                  onChange={(e) => {
                    const toAccountId = e.target.value
                    if (toAccountId === account.id) return
                    void run(() => window.truedeck.moveCodexWorkspace(workspace.id, toAccountId))
                  }}
                >
                  {state.accounts.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={active ? 'primary' : ''}
                  disabled={busy || active}
                  onClick={() => {
                    void run(async () => {
                      const next = await window.truedeck.setActiveCodexWorkspace(workspace.id)
                      onStatus(`Codex · ${profileLabel(account, workspace)}`)
                      return next
                    })
                  }}
                >
                  {active ? 'Active' : 'Use'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await window.truedeck.setActiveCodexWorkspace(workspace.id)
                      await window.truedeck.loginCodexWorkspace({
                        workspaceId: workspace.id,
                        projectRoot: projectRoot || undefined
                      })
                      onStatus(`Sign in · ${profileLabel(account, workspace)}`)
                      onSignedIn?.()
                    })
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  disabled={busy || workspace.builtin}
                  title={
                    workspace.builtin
                      ? 'The original Codex login stays on this PC'
                      : 'Remove this workspace'
                  }
                  onClick={() => {
                    void run(() => window.truedeck.removeCodexWorkspace(workspace.id))
                  }}
                >
                  Remove
                </button>
              </div>
            )
          })}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(() => window.truedeck.addCodexWorkspace(account.id))
            }}
          >
            Add workspace
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(() => window.truedeck.addCodexAccount())
          }}
        >
          Add account
        </button>
      </div>
    </section>
  )
}

export function CodexAccountSwitcher({ onStatus, onManage }: SwitcherProps): JSX.Element {
  const [state, setState] = useState<CodexAccountsState | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const refresh = async (): Promise<CodexAccountsState> => {
    const next = await window.truedeck.getCodexAccounts()
    setState(next)
    return next
  }

  useEffect(() => {
    void refresh().catch(() => {
      /* title bar stays quiet until Settings */
    })
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh().catch(() => {
      /* ignore */
    })
    const onPointer = (ev: MouseEvent): void => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = state
    ? state.accounts
        .flatMap((account) => account.workspaces.map((workspace) => ({ account, workspace })))
        .find((row) => row.workspace.id === state.activeWorkspaceId)
    : null
  const buttonLabel = active ? `Codex · ${profileLabel(active.account, active.workspace)}` : 'Codex'

  return (
    <div className="codex-switch no-drag" ref={rootRef}>
      <button
        type="button"
        className="codex-switch-btn"
        title="Switch Codex account and workspace"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        {buttonLabel}
      </button>
      {open && state && (
        <div className="codex-switch-menu" role="menu">
          {state.accounts.map((account) => (
            <div key={account.id} className="codex-switch-account">
              <div className="codex-switch-account-label">{account.label}</div>
              {account.workspaces.map((workspace) => {
                const selected = workspace.id === state.activeWorkspaceId
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    className={selected ? 'active' : ''}
                    onClick={() => {
                      void (async () => {
                        try {
                          const next = await window.truedeck.setActiveCodexWorkspace(workspace.id)
                          setState(next)
                          setOpen(false)
                          onStatus(`Codex · ${profileLabel(account, workspace)}`)
                        } catch (err) {
                          onStatus(err instanceof Error ? err.message : String(err))
                        }
                      })()
                    }}
                  >
                    <span>{workspace.label}</span>
                    <span className="meta">{workspace.signedIn ? 'Signed in' : 'Sign in needed'}</span>
                  </button>
                )
              })}
            </div>
          ))}
          <button
            type="button"
            className="codex-switch-manage"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            Manage accounts
          </button>
        </div>
      )}
    </div>
  )
}
