import { useEffect, useState } from 'react'

/** Windows-style min / max / close for frameless Electron window. */
export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.truedeck.windowIsMaximized().then(setMaximized)
    return window.truedeck.onWindowMaximized(setMaximized)
  }, [])

  return (
    <div className="win-controls no-drag" role="group" aria-label="Window">
      <button
        type="button"
        className="win-btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={() => void window.truedeck.windowMinimize()}
      >
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden>
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void window.truedeck.windowMaximize().then(setMaximized)}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M2.5 3H8V8.5H2.5V3Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path d="M3.5 2H9V7.5" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-btn win-btn-close"
        title="Close"
        aria-label="Close"
        onClick={() => void window.truedeck.windowClose()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}
