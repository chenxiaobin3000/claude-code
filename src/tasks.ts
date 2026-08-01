import { feature } from 'bun:bundle'
import type { Task, TaskType } from './Task.js'
import { DreamTask } from './tasks/DreamTask/DreamTask.js'
import { LocalAgentTask } from './tasks/LocalAgentTask/LocalAgentTask.js'
import { LocalShellTask } from './tasks/LocalShellTask/LocalShellTask.js'

/**
 * Get all tasks.
 * Mirrors the pattern from tools.ts
 * Feature-gated tasks are loaded here instead of at module initialization so
 * their dependency graph cannot re-enter this module while its bindings are
 * still in the temporal dead zone in source/dev mode.
 */
export function getAllTasks(): Task[] {
  const tasks: Task[] = [
    LocalShellTask,
    LocalAgentTask,
    DreamTask,
  ]
  /* eslint-disable @typescript-eslint/no-require-imports */
  if (feature('WORKFLOW_SCRIPTS')) {
    const { LocalWorkflowTask } = require(
      './tasks/LocalWorkflowTask/LocalWorkflowTask.js'
    ) as typeof import('./tasks/LocalWorkflowTask/LocalWorkflowTask.js')
    tasks.push(LocalWorkflowTask)
  }
  if (feature('MONITOR_TOOL')) {
    const { MonitorMcpTask } = require(
      './tasks/MonitorMcpTask/MonitorMcpTask.js'
    ) as typeof import('./tasks/MonitorMcpTask/MonitorMcpTask.js')
    tasks.push(MonitorMcpTask)
  }
  /* eslint-enable @typescript-eslint/no-require-imports */
  return tasks
}

/**
 * Get a task by its type.
 */
export function getTaskByType(type: TaskType): Task | undefined {
  return getAllTasks().find(t => t.type === type)
}
