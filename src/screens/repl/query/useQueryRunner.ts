import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { feature } from 'bun:bundle'
import { useCallback } from 'react'
import {
  getBudgetContinuationCount,
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  snapshotOutputTokensForTurn,
} from '../../../bootstrap/state.js'
import {
  selectableUserMessagesFilter,
  messagesAfterAreOnlySynthetic,
} from '../../../components/MessageSelector.js'
import { removeLastFromHistory } from '../../../history.js'
import type {
  useSetAppState,
  useAppStateStore,
} from '../../../state/AppState.js'
import { getAllInProcessTeammateTasks } from '../../../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import type {
  Message as MessageType,
  UserMessage,
} from '../../../types/message.js'
import type { EffortValue } from '../../../utils/effort.js'
import { count } from '../../../utils/array.js'
import {
  getContentText,
  createTurnDurationMessage,
  type StreamingToolUse,
} from '../../../utils/messages.js'
import {
  getCommandQueueLength,
  enqueue,
} from '../../../utils/messageQueueManager.js'
import { isLoggableMessage } from '../../../utils/sessionStorage.js'
import { parseTokenBudget } from '../../../utils/tokenBudget.js'
import { getAgentName, getTeamName } from '../../../utils/teammate.js'
import { setMemberActive } from '../../../utils/swarm/teamHelpers.js'
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js'
import type { QueryGuard } from '../../../utils/QueryGuard.js'
import { logEvent } from '../../../services/analytics/index.js'
import type { PipeMessage } from '../../../utils/pipeTransport.js'

type Store = ReturnType<typeof useAppStateStore>
type SetAppState = ReturnType<typeof useSetAppState>

