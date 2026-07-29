#!/usr/bin/env bun

import {
  DEFAULT_BACKGROUND_PERMISSION_TIMEOUT_MS,
  isBackgroundAgentPermission,
  resolveBackgroundPermissionTimeoutMs,
} from '../../src/utils/backgroundPermission.js'
import type { ToolUseContext } from '../../src/Tool.js'
import { assert, assertEqual } from './assertions.js'

assertEqual(
  resolveBackgroundPermissionTimeoutMs({}),
  DEFAULT_BACKGROUND_PERMISSION_TIMEOUT_MS,
  'default background permission timeout',
)
assertEqual(
  resolveBackgroundPermissionTimeoutMs({
    CLAUDE_CODE_BACKGROUND_PERMISSION_TIMEOUT_MS: '45000',
  }),
  45_000,
  'configured background permission timeout',
)
let invalidMessage = ''
try {
  resolveBackgroundPermissionTimeoutMs({
    CLAUDE_CODE_BACKGROUND_PERMISSION_TIMEOUT_MS: '0',
  })
} catch (error) {
  invalidMessage = error instanceof Error ? error.message : String(error)
}
assert(
  invalidMessage.includes('positive integer'),
  'invalid permission timeout must fail explicitly',
)

const fakeContext = {
  agentId: 'a-validation',
  getAppState: () => ({
    tasks: {
      'a-validation': {
        type: 'local_agent',
        isBackgrounded: true,
      },
    },
  }),
} as unknown as ToolUseContext
assertEqual(
  isBackgroundAgentPermission(fakeContext),
  true,
  'background Agent permission detection',
)

const projectRoot = new URL('../../', import.meta.url)
const agentToolSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
    projectRoot,
  ),
).text()
const resumeSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts',
    projectRoot,
  ),
).text()
const canUseToolSource = await Bun.file(
  new URL('src/hooks/useCanUseTool.tsx', projectRoot),
).text()
const interactiveSource = await Bun.file(
  new URL(
    'src/hooks/toolPermission/handlers/interactiveHandler.ts',
    projectRoot,
  ),
).text()

for (const [name, source] of [
  ['spawn', agentToolSource],
  ['resume', resumeSource],
] as const) {
  assert(
    source.includes(
      '!toolUseContext.options.isNonInteractiveSession',
    ),
    `${name} must relay permissions only in interactive sessions`,
  )
}
assert(
  canUseToolSource.includes('setAgentPermissionPending(toolUseContext, true)'),
  'permission request must expose waiting state',
)
assert(
  interactiveSource.includes('workerBadge:'),
  'permission dialog must identify its Agent source',
)
assert(
  interactiveSource.includes('Background agent permission request timed out'),
  'unattended background permission must have a bounded timeout',
)

console.log('agent permission relay validation passed')
