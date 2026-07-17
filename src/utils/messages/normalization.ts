import type {
  AssistantMessage,
  Message,
  MessageOrigin,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  UserMessage,
} from '../../types/message.js'
import { createUserMessage } from './factories.js'
import { deriveUUID } from './ids.js'

// Deterministic UUID derivation. Produces a stable UUID-shaped string from a
// parent UUID + content block index so that the same input always produces the
// same key across calls. Used by normalizeMessages and synthetic message creation.
// Split messages, so each content block gets its own message
export function normalizeMessages(
  messages: AssistantMessage[],
): NormalizedAssistantMessage[]
export function normalizeMessages(
  messages: UserMessage[],
): NormalizedUserMessage[]
export function normalizeMessages(
  messages: (AssistantMessage | UserMessage)[],
): (NormalizedAssistantMessage | NormalizedUserMessage)[]
export function normalizeMessages(messages: Message[]): NormalizedMessage[]
export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  // isNewChain tracks whether we need to generate new UUIDs for messages when normalizing.
  // When a message has multiple content blocks, we split it into multiple messages,
  // each with a single content block. When this happens, we need to generate new UUIDs
  // for all subsequent messages to maintain proper ordering and prevent duplicate UUIDs.
  // This flag is set to true once we encounter a message with multiple content blocks,
  // and remains true for all subsequent messages in the normalization process.
  let isNewChain = false
  return messages.flatMap(message => {
    if (!message) return []
    switch (message.type) {
      case 'assistant': {
        const aMsg = message as AssistantMessage
        const assistantContent = Array.isArray(aMsg.message.content)
          ? aMsg.message.content
          : []
        isNewChain = isNewChain || assistantContent.length > 1
        return assistantContent.map((_, index) => {
          const uuid = isNewChain
            ? deriveUUID(message.uuid, index)
            : message.uuid
          return {
            type: 'assistant' as const,
            timestamp: message.timestamp,
            message: {
              ...aMsg.message,
              content: [_],
              context_management: aMsg.message.context_management ?? null,
            },
            isMeta: message.isMeta,
            isVirtual: message.isVirtual,
            requestId: message.requestId,
            uuid,
            error: message?.error,
            isApiErrorMessage: message.isApiErrorMessage,
            advisorModel: message.advisorModel,
          } as NormalizedAssistantMessage
        })
      }
      case 'attachment':
        return [message]
      case 'progress':
        return [message]
      case 'system':
        return [message]
      case 'user': {
        const uMsg = message as UserMessage
        if (typeof uMsg.message.content === 'string') {
          const uuid = isNewChain ? deriveUUID(uMsg.uuid, 0) : uMsg.uuid
          return [
            {
              ...uMsg,
              uuid,
              message: {
                ...uMsg.message,
                content: [{ type: 'text', text: uMsg.message.content }],
              },
            } as NormalizedMessage,
          ]
        }
        isNewChain = isNewChain || (uMsg.message.content?.length ?? 0) > 1
        let imageIndex = 0
        return (uMsg.message.content ?? []).map((_, index) => {
          const isImage = _.type === 'image'
          // For image content blocks, extract just the ID for this image
          const imageId =
            isImage && uMsg.imagePasteIds
              ? (uMsg.imagePasteIds as number[])[imageIndex]
              : undefined
          if (isImage) imageIndex++
          return {
            ...createUserMessage({
              content: [_],
              toolUseResult: uMsg.toolUseResult,
              mcpMeta: uMsg.mcpMeta as {
                _meta?: Record<string, unknown>
                structuredContent?: Record<string, unknown>
              },
              isMeta: uMsg.isMeta === true ? true : undefined,
              isVisibleInTranscriptOnly:
                uMsg.isVisibleInTranscriptOnly === true ? true : undefined,
              isVirtual:
                (uMsg.isVirtual as boolean | undefined) === true
                  ? true
                  : undefined,
              timestamp: uMsg.timestamp as string | undefined,
              imagePasteIds: imageId !== undefined ? [imageId] : undefined,
              origin: uMsg.origin as MessageOrigin | undefined,
            }),
            uuid: isNewChain ? deriveUUID(uMsg.uuid, index) : uMsg.uuid,
          } as NormalizedMessage
        })
      }
      default:
        return [message]
    }
  })
}