export function useQueryRunner({
  queryGuard,
  setWasAborted,
  resetTimingRefs,
  setMessages,
  messagesRef,
  responseLengthRef,
  apiMetricsRef,
  setStreamingToolUses,
  setStreamingText,
  mrOnBeforeQuery,
  mrOnTurnComplete,
  onQueryImpl,
  pipeReturnHadErrorRef,
  relayPipeMessage,
  setLastQueryCompletionTime,
  skipIdleCheckRef,
  resetLoadingState,
  setAppState,
  loadingStartTimeRef,
  totalPausedMsRef,
  proactiveActive,
  store,
  swarmStartTimeRef,
  swarmBudgetInfoRef,
  setAbortController,
  inputValueRef,
  restoreMessageSyncRef,
}: {
  queryGuard: QueryGuard
  setWasAborted: React.Dispatch<React.SetStateAction<boolean>>
  resetTimingRefs: () => void
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  messagesRef: React.MutableRefObject<MessageType[]>
  responseLengthRef: React.MutableRefObject<number>
  apiMetricsRef: React.MutableRefObject<unknown[]>
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  setStreamingText: React.Dispatch<React.SetStateAction<string | null>>
  mrOnBeforeQuery: (
    input: string,
    messages: MessageType[],
    newMessageCount: number,
  ) => unknown | Promise<unknown>
  mrOnTurnComplete: (
    messages: MessageType[],
    aborted: boolean,
  ) => unknown | Promise<unknown>
  onQueryImpl: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModel: string,
    effort?: EffortValue,
  ) => Promise<void>
  pipeReturnHadErrorRef: React.MutableRefObject<boolean>
  relayPipeMessage: (message: PipeMessage) => boolean
  setLastQueryCompletionTime: React.Dispatch<React.SetStateAction<number>>
  skipIdleCheckRef: React.MutableRefObject<boolean>
  resetLoadingState: () => void
  setAppState: SetAppState
  loadingStartTimeRef: React.MutableRefObject<number>
  totalPausedMsRef: React.MutableRefObject<number>
  proactiveActive: unknown
  store: Store
  swarmStartTimeRef: React.MutableRefObject<number | null>
  swarmBudgetInfoRef: React.MutableRefObject<
    { tokens: number; limit: number; nudges: number } | undefined
  >
  setAbortController: (controller: AbortController | null) => void
  inputValueRef: React.MutableRefObject<string>
  restoreMessageSyncRef: React.MutableRefObject<(message: UserMessage) => void>
}) {
  return useCallback(
    async (
      newMessages: MessageType[],
      abortController: AbortController,
      shouldQuery: boolean,
      additionalAllowedTools: string[],
      mainLoopModel: string,
      beforeQuery?: (
        input: string,
        messages: MessageType[],
      ) => Promise<boolean>,
      input?: string,
      effort?: EffortValue,
    ): Promise<boolean> => {
      if (isAgentSwarmsEnabled()) {
        const teamName = getTeamName()
        const agentName = getAgentName()
        if (teamName && agentName)
          void setMemberActive(teamName, agentName, true)
      }

      const generation = queryGuard.tryStart()
      if (generation === null) {
        logEvent('tengu_concurrent_onquery_detected', {})
        newMessages
          .filter(
            (message): message is UserMessage =>
              message.type === 'user' && !message.isMeta,
          )
          .map(message =>
            getContentText(
              message.message.content as string | ContentBlockParam[],
            ),
          )
          .filter((message): message is string => message !== null)
          .forEach((message, index) => {
            enqueue({ value: message, mode: 'prompt' })
            if (index === 0) logEvent('tengu_concurrent_onquery_enqueued', {})
          })
        return false
      }

      try {
        pipeReturnHadErrorRef.current = false
        setWasAborted(false)
        resetTimingRefs()
        setMessages(previous => [...previous, ...newMessages])
        responseLengthRef.current = 0
        if (feature('TOKEN_BUDGET')) {
          const parsedBudget = input ? parseTokenBudget(input) : null
          snapshotOutputTokensForTurn(
            parsedBudget ?? getCurrentTurnTokenBudget(),
          )
        }
        apiMetricsRef.current = []
        setStreamingToolUses([])
        setStreamingText(null)
        const latestMessages = messagesRef.current
        if (input)
          await mrOnBeforeQuery(input, latestMessages, newMessages.length)
        if (beforeQuery && input && !(await beforeQuery(input, latestMessages)))
          return true
        try {
          await onQueryImpl(
            latestMessages,
            newMessages,
            abortController,
            shouldQuery,
            additionalAllowedTools,
            mainLoopModel,
            effort,
          )
        } catch (error) {
          if (feature('UDS_INBOX')) {
            pipeReturnHadErrorRef.current = true
            relayPipeMessage({
              type: 'error',
              data: error instanceof Error ? error.message : String(error),
            })
          }
          throw error
        }
      } finally {
        if (queryGuard.end(generation)) {
          setWasAborted(abortController.signal.aborted)
          setLastQueryCompletionTime(Date.now())
          skipIdleCheckRef.current = false
          resetLoadingState()
          await mrOnTurnComplete(
            messagesRef.current,
            abortController.signal.aborted,
          )
          if (feature('UDS_INBOX') && !pipeReturnHadErrorRef.current)
            relayPipeMessage({ type: 'done', data: '' })
          if (
            process.env.USER_TYPE === 'ant' &&
            !abortController.signal.aborted
          ) {
            setAppState(previous =>
              previous.tungstenActiveSession === undefined ||
              previous.tungstenPanelAutoHidden === true
                ? previous
                : { ...previous, tungstenPanelAutoHidden: true },
            )
          }

          let budgetInfo:
            | { tokens: number; limit: number; nudges: number }
            | undefined
          if (feature('TOKEN_BUDGET')) {
            const limit = getCurrentTurnTokenBudget()
            if (
              limit !== null &&
              limit > 0 &&
              !abortController.signal.aborted
            ) {
              budgetInfo = {
                tokens: getTurnOutputTokens(),
                limit,
                nudges: getBudgetContinuationCount(),
              }
            }
            snapshotOutputTokensForTurn(null)
          }
          const duration =
            Date.now() - loadingStartTimeRef.current - totalPausedMsRef.current
          if (
            (duration > 30000 || budgetInfo) &&
            !abortController.signal.aborted &&
            !proactiveActive
          ) {
            const runningAgents = getAllInProcessTeammateTasks(
              store.getState().tasks,
            ).some(task => task.status === 'running')
            if (runningAgents) {
              if (swarmStartTimeRef.current === null)
                swarmStartTimeRef.current = loadingStartTimeRef.current
              if (budgetInfo) swarmBudgetInfoRef.current = budgetInfo
            } else {
              setMessages(previous => [
                ...previous,
                createTurnDurationMessage(
                  duration,
                  budgetInfo,
                  count(previous, isLoggableMessage),
                ),
              ])
            }
          }
          setAbortController(null)
        }

        if (
          abortController.signal.reason === 'user-cancel' &&
          !queryGuard.isActive &&
          inputValueRef.current === '' &&
          getCommandQueueLength() === 0 &&
          !store.getState().viewingAgentTaskId
        ) {
          const messages = messagesRef.current
          const lastUserMessage = messages.findLast(
            selectableUserMessagesFilter,
          )
          if (lastUserMessage) {
            const index = messages.lastIndexOf(lastUserMessage)
            if (messagesAfterAreOnlySynthetic(messages, index)) {
              removeLastFromHistory()
              restoreMessageSyncRef.current(lastUserMessage)
            }
          }
        }
      }
      return true
    },
    [
      queryGuard,
      setWasAborted,
      resetTimingRefs,
      setMessages,
      messagesRef,
      responseLengthRef,
      apiMetricsRef,
      setStreamingToolUses,
      setStreamingText,
      mrOnBeforeQuery,
      mrOnTurnComplete,
      onQueryImpl,
      pipeReturnHadErrorRef,
      relayPipeMessage,
      setLastQueryCompletionTime,
      skipIdleCheckRef,
      resetLoadingState,
      setAppState,
      loadingStartTimeRef,
      totalPausedMsRef,
      proactiveActive,
      store,
      swarmStartTimeRef,
      swarmBudgetInfoRef,
      setAbortController,
      inputValueRef,
      restoreMessageSyncRef,
    ],
  )
}
