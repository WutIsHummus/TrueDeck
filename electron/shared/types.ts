export type MemoryScope = 'global' | 'repo'

export interface AgentPreset {
 id: string
 name: string
 command: string
 args: string[]
 color: string
 icon: string
 description?: string
 /** Shell one-liner to install this CLI when missing */
 installCommand?: string
 /** User-defined CLI (not a built-in preset). Kept across merges. */
 custom?: boolean
}

/** Runtime probe: is this agent’s CLI installed? */
export interface AgentProbe {
 id: string
 available: boolean
 resolvedCommand?: string
 resolvedFrom?: string
 installCommand?: string
}

export interface ProjectOnOpenCommand {
 id: string
 label: string
 command: string
 enabled: boolean
}

export interface ProjectConfig {
 id: string
 name: string
 root: string
 lastOpened?: number
 onOpenCommands: ProjectOnOpenCommand[]
 defaultAgents: string[]
 color?: string
}

export type SessionStatus = 'running' | 'exited'

/** Kanban / deck task lifecycle (also stamped on linked sessions for chrome). */
export type TaskStatus = 'backlog' | 'ready' | 'running' | 'review' | 'done' | 'blocked'

export interface SessionInfo {
 id: string
 agentId: string
 agentName: string
 color: string
 projectRoot: string
 status: SessionStatus
 createdAt: number
 title: string
 exitCode?: number
 /** agent = CLI · command = shell command · document = readable text/code/markdown tab */
 kind?: 'agent' | 'command' | 'document'
 /** Shell command for kind === 'command' (used to restore the tab). */
 commandLine?: string
 /** Absolute path for kind === 'document' (plans, markdown, source). */
 documentPath?: string
 /** Board task title (agent chrome / focus). */
 focusTitle?: string
 /** Main idea line for agent chrome (title + summary). */
 focusIdea?: string
 /** Linked deck task id (when launched via dispatch / truedeck_launch). */
 taskId?: string
 /** Linked task status for chrome badge. */
 taskStatus?: TaskStatus
 /** Role label when dispatched with a role. */
 roleLabel?: string
 /** Git branch at spawn (best-effort; chrome may refresh). */
 gitBranch?: string
 /** Short worktree label when isolated. */
 worktreeLabel?: string
 /**
  * CLI conversation / chat id when known (for restore --resume).
  * Optional; most restores fall back to each CLI's --continue / --last.
  */
 resumeToken?: string
 /**
  * UI-only: minimize the tab to a compact chip without killing the PTY.
  * Click the chip (or eye) to restore. Replaces the old "hidden" veil.
  */
 uiMinimized?: boolean
 /** @deprecated use uiMinimized */
 uiHidden?: boolean
}

/** Disk snapshot of open terminal tabs so they survive app restarts. */
export interface SavedSessionTab {
 agentId: string
 agentName: string
 projectRoot: string
 color: string
 kind?: 'agent' | 'command' | 'document'
 commandLine?: string
 /** Absolute path for document tabs. */
 documentPath?: string
 /**
  * Last known OSC / prompt title - used on restore so agents that match by
  * title (e.g. Grok `--resume <title>`) reattach the right conversation.
  */
 title?: string
 /** CLI session / chat id when known (Claude/Cursor/Codex UUID, etc.). */
 resumeToken?: string
 /** Minimized to a chip; paneTree still holds the home group/index. */
 uiMinimized?: boolean
}

/**
 * Nested pane tree saved by index into `tabs` (not live PTY ids).
 * v2 layout field; older files omit this.
 */
export type SavedPaneNode =
 | {
 type: 'leaf'
 /** Indices into SessionLayout.tabs */
 tabIndices: number[]
 activeTabIndex: number | null
 }
 | {
 type: 'split'
 direction: 'row' | 'column'
 ratio: number
 first: SavedPaneNode
 second: SavedPaneNode
 }

export interface SessionLayout {
 /** 1 = flat tabs only · 2 = optional nested paneTree */
 version: 1 | 2
 activeProjectRoot: string | null
 /** Index into `tabs` for the focused session */
 activeIndex: number
 /** Index into `tabs` for the right split pane, or null (legacy) */
 splitIndex: number | null
 splitRatio: number
 tabs: SavedSessionTab[]
 /** Nested studio layout (version 2+) */
 paneTree?: SavedPaneNode | null
 focusedGroupTabIndex?: number | null
 savedAt: number
}

