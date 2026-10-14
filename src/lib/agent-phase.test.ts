import assert from 'node:assert/strict'
import {
  canTakeTask,
  classifyAgentTail,
  formatWorkingElapsed,
  QUIET_DONE_MS,
  resolveAgentPhase
} from './agent-phase'

const pad = 'line\n'.repeat(40)

assert.equal(classifyAgentTail('claude', 'esc to interrupt'), 'working')
assert.equal(
  classifyAgentTail('claude', `esc to interrupt\n${pad}Cooked for 3m 12s\n❯ `),
  'done'
)
assert.equal(
  classifyAgentTail('claude', `Cooked for 3m 12s\n${pad}esc to interrupt`),
  'working'
)
assert.equal(classifyAgentTail('claude', 'Do you want to allow this edit?'), 'waiting')
assert.equal(classifyAgentTail('claude', ''), 'unknown')

assert.equal(classifyAgentTail('codex', '• Working (4s • esc to interrupt)'), 'working')
assert.equal(
  classifyAgentTail('codex', `esc to interrupt\n${pad}Worked for 1m 05s\n› Ask Codex to do anything`),
  'done'
)

assert.equal(classifyAgentTail('gemini', 'esc to cancel'), 'working')
assert.equal(classifyAgentTail('gemini', `${pad}Type your message`), 'done')

assert.equal(classifyAgentTail('cursor', `${pad}Add a follow-up`), 'done')
assert.equal(classifyAgentTail('grok', 'Thinking…'), 'working')

assert.equal(
  resolveAgentPhase({ signal: 'working', sawWork: true, quietMs: 1_000 }),
  'working'
)
assert.equal(
  resolveAgentPhase({ signal: 'working', sawWork: true, quietMs: QUIET_DONE_MS }),
  'done'
)
assert.equal(
  resolveAgentPhase({ signal: 'done', sawWork: true, quietMs: 200, wasWorking: true }),
  'working'
)
assert.equal(
  resolveAgentPhase({ signal: 'done', sawWork: true, quietMs: 200, wasWorking: false }),
  'done'
)
assert.equal(
  resolveAgentPhase({ signal: 'done', sawWork: true, quietMs: 2_000, wasWorking: true }),
  'done'
)
assert.equal(formatWorkingElapsed(72_000), '1m 12s')
assert.equal(
  resolveAgentPhase({ signal: 'unknown', sawWork: true, quietMs: 2_000 }),
  'working'
)
assert.equal(
  resolveAgentPhase({ signal: 'unknown', sawWork: true, quietMs: QUIET_DONE_MS }),
  'done'
)
assert.equal(
  resolveAgentPhase({ signal: 'unknown', sawWork: false, quietMs: QUIET_DONE_MS }),
  'starting'
)
assert.equal(
  resolveAgentPhase({ signal: 'waiting', sawWork: true, quietMs: QUIET_DONE_MS }),
  'waiting'
)
assert.equal(canTakeTask('done'), true)
assert.equal(canTakeTask('starting'), true)
assert.equal(canTakeTask('working'), false)
assert.equal(canTakeTask('waiting'), false)

console.log('agent-phase ok')
