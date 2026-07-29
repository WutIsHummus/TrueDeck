import {
 useEffect,
 useMemo,
 useRef,
 useState,
 type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { ProjectConfig } from '../../electron/shared/types'
import { CloseIcon } from './CloseIcon'

interface Props {
 projects: ProjectConfig[]
 activeProject: ProjectConfig | null
 shortPath: (p: string) => string
 onOpenProject: (p: ProjectConfig) => void
 onAddProject: () => void
 onImportGit: () => void
 onImportReposFolder: () => void
 onRemoveProject?: (p: ProjectConfig) => void
}

/**
 * VS Code-style workspace control for the title bar.
 * Searchable, scrollable project list that scales past a handful of folders.
 */
export function ProjectMenu({
 projects,
 activeProject,
 shortPath,
 onOpenProject,
 onAddProject,
 onImportGit,
 onImportReposFolder,
 onRemoveProject
}: Props): JSX.Element {
 const [open, setOpen] = useState(false)
 const [query, setQuery] = useState('')
 const [highlight, setHighlight] = useState(0)
 const rootRef = useRef<HTMLDivElement>(null)
 const searchRef = useRef<HTMLInputElement>(null)
 const listRef = useRef<HTMLDivElement>(null)

 useEffect(() => {
 if (!open) return
 const onDoc = (e: MouseEvent): void => {
 if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
 }
 const onKey = (e: KeyboardEvent): void => {
 if (e.key === 'Escape') setOpen(false)
 }
 document.addEventListener('mousedown', onDoc)
 window.addEventListener('keydown', onKey)
 // Focus search when opened
 requestAnimationFrame(() => searchRef.current?.focus())
 setQuery('')
 setHighlight(0)
 return () => {
 document.removeEventListener('mousedown', onDoc)
 window.removeEventListener('keydown', onKey)
 }
 }, [open])

 const filtered = useMemo(() => {
 const q = query.trim().toLowerCase()
 if (!q) return projects
 return projects.filter(
 (p) =>
 p.name.toLowerCase().includes(q) ||
 p.root.toLowerCase().includes(q) ||
 p.id.toLowerCase().includes(q)
 )
 }, [projects, query])

 useEffect(() => {
 setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)))
 }, [filtered.length])

 useEffect(() => {
 if (!open || !listRef.current) return
 const el = listRef.current.querySelector(`[data-idx="${highlight}"]`) as HTMLElement | null
 el?.scrollIntoView({ block: 'nearest' })
 }, [highlight, open])

 const label = activeProject?.name || 'Open Folder'

 const pick = (p: ProjectConfig): void => {
 setOpen(false)
 setQuery('')
 if (activeProject?.id !== p.id) onOpenProject(p)
 }

 const onSearchKey = (e: ReactKeyboardEvent): void => {
 if (e.key === 'ArrowDown') {
 e.preventDefault()
 setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)))
 } else if (e.key === 'ArrowUp') {
 e.preventDefault()
 setHighlight((h) => Math.max(h - 1, 0))
 } else if (e.key === 'Enter') {
 e.preventDefault()
 const p = filtered[highlight]
 if (p) pick(p)
 }
 }

 return (
 <div className="project-menu no-drag" ref={rootRef}>
 <button
 type="button"
 className={`project-title ${open ? 'open' : ''} ${activeProject ? '' : 'empty'}`}
 title={
 activeProject
 ? `${activeProject.root}\nClick to switch project · Ctrl+O open folder`
 : 'Open a project folder (Ctrl+O)'
 }
 aria-haspopup="menu"
 aria-expanded={open}
 onClick={(e) => {
 e.stopPropagation()
 setOpen((v) => !v)
 }}
 >
 <span className="project-title-name">{label}</span>
 {projects.length > 0 && (
 <span className="project-title-count" title={`${projects.length} projects`}>
 {projects.length}
 </span>
 )}
 <span className="project-title-chevron" aria-hidden>
 ▾
 </span>
 </button>

 {open && (
 <div className="project-dropdown" role="menu">
 <div className="project-dropdown-head">
 {activeProject ? shortPath(activeProject.root) : 'No folder open'}
 </div>

 <div className="project-dropdown-actions">
 <button
 type="button"
 role="menuitem"
 className="project-dropdown-item primary"
 onClick={() => {
 setOpen(false)
 onAddProject()
 }}
 >
 <span className="item-title">Open Folder…</span>
 <span className="item-hint">Ctrl+O</span>
 </button>
 <button
 type="button"
 role="menuitem"
 className="project-dropdown-item primary"
 onClick={() => {
 setOpen(false)
 onImportGit()
 }}
 >
 <span className="item-title">Clone Repository…</span>
 <span className="item-hint">git</span>
 </button>
 <button
 type="button"
 role="menuitem"
 className="project-dropdown-item primary"
 onClick={() => {
 setOpen(false)
 onImportReposFolder()
 }}
 >
 <span className="item-title">Add Repository Folder…</span>
 <span className="item-hint">scan</span>
 </button>
 </div>

 {projects.length > 0 && (
 <>
 <div className="project-dropdown-search-wrap">
 <input
 ref={searchRef}
 className="project-dropdown-search"
 type="search"
 placeholder={`Search ${projects.length} project${projects.length === 1 ? '' : 's'}…`}
 value={query}
 onChange={(e) => {
 setQuery(e.target.value)
 setHighlight(0)
 }}
 onKeyDown={onSearchKey}
 aria-label="Search projects"
 />
 </div>

 <div className="project-dropdown-label">
 {query.trim()
 ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
 : 'Recent'}
 </div>

 <div className="project-dropdown-list" ref={listRef} role="listbox">
 {filtered.length === 0 && (
 <div className="project-dropdown-empty muted">No projects match</div>
 )}
 {filtered.map((p, i) => {
 const active = activeProject?.id === p.id
 return (
 <div
 key={p.id}
 className={`project-dropdown-row ${active ? 'active' : ''} ${
 i === highlight ? 'highlight' : ''
 }`}
 data-idx={i}
 >
 <button
 type="button"
 role="option"
 aria-selected={active}
 className="project-dropdown-item"
 onMouseEnter={() => setHighlight(i)}
 onClick={() => pick(p)}
 >
 <span className="item-title">
 {active && <span className="item-check">✓ </span>}
 {p.name}
 </span>
 <span className="item-path" title={p.root}>
 {shortPath(p.root)}
 </span>
 </button>
 {onRemoveProject && (
 <button
 type="button"
 className="project-dropdown-remove"
 title="Remove from list (does not delete files)"
 aria-label={`Remove ${p.name}`}
 onClick={(e) => {
 e.stopPropagation()
 onRemoveProject(p)
 }}
 >
 <CloseIcon size={9} />
 </button>
 )}
 </div>
 )
 })}
 </div>
 </>
 )}
 </div>
 )}
 </div>
 )
}
