import { useEffect, useRef, useState } from 'react'
import { formatCode } from '../../electron/shared/phone-text'

type PhoneUrl = { url: string; label: string }
type PhoneInfo = {
  enabled: boolean
  port: number | null
  token: string
  urls: PhoneUrl[]
  error?: string
}

export function PhoneLink(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<PhoneInfo | null>(null)
  const [note, setNote] = useState('')
  const [box, setBox] = useState<{ top: number; right: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const btn = btnRef.current
    if (btn) {
      const rect = btn.getBoundingClientRect()
      setBox({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })
    }
    let cancel = false
    void window.truedeck
      .phoneDeck()
      .then((next) => {
        if (!cancel) setInfo(next)
      })
      .catch((err: unknown) => {
        if (cancel) return
        setInfo({
          enabled: false,
          port: null,
          token: '',
          urls: [],
          error: err instanceof Error ? err.message : String(err)
        })
      })
    const onDoc = (ev: MouseEvent): void => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      cancel = true
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await window.truedeck.writeClipboard(text)
      setNote(label)
    } catch {
      setNote('Clipboard missed it. Select the address and copy it.')
    }
  }

  const code = info?.token ? formatCode(info.token) : ''
  const primary = info?.urls[0]
  const link = primary && code ? `${primary.url}/?k=${code}` : ''

  return (
    <div className="phone-link no-drag" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`titlebar-explorer-btn phone-link-btn${open ? ' active' : ''}`}
        title="Open TrueDeck on your phone"
        aria-label="Open on your phone"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            fill="currentColor"
            d="M4.5 1.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V3a1.5 1.5 0 0 0-1.5-1.5h-7zM4 3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v8.5H4V3zm4 10a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"
          />
        </svg>
      </button>
      {open && box && (
        <div
          className="phone-link-pop"
          role="dialog"
          aria-label="Phone link"
          style={{ top: box.top, right: box.right }}
        >
          <div className="phone-link-title">On your phone</div>
          <p className="phone-link-lead">
            Open this address from anywhere while TrueDeck is running. It uses the same Oracle
            host as Photon. Send types the prompt into the desktop session you pick.
          </p>
          {!info && <p className="phone-link-lead">Starting the page…</p>}
          {info?.error && <p className="phone-link-err">{info.error}</p>}
          {info?.urls.map((item) => (
            <button
              key={item.url}
              type="button"
              className="phone-link-url"
              onClick={() => void copy(`${item.url}/?k=${code}`, 'Link copied')}
            >
              <span className="phone-link-label">{item.label}</span>
              <code>{item.url}</code>
            </button>
          ))}
          {code && (
            <div className="phone-link-code">
              <span className="phone-link-label">Code</span>
              <strong>{code}</strong>
            </div>
          )}
          <div className="phone-link-actions">
            <button
              type="button"
              className="primary"
              disabled={!link}
              onClick={() => void copy(link, 'Link copied')}
            >
              Copy link
            </button>
            <button type="button" disabled={!code} onClick={() => void copy(code, 'Code copied')}>
              Copy code
            </button>
          </div>
          <p className="phone-link-foot">
            Cellular works. Leave this PC’s TrueDeck window open.
          </p>
          {note && <p className="phone-link-note">{note}</p>}
        </div>
      )}
    </div>
  )
}
