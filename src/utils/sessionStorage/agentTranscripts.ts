import type { Message } from '../../types/message.js'

export function extractAgentIdsFromMessages(messages: Message[]): string[] {
  const agentIds = new Set<string>()
  for (const message of messages) {
    if (
      message.type === 'progress' &&
      message.data &&
      typeof message.data === 'object' &&
      'type' in message.data &&
      (message.data.type === 'agent_progress' ||
        message.data.type === 'skill_progress') &&
      'agentId' in message.data &&
      typeof message.data.agentId === 'string'
    ) {
      agentIds.add(message.data.agentId)
    }
  }
  return [...agentIds]
}

export function extractTeammateTranscriptsFromTasks(tasks: {
  [taskId: string]: {
    type: string
    identity?: { agentId: string }
    messages?: Message[]
  }
}): { [agentId: string]: Message[] } {
  const transcripts: { [agentId: string]: Message[] } = {}
  for (const task of Object.values(tasks)) {
    if (
      task.type === 'in_process_teammate' &&
      task.identity?.agentId &&
      task.messages?.length
    ) {
      transcripts[task.identity.agentId] = task.messages
    }
  }
  return transcripts
}
