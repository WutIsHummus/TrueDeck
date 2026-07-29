/** Shared drag id so the stage can accept tab drops reliably (HTML5 DnD is flaky with custom types). */
let draggingTabId: string | null = null

export function setDraggingTabId(id: string | null): void {
  draggingTabId = id
}

export function getDraggingTabId(): string | null {
  return draggingTabId
}
