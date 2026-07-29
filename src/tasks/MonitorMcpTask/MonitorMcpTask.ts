// Background task entry for MCP resource monitoring.
// Tracks a long-running subscription to an MCP server resource so the
// otherwise-invisible stream is visible in the footer pill and Shift+Down
// dialog. Follows the DreamTask pattern: pure UI surfacing via the existing
// task registry.

import type { AppState } from '../../state/AppState.js'
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import { escapeXml } from '../../utils/xml.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  /** The MCP server name being monitored. */
  serverName: string
  /** The resource URI being subscribed to. */
  resourceUri: string
  /** The shell command used to drive monitoring (if any). */
  command?: string
  /** Agent that spawned this task. Used to kill orphaned tasks on agent exit. */
  agentId?: AgentId
  /** Abort controller to cancel the subscription. */
  abortController?: AbortController
  /** Removes the process-exit cleanup once the monitor reaches a terminal state. */
  unregisterCleanup?: () => void
}

export function isMonitorMcpTask(task: unknown): task is MonitorMcpTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'monitor_mcp'
  )
}

export function registerMonitorMcpTask(
  setAppState: SetAppState,
  opts: {
    description: string
    serverName: string
    resourceUri: string
    command?: string
    toolUseId?: string
    agentId?: AgentId
    abortController?: AbortController
  },
): string {
  const id = generateTaskId('monitor_mcp')
  const unregisterCleanup = registerCleanup(async () => {
    opts.abortController?.abort()
  })
  const task: MonitorMcpTaskState = {
    ...createTaskStateBase(id, 'monitor_mcp', opts.description, opts.toolUseId),
    type: 'monitor_mcp',
    status: 'running',
    serverName: opts.serverName,
    resourceUri: opts.resourceUri,
    command: opts.command,
    agentId: opts.agentId,
    abortController: opts.abortController,
    unregisterCleanup,
  }
  registerTask(task, setAppState)
  return id
}

export function completeMonitorMcpTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let transitioned = false
  let unregisterCleanup: (() => void) | undefined
  let description = ''
  let toolUseId: string | undefined
  let agentId: AgentId | undefined
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    transitioned = true
    unregisterCleanup = task.unregisterCleanup
    description = task.description
    toolUseId = task.toolUseId
    agentId = task.agentId
    return {
      ...task,
      status: 'completed',
      endTime: Date.now(),
      notified: false,
      abortController: undefined,
      unregisterCleanup: undefined,
    }
  })
  if (!transitioned) return
  unregisterCleanup?.()
  enqueueMonitorNotification(
    taskId,
    'completed',
    description,
    setAppState,
    toolUseId,
    agentId,
  )
}

export function failMonitorMcpTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let transitioned = false
  let unregisterCleanup: (() => void) | undefined
  let description = ''
  let toolUseId: string | undefined
  let agentId: AgentId | undefined
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    transitioned = true
    unregisterCleanup = task.unregisterCleanup
    description = task.description
    toolUseId = task.toolUseId
    agentId = task.agentId
    return {
      ...task,
      status: 'failed',
      endTime: Date.now(),
      notified: false,
      abortController: undefined,
      unregisterCleanup: undefined,
    }
  })
  if (!transitioned) return
  unregisterCleanup?.()
  enqueueMonitorNotification(
    taskId,
    'failed',
    description,
    setAppState,
    toolUseId,
    agentId,
  )
}

function enqueueMonitorNotification(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  description: string,
  setAppState: SetAppState,
  toolUseId?: string,
  agentId?: AgentId,
): void {
  let shouldNotify = false
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.notified) return task
    shouldNotify = true
    return { ...task, notified: true }
  })
  if (!shouldNotify) return

  const toolUseLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  enqueuePendingNotification({
    value: `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseLine}
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(`MCP monitor "${description}" ${status}`)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`,
    mode: 'task-notification',
    priority: 'next',
    agentId,
  })
}

export function killMonitorMcp(taskId: string, setAppState: SetAppState): void {
  let abortController: AbortController | undefined
  let unregisterCleanup: (() => void) | undefined
  let description = ''
  let toolUseId: string | undefined
  let agentId: AgentId | undefined
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    abortController = task.abortController
    unregisterCleanup = task.unregisterCleanup
    description = task.description
    toolUseId = task.toolUseId
    agentId = task.agentId
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      notified: false,
      abortController: undefined,
      unregisterCleanup: undefined,
    }
  })
  abortController?.abort()
  unregisterCleanup?.()
  enqueueMonitorNotification(
    taskId,
    'killed',
    description,
    setAppState,
    toolUseId,
    agentId,
  )
}

/**
 * Kill all running monitor_mcp tasks spawned by a given agent.
 * Called from runAgent.ts finally block so subscriptions don't outlive
 * the agent that started them.
 */
export function killMonitorMcpTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppState,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (
      isMonitorMcpTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killMonitorMcpTasksForAgent: killing orphaned monitor task ${taskId} (agent ${agentId} exiting)`,
      )
      killMonitorMcp(taskId, setAppState)
    }
  }
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',

  async kill(taskId, setAppState) {
    killMonitorMcp(taskId, setAppState)
  },
}
