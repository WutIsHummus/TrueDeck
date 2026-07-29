/**
 * Named pane layout presets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalDataDir } from './paths'
import type { NamedLayout, SavedPaneNode } from '../shared/types'

const STORE = (): string => join(getGlobalDataDir(), 'layouts.json')

function leafTabs(n: number, active = 0): SavedPaneNode {
  return {
    type: 'leaf',
    tabIndices: Array.from({ length: n }, (_, i) => i),
    activeTabIndex: Math.min(active, Math.max(0, n - 1))
  }
}

function split(
  direction: 'row' | 'column',
  first: SavedPaneNode,
  second: SavedPaneNode,
  ratio = 0.5
): SavedPaneNode {
  return { type: 'split', direction, ratio, first, second }
}

/** Built-in presets by cell count (fills tab indices 0..n-1). */
export function presetTree(preset: string): { tree: SavedPaneNode; tabs: number } {
  switch (preset) {
    case '1x1':
      return { tree: leafTabs(1), tabs: 1 }
    case '1x2':
      return {
        tree: split(
          'row',
          { type: 'leaf', tabIndices: [0], activeTabIndex: 0 },
          { type: 'leaf', tabIndices: [1], activeTabIndex: 1 },
          0.5
        ),
        tabs: 2
      }
    case '2x2': {
      const top = split('row', leafTabs(1), leafTabs(1), 0.5)
      const bot = split('row', leafTabs(1), leafTabs(1), 0.5)
      // Remap indices: we need unique tab indices 0..3
      const t0: SavedPaneNode = { type: 'leaf', tabIndices: [0], activeTabIndex: 0 }
      const t1: SavedPaneNode = { type: 'leaf', tabIndices: [1], activeTabIndex: 1 }
      const t2: SavedPaneNode = { type: 'leaf', tabIndices: [2], activeTabIndex: 2 }
      const t3: SavedPaneNode = { type: 'leaf', tabIndices: [3], activeTabIndex: 3 }
      return {
        tree: split('column', split('row', t0, t1), split('row', t2, t3), 0.5),
        tabs: 4
      }
    }
    case '2x3': {
      // 3 columns
      const a: SavedPaneNode = { type: 'leaf', tabIndices: [0], activeTabIndex: 0 }
      const b: SavedPaneNode = { type: 'leaf', tabIndices: [1], activeTabIndex: 1 }
      const c: SavedPaneNode = { type: 'leaf', tabIndices: [2], activeTabIndex: 2 }
      return {
        tree: split('row', a, split('row', b, c, 0.5), 0.33),
        tabs: 3
      }
    }
    case '4x4': {
      // 4-way: 2x2 of pairs = 4 panes (full 16 is heavy; cap practical preset at 4 leaves)
      // For "4x4" marketing, spawn 4 leaves in a balanced tree
      return presetTree('2x2')
    }
    default:
      return { tree: leafTabs(1), tabs: 1 }
  }
}

export function listNamedLayouts(): NamedLayout[] {
  try {
    if (!existsSync(STORE())) return seedBuiltins()
    const raw = JSON.parse(readFileSync(STORE(), 'utf8')) as NamedLayout[]
    return Array.isArray(raw) ? raw : seedBuiltins()
  } catch {
    return seedBuiltins()
  }
}

function seedBuiltins(): NamedLayout[] {
  const now = Date.now()
  const builtins: NamedLayout[] = (['1x1', '1x2', '2x2', '2x3'] as const).map((p) => {
    const { tree } = presetTree(p)
    return {
      id: `preset-${p}`,
      name: p,
      preset: p,
      paneTree: tree,
      fillAgentIds: [],
      savedAt: now
    }
  })
  saveNamedLayouts(builtins)
  return builtins
}

export function saveNamedLayouts(list: NamedLayout[]): NamedLayout[] {
  mkdirSync(dirname(STORE()), { recursive: true })
  writeFileSync(STORE(), JSON.stringify(list, null, 2), 'utf8')
  return list
}

export function saveCurrentLayout(input: {
  name: string
  paneTree: SavedPaneNode | null
  fillAgentIds?: string[]
}): NamedLayout {
  const all = listNamedLayouts()
  const layout: NamedLayout = {
    id: randomUUID(),
    name: input.name.trim() || 'Custom',
    paneTree: input.paneTree,
    fillAgentIds: input.fillAgentIds || [],
    savedAt: Date.now()
  }
  all.push(layout)
  saveNamedLayouts(all)
  return layout
}

export function deleteNamedLayout(id: string): boolean {
  const all = listNamedLayouts()
  const next = all.filter((l) => l.id !== id)
  if (next.length === all.length) return false
  saveNamedLayouts(next)
  return true
}

export function getNamedLayout(id: string): NamedLayout | undefined {
  return listNamedLayouts().find((l) => l.id === id)
}
