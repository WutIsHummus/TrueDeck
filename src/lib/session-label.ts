import type { SessionInfo } from '../../electron/shared/types'

function basename(p: string): string {
 const n = (p || '').replace(/\\/g, '/').split('/').filter(Boolean)
 return n[n.length - 1] || p || ''
}

function truncate(s: string, max: number): string {
 const t = s.replace(/\s+/g, ' ').trim()
 if (t.length <= max) return t
 return t.slice(0, Math.max(1, max - 1)) + '…'
}

/** Strip product fluff so "Claude Code" ≈ "Claude", "Cursor Agent" ≈ "Cursor". */
function normalizeProductName(s: string): string {
 return s
 .toLowerCase()
 .replace(/[^a-z0-9]+/g, ' ')
 .replace(/\b(code|cli|agent|session|app|ide|terminal|assistant)\b/g, ' ')
 .replace(/\s+/g, ' ')
 .trim()
}

/**
 * True when `text` is just the agent / product restated
 * (e.g. agent "Claude" + title "Claude Code").
 */
export function isAgentNameVariant(
 text: string | null | undefined,
 agentName: string | null | undefined,
 agentId?: string | null
): boolean {
 const t = (text || '').trim()
 if (!t) return true
 const names = [agentName, agentId].map((x) => (x || '').trim()).filter(Boolean)
 for (const n of names) {
 if (t.toLowerCase() === n.toLowerCase()) return true
 const nt = normalizeProductName(t)
 const nn = normalizeProductName(n)
 if (!nt || !nn) continue
 if (nt === nn) return true
 // short brand prefix: "claude" inside "claude code v2…" after normalize
 if (nt.startsWith(nn) || nn.startsWith(nt)) return true
 }
 return false
}

/**
 * True when text looks like it contains credentials / tokens.
 * Used so tabs and the title bar never display leaked API keys.
 */
export function looksLikeSecret(text: string | null | undefined): boolean {
 const t = (text || '').trim()
 if (!t) return false

 // Common vendor key prefixes
 if (
 /\b(sk-[a-z0-9_\-]{10,}|sk-ant-[a-z0-9_\-]{10,}|sk-proj-[a-z0-9_\-]{10,})\b/i.test(t)
 ) {
 return true
 }
 if (/\b(ghp_|gho_|github_pat_|xox[baprs]-|AIza)[a-zA-Z0-9_\-]{8,}\b/.test(t)) {
 return true
 }
 // env-style KEY=value or --api-key value
 if (
 /\b([A-Z][A-Z0-9_]{2,}_)?(API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET[_-]?KEY|AUTH[_-]?TOKEN|PASSWORD|CURSOR_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*[=:]\s*\S+/i.test(
 t
 )
 ) {
 return true
 }
 if (/--(api-?key|token|secret|password|auth)\b/i.test(t) && /\S{12,}/.test(t)) {
 return true
 }
 // Bearer / Authorization headers
 if (/\b(bearer|authorization)\s+\S{12,}/i.test(t)) return true
 // Long high-entropy token alone (e.g. 32+ alnum with mixed case)
 if (/^[A-Za-z0-9_\-+/=]{32,}$/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t)) {
 return true
 }
 // key-ish substring anywhere
 if (/\bapi[_-]?key\b/i.test(t) && /[A-Za-z0-9_\-]{16,}/.test(t)) return true

 return false
}

/**
 * OSC / shell titles that should never replace the agent tab label
 * (e.g. Grok/cmd setting the window title to C:\WINDOWS\system32\cmd.exe,
 * or Cursor putting credentials in the process title).
 */
export function isNoiseTerminalTitle(text: string | null | undefined): boolean {
 const t = (text || '').trim()
 if (!t) return true
 if (looksLikeSecret(t)) return true
 const lower = t.toLowerCase()

 // Absolute / UNC / drive paths
 if (/^[a-z]:[\\/]/i.test(t)) return true
 if (t.startsWith('\\\\') || t.startsWith('//')) return true
 if (t.startsWith('~/') || t.startsWith('~\\')) return true
 if ((t.includes('\\') || t.startsWith('/')) && (t.includes('/') || t.includes('\\'))) {
 // path-like with separators - not a human session name
 if (/\.(exe|cmd|bat|ps1|sh)(\s|$)/i.test(t)) return true
 if (/system32|windows\\system|program files|users\\/i.test(t)) return true
 }

 // Common shell process names alone
 if (
 /^(cmd\.exe|powershell\.exe|pwsh\.exe|bash|zsh|fish|sh|login)(\s|$)/i.test(lower) ||
 lower === 'cmd' ||
 lower === 'powershell' ||
 lower === 'pwsh'
 ) {
 return true
 }

 return false
}

