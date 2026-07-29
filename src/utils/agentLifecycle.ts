import type { TaskStatus } from '../Task.js'
import type { AgentLifecycleStatus } from './sessionStorage.js'

export type AgentResumeBlockReason =
  | 'already_running'
  | 'permanently_stopped'

export function getAgentResumeBlockReason({
  runtimeStatus,
  durableStatus,
}: {
  runtimeStatus?: TaskStatus
  durableStatus?: AgentLifecycleStatus | null
}): AgentResumeBlockReason | null {
  if (runtimeStatus === 'running') return 'already_running'
  if (runtimeStatus === 'killed' || durableStatus === 'stopped') {
    return 'permanently_stopped'
  }
  return null
}

export function assertAgentResumeAllowed(
  agentId: string,
  statuses: Parameters<typeof getAgentResumeBlockReason>[0],
): void {
  const reason = getAgentResumeBlockReason(statuses)
  if (reason === 'already_running') {
    throw new Error(`Agent ${agentId} is already running`)
  }
  if (reason === 'permanently_stopped') {
    throw new Error(
      `Agent ${agentId} was permanently stopped and cannot be resumed`,
    )
  }
}
