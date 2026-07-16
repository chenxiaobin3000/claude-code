import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { AgentDefinition } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import { useCallback } from 'react'
import {
  getTurnClassifierCount,
  getTurnClassifierDurationMs,
  getTurnHookCount,
  getTurnHookDurationMs,
  getTurnToolCount,
  getTurnToolDurationMs,
  resetTurnClassifierDuration,
  resetTurnHookDuration,
  resetTurnToolDuration,
} from '../../../bootstrap/state.js'
import { getSystemPrompt } from '../../../constants/prompts.js'
import {
  BASH_INPUT_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../../../constants/xml.js'
import { getSystemContext, getUserContext } from '../../../context.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import { mergeClients } from '../../../hooks/useMergedClients.js'
import { query } from '../../../query.js'
import type { MCPServerConnection } from '../../../services/mcp/types.js'
import type {
  useAppStateStore,
  useSetAppState,
} from '../../../state/AppState.js'
import type { ToolPermissionContext, ToolUseContext } from '../../../Tool.js'
import type { Message as MessageType } from '../../../types/message.js'
import { getGlobalConfigWriteCount } from '../../../utils/config.js'
import type { EffortValue } from '../../../utils/effort.js'
import { closeOpenDiffs, getConnectedIdeClient } from '../../../utils/ide.js'
import {
  createApiMetricsMessage,
  getContentText,
  handleMessageFromStream,
  isCompactBoundaryMessage,
} from '../../../utils/messages.js'
import {
  isScratchpadEnabled,
  getScratchpadDir,
} from '../../../utils/permissions/filesystem.js'
import { checkAndDisableAutoModeIfNeeded } from '../../../utils/permissions/bypassPermissionsKillswitch.js'
import { getQuerySourceForREPL } from '../../../utils/promptCategory.js'
import {
  logQueryProfileReport,
  queryCheckpoint,
} from '../../../utils/queryProfiler.js'
import { generateSessionTitle } from '../../../utils/sessionTitle.js'
import { buildEffectiveSystemPrompt } from '../../../utils/systemPrompt.js'
import { maybeMarkProjectOnboardingComplete } from '../../../projectOnboardingState.js'
import type { ApiMetric } from './useQueryMetrics.js'
import type { PipeMessage } from '../../../utils/pipeTransport.js'

const getCoordinatorUserContext: (
  clients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
) => Record<string, string> = feature('COORDINATOR_MODE')
  ? require('../../../coordinator/coordinatorMode.js').getCoordinatorUserContext
  : () => ({})
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../../proactive/index.js')
    : null

type Store = ReturnType<typeof useAppStateStore>
type SetAppState = ReturnType<typeof useSetAppState>

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!
}

