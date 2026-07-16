import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import { useCallback } from 'react'
import type { SpinnerMode } from '../../../components/Spinner.js'
import type { useNotifications } from '../../../context/notifications.js'
import type { Message as MessageType } from '../../../types/message.js'
import type { PipeMessage } from '../../../utils/pipeTransport.js'
import {
  getContentText,
  getMessagesAfterCompactBoundary,
  handleMessageFromStream,
  isCompactBoundaryMessage,
  type StreamingThinking,
  type StreamingToolUse,
} from '../../../utils/messages.js'
import { isFullscreenEnvEnabled } from '../../../utils/fullscreen.js'
import {
  isEphemeralToolProgress,
  removeTranscriptMessage,
} from '../../../utils/sessionStorage.js'
import type { ApiMetric } from './useQueryMetrics.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../../proactive/index.js')
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

type AddNotification = ReturnType<typeof useNotifications>['addNotification']

export function useQueryEvents({
  setMessages,
  setConversationId,
  addNotification,
  pipeReturnHadErrorRef,
  relayPipeMessage,
  setResponseLength,
  setStreamMode,
  setStreamingToolUses,
  setStreamingThinking,
  responseLengthRef,
  apiMetricsRef,
  onStreamingText,
}: {
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setConversationId: React.Dispatch<React.SetStateAction<UUID>>
  addNotification: AddNotification
  pipeReturnHadErrorRef: React.MutableRefObject<boolean>
  relayPipeMessage: (message: PipeMessage) => boolean
  setResponseLength: (update: (previous: number) => number) => void
  setStreamMode: React.Dispatch<React.SetStateAction<SpinnerMode>>
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  setStreamingThinking: React.Dispatch<
    React.SetStateAction<StreamingThinking | null>
  >
  responseLengthRef: React.MutableRefObject<number>
  apiMetricsRef: React.MutableRefObject<ApiMetric[]>
  onStreamingText: (update: (current: string | null) => string | null) => void
}) {
  return useCallback(
    (event: Parameters<typeof handleMessageFromStream>[0]) => {
      handleMessageFromStream(
        event,
        newMessage => {
          if (isCompactBoundaryMessage(newMessage)) {
            if (isFullscreenEnvEnabled()) {
              setMessages(old => {
                const postBoundary = getMessagesAfterCompactBoundary(old, {
                  includeSnipped: true,
                })
                const kept =
                  postBoundary.length > 500
                    ? postBoundary.slice(-500)
                    : postBoundary
                return [...kept, newMessage]
              })
            } else {
              setMessages(() => [newMessage])
            }
            setConversationId(randomUUID())
            proactiveModule?.setContextBlocked(false)
          } else if (
            newMessage.type === 'progress' &&
            isEphemeralToolProgress(
              (newMessage as unknown as { data?: { type?: string } }).data
                ?.type,
            )
          ) {
            setMessages(oldMessages => {
              const newData = newMessage.data as Record<string, unknown>
              for (let index = oldMessages.length - 1; index >= 0; index--) {
                const previous = oldMessages[index]!
                if (previous.type !== 'progress') break
                const previousData = previous.data as
                  | Record<string, unknown>
                  | undefined
                if (
                  previous.parentToolUseID === newMessage.parentToolUseID &&
                  previousData?.type === newData.type
                ) {
                  const copy = oldMessages.slice()
                  copy[index] = newMessage
                  return copy
                }
              }
              return [...oldMessages, newMessage]
            })
          } else {
            setMessages(oldMessages => [...oldMessages, newMessage])
          }

          if (feature('PROACTIVE') || feature('KAIROS')) {
            if (
              newMessage.type === 'assistant' &&
              'isApiErrorMessage' in newMessage &&
              newMessage.isApiErrorMessage
            ) {
              proactiveModule?.setContextBlocked(true)
            } else if (newMessage.type === 'assistant') {
              proactiveModule?.setContextBlocked(false)
            }
          }

          if (
            feature('GOAL') &&
            newMessage.type === 'assistant' &&
            'isApiErrorMessage' in newMessage &&
            newMessage.isApiErrorMessage
          ) {
            const assistantText =
              getContentText(
                (newMessage.message?.content ?? '') as
                  | string
                  | ContentBlockParam[],
              ) ?? ''
            const normalized = assistantText.toLowerCase()
            const connectivityFailure = [
              'connection error',
              'fetch failed',
              'network error',
              'enotfound',
              'econnreset',
              'etimedout',
            ].some(fragment => normalized.includes(fragment))
            if (connectivityFailure) {
              const { getGoal, pauseGoal } =
                require('../../../services/goal/goalState.js') as typeof import('../../../services/goal/goalState.js')
              const { persistCurrentGoal } =
                require('../../../services/goal/goalStorage.js') as typeof import('../../../services/goal/goalStorage.js')
              if (getGoal()?.status === 'active') {
                pauseGoal()
                persistCurrentGoal()
                addNotification({
                  key: 'goal-auto-paused-connectivity-error',
                  text: 'Detected connection error. Active goal was auto-paused. Run /goal resume after network recovers.',
                  priority: 'immediate',
                })
              }
            }
          }

          if (feature('UDS_INBOX') && newMessage.type === 'assistant') {
            const message = newMessage.message as any
            const blocks = message?.content ?? (newMessage as any).content ?? []
            const textParts: string[] = []
            if (Array.isArray(blocks)) {
              for (const block of blocks) {
                if (typeof block === 'string') textParts.push(block)
                else if (block?.type === 'text' && block.text)
                  textParts.push(block.text)
              }
            } else if (typeof blocks === 'string') {
              textParts.push(blocks)
            }
            const text = textParts.join('\n').trim()
            if (
              'isApiErrorMessage' in newMessage &&
              newMessage.isApiErrorMessage
            ) {
              pipeReturnHadErrorRef.current = true
              relayPipeMessage({
                type: 'error',
                data: text || 'Slave request failed',
              })
            } else if (text) {
              relayPipeMessage({ type: 'stream', data: text })
            }
          }
        },
        content => setResponseLength(length => length + content.length),
        setStreamMode,
        setStreamingToolUses,
        tombstonedMessage => {
          setMessages(oldMessages =>
            oldMessages.filter(message => message !== tombstonedMessage),
          )
          void removeTranscriptMessage(tombstonedMessage.uuid)
        },
        setStreamingThinking,
        metrics => {
          const now = Date.now()
          const baseline = responseLengthRef.current
          apiMetricsRef.current.push({
            ...metrics,
            firstTokenTime: now,
            lastTokenTime: now,
            responseLengthBaseline: baseline,
            endResponseLength: baseline,
          })
        },
        onStreamingText,
      )
    },
    [
      setMessages,
      setConversationId,
      addNotification,
      pipeReturnHadErrorRef,
      relayPipeMessage,
      setResponseLength,
      setStreamMode,
      setStreamingToolUses,
      setStreamingThinking,
      responseLengthRef,
      apiMetricsRef,
      onStreamingText,
    ],
  )
}
