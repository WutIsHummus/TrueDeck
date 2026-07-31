import { useCallback, useEffect, useState } from 'react'
import { LanguageIcon } from './LanguageIcon'

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

interface Props {
  projectRoot: string
  projectName?: string
  activeFilePath?: string | null
  onOpenFile: (path: string) => void
  onClose?: () => void
  width?: number
}

function FolderIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="explorer-folder-icon">
      {open ? (
        <path
          fill="currentColor"
          d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.879a1.5 1.5 0 0 1 1.06.44l.561.56H13A1.5 1.5 0 0 1 14.5 4.5v.5H1.5v-1.5zm0 2.5h13v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V6z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.879a1.5 1.5 0 0 1 1.06.44L9 3.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5z"
        />
      )}
    </svg>
  )
}

function TreeNode({
  entry,
  depth,
  activeFilePath,
  onOpenFile,
  expanded,
  onToggle,
  childrenOf
}: {
  entry: DirEntry
  depth: number
  activeFilePath?: string | null
  onOpenFile: (path: string) => void
  expanded: Set<string>
  onToggle: (path: string) => void
  childrenOf: Record<string, DirEntry[]>
}): JSX.Element {
  const isOpen = expanded.has(entry.path)
  const kids = childrenOf[entry.path] || []
  const active =
    activeFilePath &&
    activeFilePath.replace(/\\/g, '/').toLowerCase() ===
      entry.path.replace(/\\/g, '/').toLowerCase()

  if (entry.isDirectory) {
    return (
      <div className="explorer-node">
        <button
          type="button"
          className={`explorer-row dir${isOpen ? ' open' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={entry.path}
          onClick={() => onToggle(entry.path)}
        >
          <span className="explorer-chevron" aria-hidden>
            {isOpen ? '▾' : '▸'}
          </span>
          <FolderIcon open={isOpen} />
          <span className="explorer-name">{entry.name}</span>
        </button>
        {isOpen &&
          kids.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
              expanded={expanded}
              onToggle={onToggle}
              childrenOf={childrenOf}
            />
          ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`explorer-row file${active ? ' active' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 + 14 }}
      title={entry.path}
      onClick={() => onOpenFile(entry.path)}
      onDoubleClick={() => onOpenFile(entry.path)}
    >
      <LanguageIcon pathOrLang={entry.path} size={13} />
      <span className="explorer-name">{entry.name}</span>
    </button>
  )
}

/**
 * VS Code-style project file tree (left sidebar).
 */
export function ProjectExplorer({
  projectRoot,
  projectName,
  activeFilePath,
  onOpenFile,
  onClose,
  width = 240
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([projectRoot]))
  const [childrenOf, setChildrenOf] = useState<Record<string, DirEntry[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDir = useCallback(async (dir: string) => {
    if (!dir || typeof window.truedeck.listProjectDir !== 'function') return
    try {
      const rows = await window.truedeck.listProjectDir(dir)
      setChildrenOf((prev) => ({ ...prev, [dir]: rows }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Load root when project changes
  useEffect(() => {
    setExpanded(new Set([projectRoot]))
    setChildrenOf({})
    setLoading(true)
    void loadDir(projectRoot).finally(() => setLoading(false))
  }, [projectRoot, loadDir])

  const onToggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else {
          next.add(path)
          if (!childrenOf[path]) void loadDir(path)
        }
        return next
      })
    },
    [childrenOf, loadDir]
  )

  const refresh = useCallback(() => {
    setLoading(true)
    // Reload all expanded dirs
    const dirs = Array.from(expanded)
    void Promise.all(dirs.map((d) => loadDir(d))).finally(() => setLoading(false))
  }, [expanded, loadDir])

  const rootKids = childrenOf[projectRoot] || []
  const label =
    projectName ||
    projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
    'Project'

  return (
    <aside
      className="project-explorer"
      style={{ width: '100%', minWidth: width }}
      aria-label="Project explorer"
    >
      <div className="explorer-header">
        <span className="explorer-title" title={projectRoot}>
          {label}
        </span>
        <span className="explorer-header-actions">
          <button type="button" className="explorer-icon-btn" title="Refresh" onClick={refresh}>
            ↻
          </button>
          {onClose && (
            <button type="button" className="explorer-icon-btn" title="Hide explorer" onClick={onClose}>
              ×
            </button>
          )}
        </span>
      </div>
      <div className="explorer-tree">
        {loading && !rootKids.length ? (
          <div className="explorer-empty muted">Loading…</div>
        ) : error ? (
          <div className="explorer-empty document-error">{error}</div>
        ) : !rootKids.length ? (
          <div className="explorer-empty muted">Empty folder</div>
        ) : (
          rootKids.map((e) => (
            <TreeNode
              key={e.path}
              entry={e}
              depth={0}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
              expanded={expanded}
              onToggle={onToggle}
              childrenOf={childrenOf}
            />
          ))
        )}
      </div>
    </aside>
  )
}
