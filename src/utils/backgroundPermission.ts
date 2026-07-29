import type { ToolUseContext } from '../Tool.js'

export const DEFAULT_BACKGROUND_PERMISSION_TIMEOUT_MS = 300_000

export function resolveBackgroundPermissionTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_BACKGROUND_PERMISSION_TIMEOUT_MS
  if (raw === undefined || raw === '') {
    return DEFAULT_BACKGROUND_PERMISSION_TIMEOUT_MS
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      'CLAUDE_CODE_BACKGROUND_PERMISSION_TIMEOUT_MS must be a positive integer',
    )
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      'CLAUDE_CODE_BACKGROUND_PERMISSION_TIMEOUT_MS exceeds the safe integer range',
    )
  }
  return parsed
}

export function isBackgroundAgentPermission(
  toolUseContext: ToolUseContext,
): boolean {
  if (!toolUseContext.agentId) return false
  const task = toolUseContext.getAppState().tasks[toolUseContext.agentId]
  return (
    task?.type === 'local_agent' &&
    'isBackgrounded' in task &&
    task.isBackgrounded === true
  )
}