export function useQueryExecution({
  initialMcpClients,
  store,
  diagnosticTracker,
  titleDisabled,
  sessionTitle,
  agentTitle,
  haikuTitleAttemptedRef,
  setHaikuTitle,
  toolPermissionContext,
  setAppState,
  setConversationId,
  resetLoadingState,
  setAbortController,
  getToolUseContext,
  terminalFocusRef,
  mainThreadAgentDefinition,
  customSystemPrompt,
  appendSystemPrompt,
  canUseTool,
  onQueryEvent,
  pipeReturnHadErrorRef,
  relayPipeMessage,
  apiMetricsRef,
  loadingStartTimeRef,
  setMessages,
  onTurnComplete,
  messagesRef,
}: {
  initialMcpClients: MCPServerConnection[] | undefined
  store: Store
  diagnosticTracker: {
    handleQueryStart: (clients: MCPServerConnection[]) => void | Promise<void>
  }
  titleDisabled: boolean
  sessionTitle: string | undefined
  agentTitle: string | undefined
  haikuTitleAttemptedRef: React.MutableRefObject<boolean>
  setHaikuTitle: React.Dispatch<React.SetStateAction<string | undefined>>
  toolPermissionContext: ToolPermissionContext
  setAppState: SetAppState
  setConversationId: React.Dispatch<React.SetStateAction<UUID>>
  resetLoadingState: () => void
  setAbortController: (controller: AbortController | null) => void
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ToolUseContext
  terminalFocusRef: React.MutableRefObject<boolean>
  mainThreadAgentDefinition: AgentDefinition | undefined
  customSystemPrompt: string | undefined
  appendSystemPrompt: string | undefined
  canUseTool: CanUseToolFn
  onQueryEvent: (event: Parameters<typeof handleMessageFromStream>[0]) => void
  pipeReturnHadErrorRef: React.MutableRefObject<boolean>
  relayPipeMessage: (message: PipeMessage) => boolean
  apiMetricsRef: React.MutableRefObject<ApiMetric[]>
  loadingStartTimeRef: React.MutableRefObject<number>
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  onTurnComplete:
    | ((messages: MessageType[]) => void | Promise<void>)
    | undefined
  messagesRef: React.MutableRefObject<MessageType[]>
}) {
  return useCallback(
    async (
      messagesIncludingNewMessages: MessageType[],
      newMessages: MessageType[],
      abortController: AbortController,
      shouldQuery: boolean,
      additionalAllowedTools: string[],
      mainLoopModel: string,
      effort?: EffortValue,
    ) => {
      if (shouldQuery) {
        const freshClients = mergeClients(
          initialMcpClients,
          store.getState().mcp.clients,
        )
        void diagnosticTracker.handleQueryStart(freshClients)
        const ideClient = getConnectedIdeClient(freshClients)
        if (ideClient) void closeOpenDiffs(ideClient)
      }
      void maybeMarkProjectOnboardingComplete()

      if (
        !titleDisabled &&
        !sessionTitle &&
        !agentTitle &&
        !haikuTitleAttemptedRef.current
      ) {
        const firstUserMessage = newMessages.find(
          message => message.type === 'user' && !message.isMeta,
        )
        const text =
          firstUserMessage?.type === 'user'
            ? getContentText(
                firstUserMessage.message!.content as
                  | string
                  | ContentBlockParam[],
              )
            : null
        if (
          text &&
          !text.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}>`) &&
          !text.startsWith(`<${COMMAND_MESSAGE_TAG}>`) &&
          !text.startsWith(`<${COMMAND_NAME_TAG}>`) &&
          !text.startsWith(`<${BASH_INPUT_TAG}>`)
        ) {
          haikuTitleAttemptedRef.current = true
          void generateSessionTitle(text, new AbortController().signal).then(
            title => {
              if (title) setHaikuTitle(title)
              else haikuTitleAttemptedRef.current = false
            },
            () => {
              haikuTitleAttemptedRef.current = false
            },
          )
        }
      }

      store.setState(previous => {
        const current = previous.toolPermissionContext.alwaysAllowRules.command
        if (
          current === additionalAllowedTools ||
          (current?.length === additionalAllowedTools.length &&
            current.every(
              (value, index) => value === additionalAllowedTools[index],
            ))
        ) {
          return previous
        }
        return {
          ...previous,
          toolPermissionContext: {
            ...previous.toolPermissionContext,
            alwaysAllowRules: {
              ...previous.toolPermissionContext.alwaysAllowRules,
              command: additionalAllowedTools,
            },
          },
        }
      })

      if (!shouldQuery) {
        if (newMessages.some(isCompactBoundaryMessage)) {
          setConversationId(randomUUID())
          proactiveModule?.setContextBlocked(false)
        }
        resetLoadingState()
        setAbortController(null)
        return
      }

      const toolUseContext = getToolUseContext(
        messagesIncludingNewMessages,
        newMessages,
        abortController,
        mainLoopModel,
      )
      const { tools, mcpClients } = toolUseContext.options
      if (effort !== undefined) {
        const previousGetAppState = toolUseContext.getAppState
        toolUseContext.getAppState = () => ({
          ...previousGetAppState(),
          effortValue: effort,
        })
      }

      queryCheckpoint('query_context_loading_start')
      const [, , defaultSystemPrompt, baseUserContext, systemContext] =
        await Promise.all([
          undefined,
          feature('TRANSCRIPT_CLASSIFIER')
            ? checkAndDisableAutoModeIfNeeded(
                toolPermissionContext,
                setAppState,
                store.getState().fastMode,
              )
            : undefined,
          getSystemPrompt(
            tools,
            mainLoopModel,
            Array.from(
              toolPermissionContext.additionalWorkingDirectories.keys(),
            ),
            mcpClients,
          ),
          getUserContext(),
          getSystemContext(),
        ])
      const userContext = {
        ...baseUserContext,
        ...getCoordinatorUserContext(
          mcpClients,
          isScratchpadEnabled() ? getScratchpadDir() : undefined,
        ),
        ...((feature('PROACTIVE') || feature('KAIROS')) &&
        proactiveModule?.isProactiveActive() &&
        !terminalFocusRef.current
          ? {
              terminalFocus:
                'The terminal is unfocused — the user is not actively watching.',
            }
          : {}),
      }
      queryCheckpoint('query_context_loading_end')

      const systemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt,
      })
      toolUseContext.renderedSystemPrompt = systemPrompt
      queryCheckpoint('query_query_start')
      resetTurnHookDuration()
      resetTurnToolDuration()
      resetTurnClassifierDuration()
      for await (const event of query({
        messages: messagesIncludingNewMessages,
        systemPrompt,
        userContext,
        systemContext,
        canUseTool,
        toolUseContext,
        querySource: getQuerySourceForREPL(),
      })) {
        onQueryEvent(event)
      }

      if (
        feature('BUDDY') &&
        typeof (globalThis as Record<string, unknown>).fireCompanionObserver ===
          'function'
      ) {
        const observe = (globalThis as Record<string, unknown>)
          .fireCompanionObserver as (
          messages: unknown,
          callback: (reaction: unknown) => void,
        ) => void
        void observe(messagesRef.current, reaction =>
          setAppState(previous =>
            previous.companionReaction ===
            (reaction as typeof previous.companionReaction)
              ? previous
              : {
                  ...previous,
                  companionReaction:
                    reaction as typeof previous.companionReaction,
                },
          ),
        )
      }
      queryCheckpoint('query_end')
      if (feature('UDS_INBOX') && abortController.signal.aborted) {
        pipeReturnHadErrorRef.current = true
        relayPipeMessage({
          type: 'error',
          data: 'Slave request was interrupted before completion.',
        })
      }

      if (process.env.USER_TYPE === 'ant' && apiMetricsRef.current.length > 0) {
        const entries = apiMetricsRef.current
        const ttfts = entries.map(entry => entry.ttftMs)
        const rates = entries.map(entry => {
          const tokens = Math.round(
            (entry.endResponseLength - entry.responseLengthBaseline) / 4,
          )
          const duration = entry.lastTokenTime - entry.firstTokenTime
          return duration > 0 ? Math.round(tokens / (duration / 1000)) : 0
        })
        const multiple = entries.length > 1
        const turnMs = Date.now() - loadingStartTimeRef.current
        setMessages(previous => [
          ...previous,
          createApiMetricsMessage({
            ttftMs: multiple ? median(ttfts) : ttfts[0]!,
            otps: multiple ? median(rates) : rates[0]!,
            isP50: multiple,
            hookDurationMs: getTurnHookDurationMs() || undefined,
            hookCount: getTurnHookCount() || undefined,
            turnDurationMs: turnMs || undefined,
            toolDurationMs: getTurnToolDurationMs() || undefined,
            toolCount: getTurnToolCount() || undefined,
            classifierDurationMs: getTurnClassifierDurationMs() || undefined,
            classifierCount: getTurnClassifierCount() || undefined,
            configWriteCount: getGlobalConfigWriteCount(),
          }),
        ])
      }
      resetLoadingState()
      logQueryProfileReport()
      await onTurnComplete?.(messagesRef.current)
    },
    [
      initialMcpClients,
      store,
      diagnosticTracker,
      titleDisabled,
      sessionTitle,
      agentTitle,
      haikuTitleAttemptedRef,
      setHaikuTitle,
      toolPermissionContext,
      setAppState,
      setConversationId,
      resetLoadingState,
      setAbortController,
      getToolUseContext,
      terminalFocusRef,
      mainThreadAgentDefinition,
      customSystemPrompt,
      appendSystemPrompt,
      canUseTool,
      onQueryEvent,
      pipeReturnHadErrorRef,
      relayPipeMessage,
      apiMetricsRef,
      loadingStartTimeRef,
      setMessages,
      onTurnComplete,
      messagesRef,
    ],
  )
}
