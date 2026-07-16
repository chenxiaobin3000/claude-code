import { feature } from 'bun:bundle'
import { useCallback } from 'react'
import { snapshotOutputTokensForTurn } from '../../../bootstrap/state.js'
import type { ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js'
import type { PromptRequest, PromptResponse } from '../../../types/hooks.js'
import type { Message as MessageType } from '../../../types/message.js'
import { createAssistantMessage } from '../../../utils/messages.js'
import type { QueryGuard } from '../../../utils/QueryGuard.js'
import { logForDebugging } from '../../../utils/debug.js'
import type { FocusedInputDialog } from '../view/dialogFocus.js'
import type { useRemoteRuntime } from '../runtime/useRemoteRuntime.js'

const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../../proactive/index.js')
    : null
const LOCAL_JSX_CLOSE_CANCEL_GRACE_MS = 500

type PromptQueueItem = {
  request: PromptRequest
  title: string
  toolInputSummary?: string | null
  resolve: (response: PromptResponse) => void
  reject: (error: Error) => void
}

export function useCancelInteraction({
  focusedInputDialog,
  localJSXClosedAtRef,
  streamMode,
  queryGuard,
  setWasAborted,
  skipIdleCheckRef,
  streamingText,
  setMessages,
  resetLoadingState,
  toolUseConfirmQueue,
  setToolUseConfirmQueue,
  promptQueue,
  setPromptQueue,
  abortController,
  activeRemote,
  setAbortController,
  mrOnTurnComplete,
  messagesRef,
}: {
  focusedInputDialog: FocusedInputDialog
  localJSXClosedAtRef: React.MutableRefObject<number>
  streamMode: string
  queryGuard: QueryGuard
  setWasAborted: React.Dispatch<React.SetStateAction<boolean>>
  skipIdleCheckRef: React.MutableRefObject<boolean>
  streamingText: string | null
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  resetLoadingState: () => void
  toolUseConfirmQueue: ToolUseConfirm[]
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  promptQueue: PromptQueueItem[]
  setPromptQueue: React.Dispatch<React.SetStateAction<PromptQueueItem[]>>
  abortController: AbortController | null
  activeRemote: ReturnType<typeof useRemoteRuntime>['activeRemote']
  setAbortController: (controller: AbortController | null) => void
  mrOnTurnComplete: (
    messages: MessageType[],
    aborted: boolean,
  ) => unknown | Promise<unknown>
  messagesRef: React.MutableRefObject<MessageType[]>
}) {
  const onCancel = useCallback(() => {
    if (focusedInputDialog === 'elicitation') return
    if (
      localJSXClosedAtRef.current !== 0 &&
      Date.now() - localJSXClosedAtRef.current < LOCAL_JSX_CLOSE_CANCEL_GRACE_MS
    ) {
      localJSXClosedAtRef.current = 0
      logForDebugging('[onCancel] suppressed: local-jsx panel just dismissed')
      return
    }
    localJSXClosedAtRef.current = 0
    logForDebugging(
      `[onCancel] focusedInputDialog=${focusedInputDialog} streamMode=${streamMode}`,
    )
    proactiveModule?.pauseProactive()
    if (feature('GOAL') && queryGuard.getSnapshot()) {
      const { getGoal, pauseGoal } =
        require('../../../services/goal/goalState.js') as typeof import('../../../services/goal/goalState.js')
      const { persistCurrentGoal } =
        require('../../../services/goal/goalStorage.js') as typeof import('../../../services/goal/goalStorage.js')
      if (getGoal()?.status === 'active') {
        pauseGoal()
        persistCurrentGoal()
      }
    }
    setWasAborted(true)
    queryGuard.forceEnd()
    skipIdleCheckRef.current = false
    if (streamingText?.trim()) {
      setMessages(previous => [
        ...previous,
        createAssistantMessage({ content: streamingText }),
      ])
    }
    resetLoadingState()
    if (feature('TOKEN_BUDGET')) snapshotOutputTokensForTurn(null)

    if (focusedInputDialog === 'tool-permission') {
      toolUseConfirmQueue[0]?.onAbort()
      setToolUseConfirmQueue([])
    } else if (focusedInputDialog === 'prompt') {
      for (const item of promptQueue)
        item.reject(new Error('Prompt cancelled by user'))
      setPromptQueue([])
      abortController?.abort('user-cancel')
    } else if (activeRemote.isRemoteMode) {
      activeRemote.cancelRequest()
    } else {
      abortController?.abort('user-cancel')
    }
    setAbortController(null)
    void mrOnTurnComplete(messagesRef.current, true)
  }, [
    focusedInputDialog,
    localJSXClosedAtRef,
    streamMode,
    queryGuard,
    setWasAborted,
    skipIdleCheckRef,
    streamingText,
    setMessages,
    resetLoadingState,
    toolUseConfirmQueue,
    setToolUseConfirmQueue,
    promptQueue,
    setPromptQueue,
    abortController,
    activeRemote,
    setAbortController,
    mrOnTurnComplete,
    messagesRef,
  ])

  return { onCancel }
}
