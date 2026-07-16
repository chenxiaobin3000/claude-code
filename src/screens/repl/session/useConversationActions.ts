import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import { useCallback } from 'react'
import type { useSetAppState } from '../../../state/AppState.js'
import type {
  Message as MessageType,
  UserMessage,
} from '../../../types/message.js'
import type { PastedContent } from '../../../utils/config.js'
import type { PromptInputMode } from '../../../types/textInputTypes.js'
import type { InternalPermissionMode } from '../../../types/permissions.js'
import { logEvent } from '../../../services/analytics/index.js'
import { resetMicrocompactState } from '../../../services/compact/microCompact.js'
import { textForResubmit } from '../../../utils/messages.js'

type SetAppState = ReturnType<typeof useSetAppState>

export function useConversationActions({
  messagesRef,
  setMessages,
  setConversationId,
  setAppState,
  setInputValue,
  setInputMode,
  setPastedContents,
  restoreMessageSyncRef,
}: {
  messagesRef: React.MutableRefObject<MessageType[]>
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setConversationId: React.Dispatch<React.SetStateAction<UUID>>
  setAppState: SetAppState
  setInputValue: (value: string) => void
  setInputMode: React.Dispatch<React.SetStateAction<PromptInputMode>>
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  restoreMessageSyncRef: React.MutableRefObject<(message: UserMessage) => void>
}) {
  const rewindConversationTo = useCallback(
    (message: UserMessage) => {
      const previous = messagesRef.current
      const messageIndex = previous.lastIndexOf(message)
      if (messageIndex === -1) return
      logEvent('tengu_conversation_rewind', {
        preRewindMessageCount: previous.length,
        postRewindMessageCount: messageIndex,
        messagesRemoved: previous.length - messageIndex,
        rewindToMessageIndex: messageIndex,
      })
      setMessages(previous.slice(0, messageIndex))
      setConversationId(randomUUID())
      resetMicrocompactState()
      if (feature('CONTEXT_COLLAPSE')) {
        ;(
          require('../../../services/contextCollapse/index.js') as typeof import('../../../services/contextCollapse/index.js')
        ).resetContextCollapse()
      }
      const permissionMode = message.permissionMode as
        | InternalPermissionMode
        | undefined
      setAppState(state => ({
        ...state,
        toolPermissionContext:
          permissionMode && state.toolPermissionContext.mode !== permissionMode
            ? { ...state.toolPermissionContext, mode: permissionMode }
            : state.toolPermissionContext,
        promptSuggestion: {
          text: null,
          promptId: null,
          shownAt: 0,
          acceptedAt: 0,
          generationRequestId: null,
        },
      }))
    },
    [messagesRef, setMessages, setConversationId, setAppState],
  )

  const restoreMessageSync = useCallback(
    (message: UserMessage) => {
      rewindConversationTo(message)
      const resubmit = textForResubmit(message)
      if (resubmit) {
        setInputValue(resubmit.text)
        setInputMode(resubmit.mode)
      }
      if (
        Array.isArray(message.message.content) &&
        message.message.content.some(block => block.type === 'image')
      ) {
        const images = message.message.content.filter(
          block => block.type === 'image',
        ) as ImageBlockParam[]
        const pasted: Record<number, PastedContent> = {}
        images.forEach((block, index) => {
          if (block.source.type !== 'base64') return
          const id =
            (message.imagePasteIds as number[] | undefined)?.[index] ??
            index + 1
          pasted[id] = {
            id,
            type: 'image',
            content: block.source.data,
            mediaType: block.source.media_type,
          }
        })
        if (images.length > 0) setPastedContents(pasted)
      }
    },
    [rewindConversationTo, setInputValue, setInputMode, setPastedContents],
  )
  restoreMessageSyncRef.current = restoreMessageSync

  const handleRestoreMessage = useCallback(
    async (message: UserMessage) => {
      setImmediate(
        (restore, selected) => restore(selected),
        restoreMessageSync,
        message,
      )
    },
    [restoreMessageSync],
  )

  return { rewindConversationTo, restoreMessageSync, handleRestoreMessage }
}
