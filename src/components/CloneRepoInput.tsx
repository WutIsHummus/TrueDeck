import { useEffect, useRef, useState } from 'react'

interface Props {
 onClose: () => void
 onCloned: (projectRoot: string) => void
 onStatus?: (msg: string) => void
}

/**
 * VS Code-style "Clone Repository" flow:
 * 1. Quick input for URL (or existing path)
 * 2. Native folder picker for clone destination
 * 3. git clone → open project
 */
export function CloneRepoInput({ onClose, onCloned, onStatus }: Props): JSX.Element {
 const [url, setUrl] = useState('')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [hint, setHint] = useState('Enter a repository URL, then choose a local folder to clone into.')
 const inputRef = useRef<HTMLInputElement>(null)

 useEffect(() => {
 inputRef.current?.focus()
 inputRef.current?.select()
 }, [])

 useEffect(() => {
 const onKey = (e: KeyboardEvent): void => {
 if (e.key === 'Escape' && !busy) {
 e.preventDefault()
 onClose()
 }
 }
 window.addEventListener('keydown', onKey, true)
 return () => window.removeEventListener('keydown', onKey, true)
 }, [busy, onClose])

 const run = async (): Promise<void> => {
 const u = url.trim()
 if (!u) {
 setError('Provide a repository URL')
 return
 }
 setError('')

 // Existing local path → open as project (VS Code also allows paths)
 const looksLikePath =
 /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith('\\\\') || u.startsWith('/') || u.startsWith('~')

 if (looksLikePath) {
 setBusy(true)
 setHint('Opening folder…')
 onStatus?.('Opening folder…')
 try {
 const res = await window.truedeck.cloneRepo({ url: u })
 onCloned(res.project.root)
 onClose()
 } catch (e) {
 setError(e instanceof Error ? e.message : String(e))
 setHint('Enter a repository URL, then choose a local folder to clone into.')
 } finally {
 setBusy(false)
 }
 return
 }

 // VS Code step 2: pick destination folder
 setHint('Choose a folder to clone into…')
 onStatus?.('Choose a folder to clone into…')
 const parent = await window.truedeck.pickCloneParent()
 if (!parent) {
 setHint('Enter a repository URL, then choose a local folder to clone into.')
 onStatus?.('Clone cancelled')
 inputRef.current?.focus()
 return
 }

 setBusy(true)
 setHint(`Cloning into ${parent}…`)
 onStatus?.('Cloning repository…')
 try {
 const res = await window.truedeck.cloneRepo({
 url: u,
 parentDir: parent
 })
 onStatus?.(res.cloned ? `Cloned ${res.project.name}` : `Opened ${res.project.name}`)
 onCloned(res.project.root)
 onClose()
 } catch (e) {
 setError(e instanceof Error ? e.message : String(e))
 setHint('Enter a repository URL, then choose a local folder to clone into.')
 onStatus?.(e instanceof Error ? e.message : String(e))
 inputRef.current?.focus()
 } finally {
 setBusy(false)
 }
 }

 return (
 <div
 className="clone-quick-backdrop"
 onMouseDown={(e) => {
 if (e.target === e.currentTarget && !busy) onClose()
 }}
 >
 <div
 className="clone-quick"
 role="dialog"
 aria-label="Clone Repository"
 onMouseDown={(e) => e.stopPropagation()}
 >
 <div className="clone-quick-title">Clone Repository</div>
 <div className="clone-quick-row">
 <input
 ref={inputRef}
 className="clone-quick-input"
 type="text"
 disabled={busy}
 value={url}
 placeholder="https://github.com/microsoft/vscode.git"
 spellCheck={false}
 autoComplete="off"
 onChange={(e) => {
 setUrl(e.target.value)
 if (error) setError('')
 }}
 onKeyDown={(e) => {
 if (e.key === 'Enter' && !busy) {
 e.preventDefault()
 void run()
 }
 }}
 />
 </div>
 <div className={`clone-quick-hint ${error ? 'error' : ''}`}>
 {error || (busy ? hint : hint)}
 </div>
 <div className="clone-quick-keys muted">
 <span>
 <kbd>Enter</kbd> Confirm
 </span>
 <span>
 <kbd>Esc</kbd> Cancel
 </span>
 </div>
 </div>
 </div>
 )
}
