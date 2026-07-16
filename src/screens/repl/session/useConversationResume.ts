import type { AgentDefinition } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { feature } from 'bun:bundle'
import { dirname } from 'path'
import { useCallback } from 'react'
import type { UUID } from 'crypto'
import {
  getOriginalCwd,
  setCostStateForRestore,
  switchSession,
} from '../../../bootstrap/state.js'
import {
  getStoredSessionCosts,
  resetCostState,
  saveCurrentSessionCosts,
} from '../../../cost-tracker.js'
import { restoreRemoteAgentTasks } from '../../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import type { Message as MessageType } from '../../../types/message.js'
import type { ResumeEntrypoint } from '../../../types/command.js'
import type { LogOption } from '../../../types/logs.js'
import { asSessionId } from '../../../types/ids.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../services/analytics/index.js'
import { copyPlanForFork, copyPlanForResume } from '../../../utils/plans.js'
import { deserializeMessages } from '../../../utils/conversationRecovery.js'
import { copyFileHistoryForResume } from '../../../utils/fileHistory.js'
import {
  executeSessionEndHooks,
  getSessionEndHookTimeoutMs,
} from '../../../utils/hooks.js'
import { createSystemMessage } from '../../../utils/messages.js'
import { processSessionStartHooks } from '../../../utils/sessionStart.js'
import {
  computeStandaloneAgentContext,
  exitRestoredWorktree,
  restoreAgentFromSession,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
} from '../../../utils/sessionRestore.js'
import {
  adoptResumedSessionFile,
  clearSessionMetadata,
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveWorktreeState,
} from '../../../utils/sessionStorage.js'
import type { ContentReplacementState } from '../../../utils/toolResultStorage.js'
import { reconstructContentReplacementState } from '../../../utils/toolResultStorage.js'
import { updateSessionName } from '../../../utils/concurrentSessions.js'
import { getCurrentWorktreeSession } from '../../../utils/worktree.js'
import type {
  useAppStateStore,
  useSetAppState,
} from '../../../state/AppState.js'
import type { AppState } from '../../../state/AppStateStore.js'

type Store = ReturnType<typeof useAppStateStore>
type SetAppState = ReturnType<typeof useSetAppState>

