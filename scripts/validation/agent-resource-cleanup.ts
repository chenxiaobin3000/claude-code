#!/usr/bin/env bun

import { assert } from './assertions.js'

const projectRoot = new URL('../../', import.meta.url)
const agentToolSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
    projectRoot,
  ),
).text()
const asyncLifecycleSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/agentToolUtils.ts',
    projectRoot,
  ),
).text()
const localAgentSource = await Bun.file(
  new URL('src/tasks/LocalAgentTask/LocalAgentTask.tsx', projectRoot),
).text()
const sessionStorageSource = await Bun.file(
  new URL('src/utils/sessionStorageRuntime.ts', projectRoot),
).text()

assert(
  asyncLifecycleSource.includes(
    'onFinished?.(getTokenCountFromTracker(tracker))',
  ),
  'async lifecycle must release its budget reservation in finally',
)
assert(
  agentToolSource.includes(
    'executionReservation.release(backgroundTokensUsed)',
  ) &&
    agentToolSource.includes(
      'executionReservation.release(foregroundTokensUsed)',
    ),
  'foreground and transitioned background Agents must release reservations',
)
assert(
  localAgentSource.includes('task.unregisterCleanup?.()'),
  'every terminal Agent transition must unregister process cleanup',
)
assert(
  agentToolSource.includes('cleanupWorktreeIfNeeded()') &&
    asyncLifecycleSource.includes('getWorktreeResult()'),
  'success, failure, and cancellation paths must attempt worktree cleanup',
)
assert(
  sessionStorageSource.includes('agentLifecycleWrites') &&
    sessionStorageSource.includes("status: AgentLifecycleStatus"),
  'lifecycle writes must serialize permanent stop persistence',
)

console.log('agent resource cleanup validation passed')
