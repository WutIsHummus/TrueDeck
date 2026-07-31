interface Props {
  title: string
  hint?: string
  /** Smaller chip for overlays / empty-stage spawn. */
  compact?: boolean
}

/**
 * Boot / restore / spawn status — black minimal, same language as tab bar + palette.
 * No blue slate, no heavy “app card” chrome.
 */
export function LoadingCard({ title, hint, compact = false }: Props): JSX.Element {
  return (
    <div
      className={`stage-loading ${compact ? 'compact' : 'full'}`}
      role="status"
      aria-live="polite"
    >
      <div className="stage-loading-card">
        <div className="stage-loading-row">
          <span className="stage-loading-spinner" aria-hidden />
          <p className="stage-loading-title">{title}</p>
        </div>
        {hint ? <p className="stage-loading-hint">{hint}</p> : null}
      </div>
    </div>
  )
}