// ── Tasks / runs (BridgeBoard) ──────────────────────────────────────────────

export interface Task {
 id: string
 projectRoot: string
 title: string
 body: string
 status: TaskStatus
 /** Agent preset id: claude | codex | grok | cursor | shell | … */
 assigneeAgentId?: string
 roleId?: string
 sessionId?: string
 worktreePath?: string
 pipelineId?: string
 runIds: string[]
 createdAt: number
 updatedAt: number
}

export interface AgentRun {
 id: string
 taskId?: string
 agentId: string
 agentName: string
 projectRoot: string
 worktreePath?: string
 sessionId?: string
 startedAt: number
 endedAt?: number
 exitCode?: number
 summary?: string
 pipelineRunId?: string
}

export interface PipelineStep {
 id: string
 roleId?: string
 agentId?: string
 promptTemplate: string
 onFail: 'stop' | 'continue' | 'retry'
 isolation?: boolean
}

export interface Pipeline {
 id: string
 name: string
 steps: PipelineStep[]
}

export type PipelineRunStatus =
 | 'running'
 | 'paused'
 | 'done'
 | 'failed'
 | 'cancelled'

export interface PipelineStepRun {
 stepId: string
 taskId?: string
 runId?: string
 sessionId?: string
 status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
}

export interface PipelineRun {
 id: string
 pipelineId: string
 pipelineName: string
 projectRoot: string
 goalTitle: string
 goalBody: string
 status: PipelineRunStatus
 stepIndex: number
 stepRuns: PipelineStepRun[]
 startedAt: number
 endedAt?: number
 error?: string
}

/** Named studio layout preset (pane tree by role labels, not live PTY ids). */
export interface NamedLayout {
 id: string
 name: string
 /** e.g. 1x1, 1x2, 2x2, 2x3, 4x4 */
 preset?: string
 paneTree: SavedPaneNode | null
 /** Optional agent ids to spawn into tab order */
 fillAgentIds?: string[]
 savedAt: number
}

export interface GitReviewFile {
 path: string
 status: string
}

export interface GitReviewSnapshot {
 projectRoot: string
 branch: string | null
 files: GitReviewFile[]
 diff: string
 clean: boolean
 error?: string
}

/** Optional isolation flag on create/dispatch */
export type TaskIsolation = boolean

export interface MemoryNote {
 id: string
 path: string
 relativePath: string
 title: string
 content: string
 mtime: number
 scope?: MemoryScope
}

export type LayoutMode = 'tabs' | 'grid'

/** Built-in or user-added memory backends (MemPalace, OpenMemory, custom MCP, files). */
export type MemoryProviderKind =
 | 'truememory'
 | 'mempalace'
 | 'openmemory'
 | 'custom-mcp'

export interface MemoryProviderConfig {
 id: string
 kind: MemoryProviderKind
 name: string
 /** User can turn backends on/off without uninstalling */
 enabled: boolean
 description?: string
 /** stdio MCP command (not used for pure file TrueMemory) */
 command?: string
 args?: string[]
 env?: Record<string, string>
 /** Optional palace / data path */
 dataPath?: string
 /** Prefer native over docker for kinds that support both */
 preferNative?: boolean
 /** Never use Docker even if present */
 noDocker?: boolean
}

export interface MemoryProviderStatus {
 id: string
 kind: MemoryProviderKind
 name: string
 enabled: boolean
 ready: boolean
 mode: 'files' | 'native' | 'mcp' | 'docker' | 'missing' | 'disabled'
 message: string
 version?: string
 mcp?: {
 command: string
 args: string[]
 }
}

