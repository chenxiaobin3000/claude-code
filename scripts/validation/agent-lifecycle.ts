#!/usr/bin/env bun

import {
  assertAgentResumeAllowed,
  getAgentResumeBlockReason,
} from '../../src/utils/agentLifecycle.js'
import { assert, assertEqual } from './assertions.js'

assertEqual(
  getAgentResumeBlockReason({ runtimeStatus: 'running' }),
  'already_running',
  'running Agent cannot be registered twice',
)
assertEqual(
  getAgentResumeBlockReason({ runtimeStatus: 'killed' }),
  'permanently_stopped',
  'runtime stop is permanent',
)
assertEqual(
  getAgentResumeBlockReason({ durableStatus: 'stopped' }),
  'permanently_stopped',
  'durable stop survives task eviction and restart',
)
for (const status of ['completed', 'failed'] as const) {
  assertEqual(
    getAgentResumeBlockReason({
      runtimeStatus: status,
      durableStatus: status,
    }),
    null,
    `${status} Agent accepts an explicit continuation`,
  )
}

let stoppedMessage = ''
try {
  assertAgentResumeAllowed('a-validation', {
    durableStatus: 'stopped',
  })
} catch (error) {
  stoppedMessage = error instanceof Error ? error.message : String(error)
}
assert(
  stoppedMessage.includes('permanently stopped'),
  'stopped resume error must explain the permanent terminal state',
)

const projectRoot = new URL('../../', import.meta.url)
const localAgentSource = await Bun.file(
  new URL('src/tasks/LocalAgentTask/LocalAgentTask.tsx', projectRoot),
).text()
const lifecycleSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/agentToolUtils.ts',
    projectRoot,
  ),
).text()
const backgroundTransitionSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
    projectRoot,
  ),
).text()

for (const status of ['running', 'completed', 'failed', 'stopped']) {
  assert(
    localAgentSource.includes(`'${status}'`),
    `Local Agent lifecycle must persist ${status}`,
  )
}
assert(
  lifecycleSource.includes('if (completedResult)'),
  'post-completion errors must retain completed terminal state',
)
assert(
  backgroundTransitionSource.includes('if (completedAgentResult)'),
  'foreground-to-background completion must retain completed terminal state',
)

console.log('agent lifecycle validation passed')
