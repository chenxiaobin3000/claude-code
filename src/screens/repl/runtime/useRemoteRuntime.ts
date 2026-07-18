import { useRef, useState } from 'react'
import type { ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../../../components/Spinner.js'
import { useDirectConnect } from '../../../hooks/useDirectConnect.js'
import { useSSHSession } from '../../../hooks/useSSHSession.js'
import type { DirectConnectConfig } from '../../../server/directConnectManager.js'
import type { SSHSession } from '../../../ssh/createSSHSession.js'
import type { Tool } from '../../../Tool.js'
import type { Message as MessageType } from '../../../types/message.js'
import type { StreamingToolUse } from '../../../utils/messages.js'

export function useRemoteRuntime({
  directConnectConfig,
  sshSession,
  setMessages,
  setIsLoading,
  setToolUseConfirmQueue,
  tools,
  setStreamingToolUses,
  setStreamMode,
}: {
  directConnectConfig: DirectConnectConfig | undefined
  sshSession: SSHSession | undefined
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setIsLoading: (loading: boolean) => void
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  tools: Tool[]
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  setStreamMode: React.Dispatch<React.SetStateAction<SpinnerMode>>
}) {
  const [inProgressToolUseIDs, setInProgressToolUseIDs] = useState<Set<string>>(
    new Set(),
  )
  const hasInterruptibleToolInProgressRef = useRef(false)

  const directConnect = useDirectConnect({
    config: directConnectConfig,
    setMessages,
    setIsLoading,
    setToolUseConfirmQueue,
    tools,
  })
  const sshRemote = useSSHSession({
    session: sshSession,
    setMessages,
    setIsLoading,
    setToolUseConfirmQueue,
    tools,
  })
  const activeRemote = sshRemote.isRemoteMode ? sshRemote : directConnect

  return {
    activeRemote,
    inProgressToolUseIDs,
    setInProgressToolUseIDs,
    hasInterruptibleToolInProgressRef,
  }
}
