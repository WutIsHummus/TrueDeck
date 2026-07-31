/**
 * Minimal preload for TrueDeck document pop-out windows.
 * Exposes OS clipboard so copy works without browser permissions.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('truedeckViewer', {
  copy: (text) => ipcRenderer.invoke('viewer:copyText', String(text ?? ''))
})
