import { useCallback, useRef, useState } from 'react'
import { REMOTE_SAFE_COMMANDS, type Command } from '../../../commands.js'
import type { ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../../../components/Spinner.js'
import { useDirectConnect } from '../../../hooks/useDirectConnect.js'
import { useRemoteSession } from '../../../hooks/useRemoteSession.js'
import { useSSHSession } from '../../../hooks/useSSHSession.js'
import type { RemoteSessionConfig } from '../../../remote/RemoteSessionManager.js'
import type { DirectConnectConfig } from '../../../server/directConnectManager.js'
import type { SSHSession } from '../../../ssh/createSSHSession.js'
import type { Tool } from '../../../Tool.js'
import type { Message as MessageType } from '../../../types/message.js'
import type { StreamingToolUse } from '../../../utils/messages.js'

export function useRemoteRuntime({
  remoteSessionConfig,
  directConnectConfig,
  sshSession,
  setMessages,
  setIsLoading,
  setLocalCommands,
  setToolUseConfirmQueue,
  tools,
  setStreamingToolUses,
  setStreamMode,
}: {
  remoteSessionConfig: RemoteSessionConfig | undefined
  directConnectConfig: DirectConnectConfig | undefined
  sshSession: SSHSession | undefined
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setIsLoading: (loading: boolean) => void
  setLocalCommands: React.Dispatch<React.SetStateAction<Command[]>>
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  tools: Tool[]
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  setStreamMode: React.Dispatch<React.SetStateAction<SpinnerMode>>
}) {
  const [inProgressToolUseIDs, setInProgressToolUseIDs] = useState<Set<string>>(
    new Set(),
  )
  const hasInterruptibleToolInProgressRef = useRef(false)

  const handleRemoteInit = useCallback(
    (remoteSlashCommands: string[]) => {
      const remoteCommandSet = new Set(remoteSlashCommands)
      setLocalCommands(previous =>
        previous.filter(
          command =>
            remoteCommandSet.has(command.name) ||
            REMOTE_SAFE_COMMANDS.has(command),
        ),
      )
    },
    [setLocalCommands],
  )

  const remoteSession = useRemoteSession({
    config: remoteSessionConfig,
    setMessages,
    setIsLoading,
    onInit: handleRemoteInit,
    setToolUseConfirmQueue,
    tools,
    setStreamingToolUses,
    setStreamMode,
    setInProgressToolUseIDs,
  })
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
  const activeRemote = sshRemote.isRemoteMode
    ? sshRemote
    : directConnect.isRemoteMode
      ? directConnect
      : remoteSession

  return {
    activeRemote,
    remoteSession,
    inProgressToolUseIDs,
    setInProgressToolUseIDs,
    hasInterruptibleToolInProgressRef,
  }
}
