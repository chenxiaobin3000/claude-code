/**
 * Canonical lifecycle shared by local agents, coordinator tasks, teammates,
 * shell/MCP background work, workflows, and local background sessions.
 *
 * `TaskStateBase.status` remains the compact persisted/runtime representation
 * used by existing UI and protocol code. `lifecycleStatus` is the authoritative
 * cross-task vocabulary. The helpers below keep both representations aligned
 * and reject late callbacks that try to overwrite a terminal state.
 */
export type TaskLifecycleStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'cancelled'

type PersistedTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'

export type TaskLifecycleShape = {
  status: PersistedTaskStatus
  lifecycleStatus?: TaskLifecycleStatus
  waitingForPermission?: boolean
  awaitingPlanApproval?: boolean
  isIdle?: boolean
}

const TERMINAL_STATUSES = new Set<TaskLifecycleStatus>([
  'completed',
  'failed',
  'stopped',
  'cancelled',
])

const ALLOWED_TRANSITIONS: Readonly<
  Record<TaskLifecycleStatus, ReadonlySet<TaskLifecycleStatus>>
> = {
  queued: new Set([
    'queued',
    'running',
    'waiting_permission',
    'failed',
    'stopped',
    'cancelled',
  ]),
  running: new Set([
    'running',
    'waiting_permission',
    'idle',
    'completed',
    'failed',
    'stopped',
    'cancelled',
  ]),
  waiting_permission: new Set([
    'waiting_permission',
    'running',
    'idle',
    'failed',
    'stopped',
    'cancelled',
  ]),
  idle: new Set([
    'idle',
    'running',
    'waiting_permission',
    'completed',
    'failed',
    'stopped',
    'cancelled',
  ]),
  completed: new Set(['completed']),
  failed: new Set(['failed']),
  stopped: new Set(['stopped']),
  cancelled: new Set(['cancelled']),
}

export function isTerminalTaskLifecycleStatus(
  status: TaskLifecycleStatus,
): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Derive the canonical state from the persisted status and task-specific
 * activity flags. Terminal status always wins over stale activity flags.
 */
export function deriveTaskLifecycleStatus(
  task: TaskLifecycleShape,
): TaskLifecycleStatus {
  switch (task.status) {
    case 'pending':
      return 'queued'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'stopped'
    case 'running':
      if (task.waitingForPermission || task.awaitingPlanApproval) {
        return 'waiting_permission'
      }
      if (task.isIdle) {
        return 'idle'
      }
      return 'running'
  }
}

export function canTransitionTaskLifecycle(
  from: TaskLifecycleStatus,
  to: TaskLifecycleStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to)
}

export function isTaskLifecycleTransitionAllowed(
  previous: TaskLifecycleShape,
  next: TaskLifecycleShape,
): boolean {
  return canTransitionTaskLifecycle(
    deriveTaskLifecycleStatus(previous),
    deriveTaskLifecycleStatus(next),
  )
}

/**
 * Return a state with its canonical lifecycle synchronized. The returned
 * object is unchanged when already normalized to avoid unnecessary renders.
 */
export function normalizeTaskLifecycle<T extends TaskLifecycleShape>(
  task: T,
): T {
  const lifecycleStatus = deriveTaskLifecycleStatus(task)
  return task.lifecycleStatus === lifecycleStatus
    ? task
    : { ...task, lifecycleStatus }
}

/**
 * Apply a proposed task update only when it follows the shared transition
 * table. This is deliberately pure so deterministic validation can exercise
 * races without rendering the application.
 */
export function guardTaskLifecycleTransition<T extends TaskLifecycleShape>(
  previous: T,
  proposed: T,
): T {
  if (!isTaskLifecycleTransitionAllowed(previous, proposed)) {
    return previous
  }
  return normalizeTaskLifecycle(proposed)
}
