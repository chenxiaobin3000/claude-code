import { feature } from 'bun:bundle'
import type React from 'react'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js'
import { useMailboxBridge } from '../../../hooks/useMailboxBridge.js'
import { useInboxPoller } from '../../../hooks/useInboxPoller.js'
import type { useNotifications } from '../../../context/notifications.js'
import {
  useAppState,
  type useAppStateStore,
  type useSetAppState,
} from '../../../state/AppState.js'
import type { Message as MessageType } from '../../../types/message.js'
import type { QueuedCommand } from '../../../types/textInputTypes.js'
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js'
import { getPipeIpc } from '../../../utils/pipeTransport.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const useMasterMonitor = feature('UDS_INBOX')
  ? require('../../../hooks/useMasterMonitor.js').useMasterMonitor
  : () => undefined
const useSlaveNotifications = feature('UDS_INBOX')
  ? require('../../../hooks/useSlaveNotifications.js').useSlaveNotifications
  : () => undefined
const usePipeIpc = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeIpc.js').usePipeIpc
  : () => undefined
const usePipeRelay = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeRelay.js').usePipeRelay
  : () => ({
      relayPipeMessage: () => false,
      pipeReturnHadErrorRef: { current: false },
    })
const usePipePermissionForward = feature('UDS_INBOX')
  ? require('../../../hooks/usePipePermissionForward.js')
      .usePipePermissionForward
  : () => undefined
const usePipeMuteSync = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeMuteSync.js').usePipeMuteSync
  : () => undefined
const usePipeRouter = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeRouter.js').usePipeRouter
  : () => ({ routeToSelectedPipes: () => false })
/* eslint-enable @typescript-eslint/no-require-imports */

type Store = ReturnType<typeof useAppStateStore>
type SetAppState = ReturnType<typeof useSetAppState>
type AddNotification = ReturnType<typeof useNotifications>['addNotification']

export function usePipeRouting({
  store,
  setAppState,
  addNotification,
}: {
  store: Store
  setAppState: SetAppState
  addNotification: AddNotification
}) {
  const relay = usePipeRelay()
  const router = usePipeRouter({ store, setAppState, addNotification })
  return { ...relay, ...router }
}

export function usePipeLifecycle({
  store,
  tools,
  setMessages,
  setToolUseConfirmQueue,
  getToolUseContext,
  mainLoopModel,
  isLoading,
  focusedInputDialog,
  handleIncomingPrompt,
}: {
  store: Store
  tools: readonly Tool[]
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  getToolUseContext: (...args: any[]) => ToolUseContext
  mainLoopModel: string
  isLoading: boolean
  focusedInputDialog: string | undefined
  handleIncomingPrompt: (content: string | QueuedCommand) => boolean
}): void {
  useInboxPoller({
    enabled: isAgentSwarmsEnabled(),
    isLoading,
    focusedInputDialog,
    onSubmitMessage: handleIncomingPrompt,
  })
  useMailboxBridge({ isLoading, onSubmitMessage: handleIncomingPrompt })
  useMasterMonitor()
  useSlaveNotifications()
  useAppState(state => getPipeIpc(state))
  usePipePermissionForward({
    store,
    tools,
    setMessages,
    setToolUseConfirmQueue,
    getToolUseContext,
    mainLoopModel,
  })
  usePipeMuteSync({ setToolUseConfirmQueue })
  usePipeIpc({ store, handleIncomingPrompt })
}
