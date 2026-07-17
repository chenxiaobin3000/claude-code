import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  Message,
  NormalizedMessage,
  SystemCompactBoundaryMessage,
} from '../../types/message.js'

export function getLastAssistantMessage(
  messages: Message[],
): AssistantMessage | undefined {
  return messages.findLast(
    (message): message is AssistantMessage => message.type === 'assistant',
  )
}

export function hasToolCallsInLastAssistantTurn(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type !== 'assistant') continue
    const content = message.message?.content
    return Array.isArray(content)
      ? content.some(block => block.type === 'tool_use')
      : false
  }
  return false
}

export function isCompactBoundaryMessage(
  message: Message | NormalizedMessage,
): message is SystemCompactBoundaryMessage {
  return message.type === 'system' && message.subtype === 'compact_boundary'
}

export function findLastCompactBoundaryIndex<
  T extends Message | NormalizedMessage,
>(messages: T[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message && isCompactBoundaryMessage(message)) return index
  }
  return -1
}

export function isThinkingMessage(message: Message): boolean {
  if (message.type !== 'assistant') return false
  const content = message.message?.content
  return (
    Array.isArray(content) &&
    (content as Array<{ type: string }>).every(
      block =>
        block.type === 'thinking' || block.type === 'redacted_thinking',
    )
  )
}

export function countToolCalls(
  messages: Message[],
  toolName: string,
  maxCount?: number,
): number {
  let count = 0
  for (const message of messages) {
    const content = message.message?.content
    if (message.type !== 'assistant' || !Array.isArray(content)) continue
    const hasToolUse = (content as Array<{ type: string; name?: string }>).some(
      (block): block is ToolUseBlock =>
        block.type === 'tool_use' && block.name === toolName,
    )
    if (!hasToolUse) continue
    count++
    if (maxCount && count >= maxCount) return count
  }
  return count
}
