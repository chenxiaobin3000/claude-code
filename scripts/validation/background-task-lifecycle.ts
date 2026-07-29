#!/usr/bin/env bun

import {
  ASSISTANT_SHELL_BLOCKING_BUDGET_MS,
  SHELL_PROGRESS_THRESHOLD_MS,
} from '../../src/utils/task/backgroundPolicy.js'
import { findSession } from '../../src/cli/bg.js'
import { assert, assertEqual } from './assertions.js'

assertEqual(
  SHELL_PROGRESS_THRESHOLD_MS,
  2_000,
  'Shell progress/background affordance threshold',
)
assertEqual(
  ASSISTANT_SHELL_BLOCKING_BUDGET_MS,
  15_000,
  'assistant Shell blocking budget',
)

const sessions = [
  {
    pid: 321,
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: '/workspace',
    startedAt: 1,
    kind: 'bg',
    name: 'named-session',
  },
]
assertEqual(
  findSession(sessions, sessions[0]!.sessionId),
  sessions[0],
  'session lookup by UUID',
)
assertEqual(findSession(sessions, '321'), sessions[0], 'session lookup by PID')
assertEqual(
  findSession(sessions, 'named-session'),
  sessions[0],
  'session lookup by name',
)

const root = new URL('../../', import.meta.url)
const bash = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/BashTool/BashTool.tsx',
    root,
  ),
).text()
const powershell = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.tsx',
    root,
  ),
).text()
for (const [name, source] of [
  ['Bash', bash],
  ['PowerShell', powershell],
] as const) {
  assert(
    source.includes('SHELL_PROGRESS_THRESHOLD_MS') &&
      source.includes('ASSISTANT_SHELL_BLOCKING_BUDGET_MS'),
    `${name} must use the shared background timing policy`,
  )
  assert(
    source.includes('backgroundExistingForegroundTask'),
    `${name} must preserve the existing process when moving to background`,
  )
}

const mcp = await Bun.file(
  new URL('src/tasks/MonitorMcpTask/MonitorMcpTask.ts', root),
).text()
assert(
  mcp.includes('registerCleanup') &&
    mcp.includes('abortController?.abort()') &&
    mcp.includes('unregisterCleanup') &&
    mcp.includes('enqueueMonitorNotification') &&
    mcp.includes('if (!transitioned) return'),
  'MCP monitor terminal handling must be idempotent, notify, abort, and unregister cleanup',
)

const concurrent = await Bun.file(
  new URL('src/utils/concurrentSessions.ts', root),
).text()
assert(
  concurrent.includes('CLAUDE_CODE_SESSION_ENGINE') &&
    concurrent.includes('CLAUDE_CODE_TMUX_SESSION'),
  'background registry must persist the engine required by attach/detach',
)

console.log('background task lifecycle validation passed')
