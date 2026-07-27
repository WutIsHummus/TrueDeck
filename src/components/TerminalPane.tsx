import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

interface Props {
  sessionId: string
  visible: boolean
  fontSize?: number
}

export function TerminalPane({ sessionId, visible, fontSize = 13 }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
      theme: {
        background: '#05070a',
        foreground: '#e2e8f0',
        cursor: '#22d3ee',
        selectionBackground: '#22d3ee44',
        black: '#0f172a',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0'
      },
      allowProposedApi: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const onData = term.onData((data) => {
      void window.truedeck.writeSession(sessionId, data)
    })

    const offPty = window.truedeck.onPtyData(({ id, data }) => {
      if (id === sessionId) term.write(data)
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        window.truedeck.resizeSession(sessionId, term.cols, term.rows)
      } catch {
        // ignore
      }
    })
    ro.observe(hostRef.current)

    // initial size push
    try {
      window.truedeck.resizeSession(sessionId, term.cols, term.rows)
    } catch {
      // ignore
    }

    return () => {
      offPty()
      onData.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId, fontSize])

  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
          const term = termRef.current
          if (term) {
            window.truedeck.resizeSession(sessionId, term.cols, term.rows)
            term.focus()
          }
        } catch {
          // ignore
        }
      })
    }
  }, [visible, sessionId])

  // Live font size updates from Settings without remounting the PTY
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
      window.truedeck.resizeSession(sessionId, term.cols, term.rows)
    } catch {
      // ignore
    }
  }, [fontSize, sessionId])

  return (
    <div
      className={`terminal-pane ${visible ? 'visible' : ''}`}
      style={visible ? undefined : { display: 'none' }}
      ref={hostRef}
      onClick={() => termRef.current?.focus()}
    />
  )
}