/** Title useful for tab / chrome (not agent alias, not path noise, not secrets). */
export function isUsefulSessionTitle(
 text: string,
 agentName?: string | null,
 agentId?: string | null
): boolean {
 if (!text.trim()) return false
 if (isNoiseTerminalTitle(text)) return false
 if (isAgentNameVariant(text, agentName, agentId)) return false
 return true
}

/**
 * Safe title for UI: drop secrets/noise; empty means “keep agent name”.
 */
export function sanitizeSessionTitle(text: string | null | undefined): string {
 const t = String(text || '')
 .replace(/\s+/g, ' ')
 .trim()
 .slice(0, 120)
 if (!t || isNoiseTerminalTitle(t) || looksLikeSecret(t)) return ''
 return t
}

/**
 * Compact label for the tab strip - what this tab is about.
 * Board tasks use the task title; free agents stay as the agent name;
 * never show raw cmd.exe / C:\WINDOWS paths as the tab name.
 */
export function sessionTabLabel(s: SessionInfo, max = 28): string {
 const agent = (s.agentName || s.agentId || 'tab').trim()

 // Deck task / dispatch title
 if (s.taskId) {
 const focus = (s.focusTitle || '').trim()
 if (focus && isUsefulSessionTitle(focus, s.agentName, s.agentId)) {
 return truncate(focus, max)
 }
 }

 const idea = (s.focusIdea || '').trim()
 if (idea && isUsefulSessionTitle(idea, s.agentName, s.agentId)) {
 return truncate(idea, max)
 }

 // Free agent CLI: ignore OSC session.title - Codex/Cursor rewrite it during
 // startup and make tabs/header flicker.
 if (s.kind !== 'command') {
 return truncate(agent, max)
 }

 if (s.commandLine?.trim()) {
 const line = s.commandLine.trim()
 if (isNoiseTerminalTitle(line)) {
 const base = basename(line.replace(/\s+.*/, ''))
 if (base && !isNoiseTerminalTitle(base)) return truncate(base, max)
 return truncate(agent, max)
 }
 return truncate(line, max)
 }

 return truncate(agent, max)
}

/**
 * Main idea line for Electron agent chrome (per-tab, not project-wide).
 * Empty when there is nothing meaningful beyond the agent name.
 */
export function sessionIdeaLine(s: SessionInfo, max = 160): string {
 const agent = (s.agentName || s.agentId || 'Agent').trim()
 const proj = basename(s.projectRoot || '')

 const idea = (s.focusIdea || '').trim()
 if (idea && isUsefulSessionTitle(idea, s.agentName, s.agentId)) {
 return truncate(idea, max)
 }

 const focus = (s.focusTitle || '').trim()
 if (focus && isUsefulSessionTitle(focus, s.agentName, s.agentId)) {
 return truncate(focus, max)
 }

 // OSC / terminal title only if it's a real session name (not path / cmd.exe)
 const title = (s.title || '').trim()
 if (title && isUsefulSessionTitle(title, s.agentName, s.agentId)) {
 return truncate(title, max)
 }

 if (s.kind === 'command' && s.commandLine?.trim()) {
 return truncate(s.commandLine.trim(), max)
 }

 // No redundant "Claude · TrueDeck" - chrome already shows agent + project
 void proj
 void agent
 return ''
}

/** Tooltip / full title for a tab. */
export function sessionTabTitle(s: SessionInfo): string {
 const parts = [
 sessionTabLabel(s, 80),
 s.agentName && sessionTabLabel(s, 80) !== s.agentName ? s.agentName : '',
 s.status === 'exited' ? 'exited' : ''
 ].filter(Boolean)
 return parts.join(' · ')
}
