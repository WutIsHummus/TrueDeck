import type { DropEdge } from '../lib/pane-layout'

/**
 * Roblox Studio-style dock widget:
 * - Blue placement preview on the target pane only
 * - Centered 5-way cross (↑ ← ▣ → ↓)
 * Dropping only affects this pane; neighbors keep their layout.
 */
export function StudioDockOverlay({
 edge
}: {
 edge: DropEdge | null
}): JSX.Element {
 return (
 <div className="studio-dock" aria-hidden>
 {/* Placement ghost - where the tab will land inside THIS pane */}
 <div
 className={[
 'studio-dock-preview',
 edge ? `edge-${edge}` : '',
 edge ? 'visible' : ''
 ]
 .filter(Boolean)
 .join(' ')}
 />

 {/* Centered dock cross (Studio dock indicator) */}
 <div className="studio-dock-cross">
 <div className="studio-dock-row">
 <span className="studio-dock-spacer" />
 <div className={`studio-dock-cell ${edge === 'top' ? 'hot' : ''}`} data-edge="top">
 <span className="studio-dock-arrow">▲</span>
 </div>
 <span className="studio-dock-spacer" />
 </div>
 <div className="studio-dock-row">
 <div className={`studio-dock-cell ${edge === 'left' ? 'hot' : ''}`} data-edge="left">
 <span className="studio-dock-arrow">◀</span>
 </div>
 <div
 className={`studio-dock-cell center ${edge === 'center' ? 'hot' : ''}`}
 data-edge="center"
 title="Join this pane’s tabs"
 >
 <span className="studio-dock-tabs">▣</span>
 </div>
 <div className={`studio-dock-cell ${edge === 'right' ? 'hot' : ''}`} data-edge="right">
 <span className="studio-dock-arrow">▶</span>
 </div>
 </div>
 <div className="studio-dock-row">
 <span className="studio-dock-spacer" />
 <div className={`studio-dock-cell ${edge === 'bottom' ? 'hot' : ''}`} data-edge="bottom">
 <span className="studio-dock-arrow">▼</span>
 </div>
 <span className="studio-dock-spacer" />
 </div>
 </div>

 {edge && (
 <div className="studio-dock-hint">
 {edge === 'center'
 ? 'Join this pane’s tabs'
 : edge === 'left'
 ? 'Dock left of this pane'
 : edge === 'right'
 ? 'Dock right of this pane'
 : edge === 'top'
 ? 'Dock above this pane'
 : 'Dock below this pane'}
 </div>
 )}
 </div>
 )
}
