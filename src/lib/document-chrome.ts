/** Shared header state from DocumentPane → animated AgentChromeBar */

export type DocumentChromeState = {
  path: string
  name: string
  lang: string
  lineCount: number
  dirty: boolean
  mode: 'preview' | 'edit'
  isMd: boolean
  vimMode: boolean
  loading: boolean
  saving: boolean
  onSetMode: (mode: 'preview' | 'edit') => void
  onToggleVim: () => void
  onReload: () => void
  onSave: () => void
}