export interface AppSettings {
 injectMemoryOnAgentStart: boolean
 theme: 'dark' | 'light'
 fontSize: number
 layoutMode: LayoutMode
 /** When true, opening a project auto-switches to grid if 2+ panes */
 autoGrid: boolean
 /** Show Grok/Codex/Cursor/Claude chips in the title bar */
 showQuickAgents: boolean
 /** Restore last project on launch */
 reopenLastProject: boolean
 /** Preferred coding CLI - used for onboarding + default palette focus */
 preferredAgentId?: string
 /**
 * Agent CLIs that should always receive MCP + memory wiring.
 * Default = all known coding agents (not shell). Empty/undefined → all.
 */
 syncedAgentIds?: string[]
 /**
 * MemPalace (or compatible) data directory. Agents get this wired via MCP
 * and env; users pick it once during onboarding.
 */
 palacePath?: string
 /**
 * Memory backends. TrueMemory (files) is always present.
 * MemPalace defaults to native (no Docker).
 * Add OpenMemory / custom MCP from the UI.
 */
 memoryProviders: MemoryProviderConfig[]
 /** Soft max agent panes (hard cap still 16). Default 16. */
 maxPanes?: number
 /** When dispatching a task, create a git worktree (Phase 3). Default false until ready. */
 worktreeIsolationDefault?: boolean
 /**
 * Experimental: wrap agent CLIs in nested in-PTY frame (truedeck-frame.mjs).
 * Default **false** - full-screen TUIs (Grok) redraw over in-band headers.
 * Prefer the Electron agent chrome bar above the terminal.
 */
 agentFrameTui?: boolean
 /** Also wrap plain shell panes when agentFrameTui is on. Default false. */
 frameShellPanes?: boolean
 /**
 * When true (default), file paths printed by agent CLIs are clickable and
 * open in Document view (local files). HTTP(S) opens in the OS browser.
 * Toggle on Settings → MCP.
 */
 openCliPathsInDocument?: boolean
 /** Monaco Document editor: Vim keybindings (monaco-vim). Default false. */
 editorVimMode?: boolean
 /** Show project file explorer sidebar. Default true when a project is open. */
 showProjectExplorer?: boolean
 /**
 * @deprecated Graphify runs fully automatic under the hood (no user UI).
 * Kept for settings JSON compatibility only.
 */
 graphifyEnabled?: boolean
 /** @deprecated Automatic; ignored by graphify-service. */
 graphifyOnProjectOpen?: 'off' | 'if-missing' | 'always-update'
 /** @deprecated Reserved; not user-facing. */
 graphifyWatch?: boolean
}

/** Board / pipeline persona (BridgeSpace-style role). */
export interface AgentRole {
 id: string
 label: string
 /** Default agent CLI id (claude, codex, grok, shell, …) */
 agentId: string
 color: string
 /** Seeded into task file / dispatch prompt */
 prefixPrompt: string
}

/** Graphify project knowledge-graph status. */
export interface GraphifyStatus {
 projectRoot: string
 available: boolean
 ready: boolean
 stale: boolean
 building: boolean
 lastSyncAt: number | null
 nodeCount?: number
 edgeCount?: number
 error?: string
 graphJsonPath?: string
 reportPath?: string
 htmlPath?: string
 detail: string
}

/** Detected or user-chosen memory space (palace / .memory tree). */
export interface MemorySpaceInfo {
 id: string
 label: string
 path: string
 kind: 'palace' | 'repo-memory' | 'global-memory' | 'custom'
 exists: boolean
 detail?: string
}

export interface AgentMemoryInjectResult {
 agentId: string
 ok: boolean
 filesWritten: string[]
 message: string
}

/**
 * Backend context pipeline for a project (automatic — not a user dashboard).
 * Memory, MCP, and project context are handled under the hood.
 */
export type ProjectSetupCheckId =
 | 'auto_context'
 | 'memory_backend'
 | 'mcp_wired'
 | 'cli_inject'
 | 'palace_index'

export interface ProjectSetupCheck {
 id: ProjectSetupCheckId
 label: string
 ok: boolean
 detail?: string
}

export interface ProjectSetupStatus {
 projectRoot: string
 /**
  * True when agents can work: MCP wired, auto-context present, memory backend
  * paths ready, inject done. Palace mine may still warm in the background.
  */
 ready: boolean
 /** Soft: palace/graph still indexing — user can already code */
 warming: boolean
 /** Short status for title bar (empty when quiet) */
 label: string
 detail: string
 missing: string[]
 checks: ProjectSetupCheck[]
 lastSetupAt?: number
 pendingOpenAgents?: string[]
 needsOpenInject?: boolean
}

export interface ProjectSetupResult {
 status: ProjectSetupStatus
 inject?: AgentMemoryInjectResult
}