export function useConversationResume({
  store,
  setAppState,
  mainThreadAgentDefinition,
  initialMainThreadAgentDefinition,
  agentDefinitions,
  mainLoopModel,
  setMainThreadAgentDefinition,
  restoreReadFileState,
  resetLoadingState,
  setAbortController,
  setConversationId,
  haikuTitleAttemptedRef,
  setHaikuTitle,
  contentReplacementStateRef,
  setMessages,
  setToolJSX,
  setInputValue,
}: {
  store: Store
  setAppState: SetAppState
  mainThreadAgentDefinition: AgentDefinition | undefined
  initialMainThreadAgentDefinition: AgentDefinition | undefined
  agentDefinitions: AppState['agentDefinitions']
  mainLoopModel: string
  setMainThreadAgentDefinition: React.Dispatch<
    React.SetStateAction<AgentDefinition | undefined>
  >
  restoreReadFileState: (messages: MessageType[], cwd: string) => void
  resetLoadingState: () => void
  setAbortController: (controller: AbortController | null) => void
  setConversationId: React.Dispatch<React.SetStateAction<UUID>>
  haikuTitleAttemptedRef: React.MutableRefObject<boolean>
  setHaikuTitle: React.Dispatch<React.SetStateAction<string | undefined>>
  contentReplacementStateRef: React.MutableRefObject<
    ContentReplacementState | undefined
  >
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setToolJSX: (value: null) => void
  setInputValue: (value: string) => void
}) {
  return useCallback(
    async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
      const resumeStart = performance.now()
      try {
        const messages = deserializeMessages(log.messages)
        if (feature('COORDINATOR_MODE')) {
          const coordinatorModule =
            require('../../../coordinator/coordinatorMode.js') as typeof import('../../../coordinator/coordinatorMode.js')
          const warning = coordinatorModule.matchSessionMode(log.mode)
          if (warning) {
            const {
              getAgentDefinitionsWithOverrides,
              getActiveAgentsFromList,
            } =
              require('@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js') as typeof import('@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js')
            getAgentDefinitionsWithOverrides.cache.clear?.()
            const freshAgentDefs = await getAgentDefinitionsWithOverrides(
              getOriginalCwd(),
            )
            setAppState(previous => ({
              ...previous,
              agentDefinitions: {
                ...freshAgentDefs,
                allAgents: freshAgentDefs.allAgents,
                activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
              },
            }))
            messages.push(createSystemMessage(warning, 'warning'))
          }
        }

        const timeoutMs = getSessionEndHookTimeoutMs()
        await executeSessionEndHooks('resume', {
          getAppState: () => store.getState(),
          setAppState,
          signal: AbortSignal.timeout(timeoutMs),
          timeoutMs,
        })
        messages.push(
          ...(await processSessionStartHooks('resume', {
            sessionId,
            agentType: mainThreadAgentDefinition?.agentType,
            model: mainLoopModel,
          })),
        )

        if (entrypoint === 'fork')
          void copyPlanForFork(log, asSessionId(sessionId))
        else void copyPlanForResume(log, asSessionId(sessionId))
        restoreSessionStateFromLog(log, setAppState)
        if (log.fileHistorySnapshots) void copyFileHistoryForResume(log)

        const { agentDefinition: restoredAgent } = restoreAgentFromSession(
          log.agentSetting,
          initialMainThreadAgentDefinition,
          agentDefinitions,
        )
        setMainThreadAgentDefinition(restoredAgent)
        setAppState(previous => ({
          ...previous,
          agent: restoredAgent?.agentType,
        }))
        setAppState(previous => ({
          ...previous,
          standaloneAgentContext: computeStandaloneAgentContext(
            log.agentName,
            log.agentColor,
          ),
        }))
        void updateSessionName(log.agentName)
        restoreReadFileState(messages, log.projectPath ?? getOriginalCwd())
        resetLoadingState()
        setAbortController(null)
        setConversationId(sessionId)

        const targetCosts = getStoredSessionCosts(sessionId)
        saveCurrentSessionCosts()
        resetCostState()
        switchSession(
          asSessionId(sessionId),
          log.fullPath ? dirname(log.fullPath) : null,
        )
        const { renameRecordingForSession } = await import(
          '../../../utils/asciicast.js'
        )
        await renameRecordingForSession()
        await resetSessionFilePointer()
        clearSessionMetadata()
        restoreSessionMetadata(log)

        if (feature('GOAL') && log.goal) {
          const { hydrateGoalFromTranscript } =
            require('../../../services/goal/goalStorage.js') as typeof import('../../../services/goal/goalStorage.js')
          const goals = new Map<
            UUID,
            import('../../../types/logs.js').GoalState
          >()
          goals.set(sessionId, log.goal)
          hydrateGoalFromTranscript(goals, sessionId)
        }
        haikuTitleAttemptedRef.current = true
        setHaikuTitle(undefined)

        if (entrypoint !== 'fork') {
          exitRestoredWorktree()
          restoreWorktreeForResume(log.worktreeSession)
          adoptResumedSessionFile()
          void restoreRemoteAgentTasks({
            abortController: new AbortController(),
            getAppState: () => store.getState(),
            setAppState,
          })
        } else {
          const worktree = getCurrentWorktreeSession()
          if (worktree) saveWorktreeState(worktree)
        }

        if (feature('COORDINATOR_MODE')) {
          const { saveMode } = require('../../../utils/sessionStorage.js')
          const { isCoordinatorMode } =
            require('../../../coordinator/coordinatorMode.js') as typeof import('../../../coordinator/coordinatorMode.js')
          saveMode(isCoordinatorMode() ? 'coordinator' : 'normal')
        }
        if (targetCosts) setCostStateForRestore(targetCosts)
        if (contentReplacementStateRef.current && entrypoint !== 'fork') {
          contentReplacementStateRef.current =
            reconstructContentReplacementState(
              messages,
              log.contentReplacements ?? [],
            )
        }
        setMessages(() => messages)
        setToolJSX(null)
        setInputValue('')
        logEvent('tengu_session_resumed', {
          entrypoint:
            entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: true,
          resume_duration_ms: Math.round(performance.now() - resumeStart),
        })
      } catch (error) {
        logEvent('tengu_session_resumed', {
          entrypoint:
            entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: false,
        })
        throw error
      }
    },
    [
      store,
      setAppState,
      mainThreadAgentDefinition,
      initialMainThreadAgentDefinition,
      agentDefinitions,
      mainLoopModel,
      setMainThreadAgentDefinition,
      restoreReadFileState,
      resetLoadingState,
      setAbortController,
      setConversationId,
      haikuTitleAttemptedRef,
      setHaikuTitle,
      contentReplacementStateRef,
      setMessages,
      setToolJSX,
      setInputValue,
    ],
  )
}
