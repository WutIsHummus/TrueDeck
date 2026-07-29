/**
 * Pipeline definitions (BridgeSwarm-lite recipes).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getGlobalDataDir } from './paths'
import type { Pipeline, PipelineStep } from '../shared/types'

const STORE = (): string => join(getGlobalDataDir(), 'pipelines.json')

function defaultPipelines(): Pipeline[] {
 const mk = (
 id: string,
 name: string,
 steps: Array<Omit<PipelineStep, 'id'> & { id?: string }>
 ): Pipeline => ({
 id,
 name,
 steps: steps.map((s, i) => ({
 id: s.id || `${id}-s${i}`,
 roleId: s.roleId,
 agentId: s.agentId,
 promptTemplate: s.promptTemplate,
 onFail: s.onFail || 'stop',
 isolation: s.isolation
 }))
 })

 return [
 mk('feature', 'Feature', [
 {
 roleId: 'implementer',
 promptTemplate:
 'Implement the feature described below.\n\nTitle: {{title}}\n\n{{body}}\n\nProject: {{repo}}',
 onFail: 'stop',
 isolation: true
 },
 {
 roleId: 'reviewer',
 promptTemplate:
 'Review the implementer\'s work for "{{title}}".\n\nOriginal request:\n{{body}}\n\nList blockers first, then nits. Project: {{repo}}',
 onFail: 'stop'
 }
 ]),
 mk('bugfix', 'Bugfix', [
 {
 roleId: 'explorer',
 promptTemplate:
 'Investigate the bug. Do not fix yet - report root cause and files.\n\n{{title}}\n\n{{body}}',
 onFail: 'stop'
 },
 {
 roleId: 'implementer',
 promptTemplate:
 'Fix the bug based on investigation context.\n\n{{title}}\n\n{{body}}',
 onFail: 'stop',
 isolation: true
 },
 {
 roleId: 'tester',
 agentId: 'shell',
 promptTemplate:
 'Verify the fix for "{{title}}". Run relevant tests/commands and report pass/fail.\n\n{{body}}',
 onFail: 'continue'
 }
 ]),
 mk('docs', 'Docs', [
 {
 roleId: 'explorer',
 promptTemplate: 'Explore what needs documenting: {{title}}\n\n{{body}}',
 onFail: 'stop'
 },
 {
 roleId: 'docs',
 promptTemplate: 'Write/update docs for: {{title}}\n\n{{body}}\n\nRepo: {{repo}}',
 onFail: 'stop'
 }
 ]),
 mk('graph-aware', 'Graph-aware explore → implement', [
 {
 roleId: 'explorer',
 promptTemplate:
 'Explore using architecture context (see auto-context / graphify-out if present).\n\n{{title}}\n\n{{body}}',
 onFail: 'stop'
 },
 {
 roleId: 'implementer',
 promptTemplate: 'Implement based on exploration:\n\n{{title}}\n\n{{body}}',
 onFail: 'stop',
 isolation: true
 }
 ])
 ]
}

export function listPipelines(): Pipeline[] {
 try {
 if (!existsSync(STORE())) {
 const d = defaultPipelines()
 savePipelines(d)
 return d
 }
 const raw = JSON.parse(readFileSync(STORE(), 'utf8')) as Pipeline[]
 if (!Array.isArray(raw) || !raw.length) return defaultPipelines()
 return raw
 } catch {
 return defaultPipelines()
 }
}

export function getPipeline(id: string): Pipeline | undefined {
 return listPipelines().find((p) => p.id === id)
}

export function savePipelines(list: Pipeline[]): Pipeline[] {
 const path = STORE()
 mkdirSync(dirname(path), { recursive: true })
 writeFileSync(path, JSON.stringify(list, null, 2), 'utf8')
 return list
}

export function renderPrompt(
 template: string,
 vars: { title: string; body: string; repo: string }
): string {
 return template
 .replace(/\{\{title\}\}/g, vars.title)
 .replace(/\{\{body\}\}/g, vars.body)
 .replace(/\{\{repo\}\}/g, vars.repo)
}

export function newPipelineRunId(): string {
 return randomUUID()
}
