#!/usr/bin/env bun

import type { AppState } from '../../src/state/AppState.js'
import type { TaskStateBase } from '../../src/Task.js'
import {
  canTransitionTaskLifecycle,
  deriveTaskLifecycleStatus,
  guardTaskLifecycleTransition,
  isTerminalTaskLifecycleStatus,
  normalizeTaskLifecycle,
  type TaskLifecycleStatus,
} from '../../src/tasks/stateMachine.js'
import { updateTaskState } from '../../src/utils/task/framework.js'
import { assert, assertEqual } from './assertions.js'

const baseTask: TaskStateBase = {
  id: 'a-state',
  type: 'local_agent',
  status: 'pending',
  lifecycleStatus: 'queued',
  description: 'state validation',
  startTime: 1,
  outputFile: 'unused',
  outputOffset: 0,
  notified: false,
}

const expectedDerivations: Array<[
  Partial<TaskStateBase> & {
    awaitingPlanApproval?: boolean
    isIdle?: boolean
  },
  TaskLifecycleStatus,
]> = [
  [{ status: 'pending' }, 'queued'],
  [{ status: 'running' }, 'running'],
  [{ status: 'running', waitingForPermission: true }, 'waiting_permission'],
  [{ status: 'running', awaitingPlanApproval: true }, 'waiting_permission'],
  [{ status: 'running', isIdle: true }, 'idle'],
  [{ status: 'completed', waitingForPermission: true }, 'completed'],
  [{ status: 'failed', isIdle: true }, 'failed'],
  [{ status: 'killed' }, 'stopped'],
]

for (const [patch, expected] of expectedDerivations) {
  assertEqual(
    deriveTaskLifecycleStatus({ ...baseTask, ...patch }),
    expected,
    `derive ${JSON.stringify(patch)}`,
  )
}

const allowedTransitions: Array<[TaskLifecycleStatus, TaskLifecycleStatus]> = [
  ['queued', 'running'],
  ['running', 'waiting_permission'],
  ['waiting_permission', 'running'],
  ['running', 'idle'],
  ['idle', 'running'],
  ['running', 'completed'],
  ['running', 'failed'],
  ['running', 'stopped'],
  ['waiting_permission', 'cancelled'],
]
for (const [from, to] of allowedTransitions) {
  assert(
    canTransitionTaskLifecycle(from, to),
    `${from} -> ${to} should be allowed`,
  )
}

for (const terminal of [
  'completed',
  'failed',
  'stopped',
  'cancelled',
] satisfies TaskLifecycleStatus[]) {
  assert(isTerminalTaskLifecycleStatus(terminal), `${terminal} is terminal`)
  for (const next of [
    'queued',
    'running',
    'waiting_permission',
    'idle',
    'completed',
    'failed',
    'stopped',
    'cancelled',
  ] satisfies TaskLifecycleStatus[]) {
    assertEqual(
      canTransitionTaskLifecycle(terminal, next),
      terminal === next,
      `${terminal} must not be overwritten by ${next}`,
    )
  }
}

const running = normalizeTaskLifecycle({
  ...baseTask,
  status: 'running' as const,
})
const waiting = guardTaskLifecycleTransition(running, {
  ...running,
  waitingForPermission: true,
})
assertEqual(waiting.lifecycleStatus, 'waiting_permission', 'permission wait')

const resumed = guardTaskLifecycleTransition(waiting, {
  ...waiting,
  waitingForPermission: false,
})
assertEqual(resumed.lifecycleStatus, 'running', 'permission resume')

const idle = guardTaskLifecycleTransition(resumed, {
  ...resumed,
  isIdle: true,
})
assertEqual(idle.lifecycleStatus, 'idle', 'team idle')

const completed = guardTaskLifecycleTransition(idle, {
  ...idle,
  status: 'completed',
})
assertEqual(completed.lifecycleStatus, 'completed', 'team completion')

const lateFailure = guardTaskLifecycleTransition(completed, {
  ...completed,
  status: 'failed',
})
assert(lateFailure === completed, 'late terminal callback must be ignored')

// Exercise the AppState integration, not only the pure transition table.
let state = {
  tasks: {
    [baseTask.id]: completed,
  },
} as unknown as AppState
const setAppState = (updater: (previous: AppState) => AppState): void => {
  state = updater(state)
}

updateTaskState(
  baseTask.id,
  setAppState,
  task => ({ ...task, status: 'failed' }),
)
assertEqual(
  state.tasks[baseTask.id]?.status,
  'completed',
  'framework rejects late terminal overwrite',
)

updateTaskState(baseTask.id, setAppState, task => ({
  ...task,
  notified: true,
}))
assertEqual(
  state.tasks[baseTask.id]?.notified,
  true,
  'same-terminal metadata updates remain allowed',
)

console.log('agent state machine validation passed')
