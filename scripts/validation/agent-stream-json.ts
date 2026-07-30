#!/usr/bin/env bun

import { setIsInteractive } from '../../src/bootstrap/state.js'
import {
  drainSdkEvents,
  emitNestedAgentStreamEvent,
  enqueueSdkEvent,
} from '../../src/utils/sdkEventQueue.js'
import { assert, assertEqual } from './assertions.js'

const projectRoot = new URL('../../', import.meta.url)
const runAgentSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
    projectRoot,
  ),
).text()
const queryEngineSource = await Bun.file(
  new URL('src/QueryEngine.ts', projectRoot),
).text()
const schemaSource = await Bun.file(
  new URL('src/entrypoints/sdk/coreSchemas.ts', projectRoot),
).text()
const printSource = await Bun.file(
  new URL('src/cli/print.ts', projectRoot),
).text()

assert(
  runAgentSource.includes(
    'includePartialMessages: toolUseContext.options.includePartialMessages',
  ) &&
    runAgentSource.includes('emitNestedAgentStreamEvent({') &&
    runAgentSource.includes('parentToolUseId: toolUseContext.toolUseId') &&
    runAgentSource.includes('agentId,'),
  'nested Agent partial events must inherit opt-in and retain parent and Agent IDs',
)
assert(
  queryEngineSource.includes('isNonInteractiveSession: true,') &&
    queryEngineSource.includes('includePartialMessages,'),
  'QueryEngine must thread partial-message opt-in into tool context',
)
assert(
  schemaSource.includes('agent_id: z.string().optional()'),
  'partial SDK event schema must expose the nested Agent ID',
)
assert(
  printSource.includes(
    '// Flush pending SDK events so they appear before result on the stream.',
  ) &&
    printSource.includes(
      '// Drain SDK events (task_started, task_progress) before command queue',
    ),
  'SDK event drain order must preserve progress and terminal bookends',
)

setIsInteractive(false)
drainSdkEvents()
emitNestedAgentStreamEvent({
  event: { type: 'content_block_delta', delta: { type: 'text_delta' } },
  parentToolUseId: 'tool-parent',
  agentId: 'agent-child',
})
const [partial] = drainSdkEvents()
assertEqual(partial?.type, 'stream_event', 'nested partial event was not queued')
if (partial?.type === 'stream_event') {
  assertEqual(
    partial.parent_tool_use_id,
    'tool-parent',
    'nested partial event lost parent Tool Use ID',
  )
  assertEqual(
    partial.agent_id,
    'agent-child',
    'nested partial event lost Agent ID',
  )
}

for (let index = 0; index < 1000; index++) {
  emitNestedAgentStreamEvent({
    event: { type: 'content_block_delta', index },
    parentToolUseId: 'tool-parent',
    agentId: 'agent-child',
  })
}
enqueueSdkEvent({
  type: 'system',
  subtype: 'session_state_changed',
  state: 'idle',
})
const saturated = drainSdkEvents()
assert(
  saturated.some(
    event =>
      event.type === 'system' &&
      event.subtype === 'session_state_changed' &&
      event.state === 'idle',
  ),
  'partial-event backpressure must not evict lifecycle events',
)

setIsInteractive(true)
console.log('agent stream-json validation passed')
