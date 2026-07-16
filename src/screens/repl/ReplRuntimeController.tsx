// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import { buildDisplayedAgentMessages } from './agents/agentMessages.js';
import { useReplAgentState } from './agents/useReplAgentState.js';
import { useAgentActions } from './agents/useAgentActions.js';
import { useMessageTimeline } from './session/useMessageTimeline.js';
import { useConversationResume } from './session/useConversationResume.js';
import { useConversationActions } from './session/useConversationActions.js';
import { useReplInputState } from './input/useReplInputState.js';
import { usePromptSubmission } from './input/usePromptSubmission.js';
import { useTranscriptControls } from './input/useTranscriptControls.js';
import { AnimatedTerminalTitle, median, TranscriptModeFooter, TranscriptSearchBar } from './view/TranscriptChrome.js';
import { TranscriptScreen } from './view/TranscriptScreen.js';
import { selectFocusedInputDialog, type FocusedInputDialog } from './view/dialogFocus.js';
import { useCancelInteraction } from './interaction/useCancelInteraction.js';
import { useExitInteraction } from './interaction/useExitInteraction.js';
import { ReplView } from './view/ReplView.js';
import { spawnSync } from 'child_process';
import {
  snapshotOutputTokensForTurn,
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  getBudgetContinuationCount,
  getTotalInputTokens,
} from '../../bootstrap/state.js';
import { parseTokenBudget } from '../../utils/tokenBudget.js';
import { count } from '../../utils/array.js';
import { dirname } from 'path';
import { type TabStatusKind, Box, Text, useStdin, useTheme, useTerminalFocus, useTabStatus } from '@anthropic/ink';
import { CostThresholdDialog } from '../../components/CostThresholdDialog.js';
import { IdleReturnDialog } from '../../components/IdleReturnDialog.js';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { useNotifications } from '../../context/notifications.js';
import { sendNotification } from '../../services/notifier.js';
import { startPreventSleep, stopPreventSleep } from '../../services/preventSleep.js';
import { useTerminalNotification, hasCursorUpViewportYankBug } from '@anthropic/ink';
import {
  createFileStateCacheWithSizeLimit,
  mergeFileStateCaches,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js';
import {
  updateLastInteractionTime,
  getLastInteractionTime,
  getOriginalCwd,
  getProjectRoot,
  getSessionId,
  switchSession,
  setCostStateForRestore,
  getTurnHookDurationMs,
  getTurnHookCount,
  resetTurnHookDuration,
  getTurnToolDurationMs,
  getTurnToolCount,
  resetTurnToolDuration,
  getTurnClassifierDurationMs,
  getTurnClassifierCount,
  resetTurnClassifierDuration,
} from '../../bootstrap/state.js';
import { asSessionId } from '../../types/ids.js';
import { logForDebugging } from '../../utils/debug.js';
import { QueryGuard } from '../../utils/QueryGuard.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatTokens, truncateToWidth } from '../../utils/format.js';
import {
  claimConsumableQueuedAutonomyCommands,
  finalizeAutonomyCommandsForTurn,
} from '../../utils/autonomyQueueLifecycle.js';

import { setMemberActive } from '../../utils/swarm/teamHelpers.js';
import {
  isSwarmWorker,
  generateSandboxRequestId,
  sendSandboxPermissionRequestViaMailbox,
  sendSandboxPermissionResponseViaMailbox,
} from '../../utils/swarm/permissionSync.js';
import { registerSandboxPermissionCallback } from '../../hooks/useSwarmPermissionPoller.js';
import { getTeamName, getAgentName } from '../../utils/teammate.js';
import { WorkerPendingPermission } from '../../components/permissions/WorkerPendingPermission.js';
import {
  injectUserMessageToTeammate,
  getAllInProcessTeammateTasks,
} from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import {
  isLocalAgentTask,
  queuePendingMessage,
  appendMessageToLocalAgent,
  type LocalAgentTaskState,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import {
  registerLeaderToolUseConfirmQueue,
  unregisterLeaderToolUseConfirmQueue,
  registerLeaderSetToolPermissionContext,
  unregisterLeaderSetToolPermissionContext,
} from '../../utils/swarm/leaderPermissionBridge.js';
import { endInteractionSpan } from '../../utils/telemetry/sessionTracing.js';
import { useLogMessages } from '../../hooks/useLogMessages.js';
import { useReplBridge } from '../../hooks/useReplBridge.js';
import {
  type Command,
  type CommandResultDisplay,
  type ResumeEntrypoint,
  getCommandName,
  isCommandEnabled,
} from '../../commands.js';
import type { QueuedCommand, VimMode } from '../../types/textInputTypes.js';
import {
  MessageSelector,
  selectableUserMessagesFilter,
  messagesAfterAreOnlySynthetic,
} from '../../components/MessageSelector.js';
import { useIdeLogging } from '../../hooks/useIdeLogging.js';
import { PermissionRequest, type ToolUseConfirm } from '../../components/permissions/PermissionRequest.js';
import { ElicitationDialog } from '../../components/mcp/ElicitationDialog.js';
import { PromptDialog } from '../../components/hooks/PromptDialog.js';
import type { PromptRequest, PromptResponse } from '../../types/hooks.js';
import PromptInput from '../../components/PromptInput/PromptInput.js';
import { PromptInputQueuedCommands } from '../../components/PromptInput/PromptInputQueuedCommands.js';
import type { DirectConnectConfig } from '../../server/directConnectManager.js';
import type { SSHSession } from '../../ssh/createSSHSession.js';
import { SkillImprovementSurvey } from '../../components/SkillImprovementSurvey.js';
import { useSkillImprovementSurvey } from '../../hooks/useSkillImprovementSurvey.js';
import { useMoreRight } from '../../moreright/useMoreRight.js';
import { SpinnerWithVerb, BriefIdleStatus, type SpinnerMode } from '../../components/Spinner.js';
import { getSystemPrompt } from '../../constants/prompts.js';
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js';
import { getSystemContext, getUserContext } from '../../context.js';
import { getMemoryFiles } from '../../utils/claudemd.js';
import { startBackgroundHousekeeping } from '../../utils/backgroundHousekeeping.js';
import { getTotalCost, saveCurrentSessionCosts, resetCostState, getStoredSessionCosts } from '../../cost-tracker.js';
import { useCostSummary } from '../../costHook.js';
import { useFpsMetrics } from '../../context/fpsMetrics.js';
import { useAfterFirstRender } from '../../hooks/useAfterFirstRender.js';
import { addToHistory, removeLastFromHistory, expandPastedTextRefs, parseReferences } from '../../history.js';
import { prependModeCharacterToInput } from '../../components/PromptInput/inputModes.js';
import { prependToShellHistoryCache } from '../../utils/suggestions/shellHistoryCompletion.js';
import { useApiKeyVerification } from '../../hooks/useApiKeyVerification.js';
import { GlobalKeybindingHandlers } from '../../hooks/useGlobalKeybindings.js';
import { CommandKeybindingHandlers } from '../../hooks/useCommandKeybindings.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js';
import { CancelRequestHandler } from '../../hooks/useCancelRequest.js';
import { useBackgroundTaskNavigation } from '../../hooks/useBackgroundTaskNavigation.js';
import { useSwarmInitialization } from '../../hooks/useSwarmInitialization.js';
import { useTeammateViewAutoExit } from '../../hooks/useTeammateViewAutoExit.js';
import { errorMessage, toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { getCwd } from '../../utils/cwd.js';
// Dead code elimination: conditional imports
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
// Frustration detection is ant-only (dogfooding). Conditional require so external
// builds eliminate the module entirely (including its two O(n) useMemos that run
// on every messages change, plus the GrowthBook fetch).
const useFrustrationDetection: typeof import('../../components/FeedbackSurvey/useFrustrationDetection.js').useFrustrationDetection =
  process.env.USER_TYPE === 'ant'
    ? require('../../components/FeedbackSurvey/useFrustrationDetection.js').useFrustrationDetection
    : () => ({ state: 'closed', handleTranscriptSelect: () => {} });
// Ant-only org warning. Conditional require so the org UUID list is
// eliminated from external builds (one UUID is on excluded-strings).
const useAntOrgWarningNotification: typeof import('../../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification =
  process.env.USER_TYPE === 'ant'
    ? require('../../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification
    : () => {};
// Dead code elimination: conditional import for coordinator mode
const getCoordinatorUserContext: (
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
) => { [k: string]: string } = feature('COORDINATOR_MODE')
  ? require('../../coordinator/coordinatorMode.js').getCoordinatorUserContext
  : () => ({});
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import useCanUseTool from '../../hooks/useCanUseTool.js';
import type { ToolPermissionContext, Tool } from '../../Tool.js';
import { notifyAutomationStateChanged } from '../../utils/sessionState.js';
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  persistPermissionUpdate,
} from '../../utils/permissions/PermissionUpdate.js';
import { buildPermissionUpdates } from '../../components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js';
import { stripDangerousPermissionsForAutoMode } from '../../utils/permissions/permissionSetup.js';
import { getScratchpadDir, isScratchpadEnabled } from '../../utils/permissions/filesystem.js';
import { WEB_FETCH_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/WebFetchTool/prompt.js';
import { SLEEP_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/SleepTool/prompt.js';
import { clearSpeculativeChecks } from '@claude-code-best/builtin-tools/tools/BashTool/bashPermissions.js';
import { getGlobalConfig, saveGlobalConfig, getGlobalConfigWriteCount } from '../../utils/config.js';
import { hasConsoleBillingAccess } from '../../utils/billing.js';
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  textForResubmit,
  handleMessageFromStream,
  type StreamingToolUse,
  type StreamingThinking,
  isCompactBoundaryMessage,
  getMessagesAfterCompactBoundary,
  getContentText,
  createUserMessage,
  createAssistantMessage,
  createTurnDurationMessage,
  createAgentsKilledMessage,
  createApiMetricsMessage,
  createSystemMessage,
  createCommandInputMessage,
  formatCommandInputTags,
} from '../../utils/messages.js';
import { generateSessionTitle } from '../../utils/sessionTitle.js';
import {
  BASH_INPUT_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../../constants/xml.js';
import { escapeXml } from '../../utils/xml.js';
import type { ThinkingConfig } from '../../utils/thinking.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { handlePromptSubmit, type PromptInputHelpers } from '../../utils/handlePromptSubmit.js';
import { useQueueProcessor } from '../../hooks/useQueueProcessor.js';
import { queryCheckpoint, logQueryProfileReport } from '../../utils/queryProfiler.js';
import type {
  Message as MessageType,
  UserMessage,
  ProgressMessage,
  HookResultMessage,
  PartialCompactDirection,
} from '../../types/message.js';
import { query } from '../../query.js';
import { mergeClients, useMergedClients } from '../../hooks/useMergedClients.js';
import { getQuerySourceForREPL } from '../../utils/promptCategory.js';
import { useMergedTools } from '../../hooks/useMergedTools.js';
import { mergeAndFilterTools } from '../../utils/toolPool.js';
import { useMergedCommands } from '../../hooks/useMergedCommands.js';
import { useSkillsChange } from '../../hooks/useSkillsChange.js';
import { useManagePlugins } from '../../hooks/useManagePlugins.js';
import { Messages } from '../../components/Messages.js';
import { TaskListV2 } from '../../components/TaskListV2.js';
import { TeammateViewHeader } from '../../components/TeammateViewHeader.js';
import { useTasksV2WithCollapseEffect } from '../../hooks/useTasksV2.js';
import { maybeMarkProjectOnboardingComplete } from '../../projectOnboardingState.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { randomUUID, type UUID } from 'crypto';
import { processSessionStartHooks } from '../../utils/sessionStart.js';
import { executeSessionEndHooks, getSessionEndHookTimeoutMs } from '../../utils/hooks.js';
import { type IDESelection, useIdeSelection } from '../../hooks/useIdeSelection.js';
import { getTools, assembleToolPool } from '../../tools.js';
import type { AgentDefinition } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { resolveAgentTools } from '@claude-code-best/builtin-tools/tools/AgentTool/agentToolUtils.js';
import { resumeAgentBackground } from '@claude-code-best/builtin-tools/tools/AgentTool/resumeAgent.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useAppState, useAppStateStore } from '../../state/AppState.js';
import type { ContentBlockParam, ContentBlock, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import type { PastedContent } from '../../utils/config.js';
import type { InternalPermissionMode } from '../../types/permissions.js';
import { copyPlanForFork, copyPlanForResume, getPlanSlug, setPlanSlug } from '../../utils/plans.js';
import {
  clearSessionMetadata,
  resetSessionFilePointer,
  adoptResumedSessionFile,
  removeTranscriptMessage,
  restoreSessionMetadata,
  getCurrentSessionTitle,
  isEphemeralToolProgress,
  isLoggableMessage,
  saveWorktreeState,
} from '../../utils/sessionStorage.js';
import { deserializeMessages } from '../../utils/conversationRecovery.js';
import { extractReadFilesFromMessages, extractBashToolsFromMessages } from '../../utils/queryHelpers.js';
import { resetMicrocompactState } from '../../services/compact/microCompact.js';
import { runPostCompactCleanup, registerCompactCleanup } from '../../services/compact/postCompactCleanup.js';
import {
  createContentReplacementState,
  provisionContentReplacementState,
  reconstructContentReplacementState,
  type ContentReplacementRecord,
} from '../../utils/toolResultStorage.js';
import { partialCompactConversation } from '../../services/compact/compact.js';
import type { LogOption } from '../../types/logs.js';
import type { AgentColorName } from '@claude-code-best/builtin-tools/tools/AgentTool/agentColorManager.js';
import {
  fileHistoryMakeSnapshot,
  type FileHistoryState,
  fileHistoryRewind,
  type FileHistorySnapshot,
  copyFileHistoryForResume,
  fileHistoryEnabled,
  fileHistoryHasAnyChanges,
} from '../../utils/fileHistory.js';
import { type AttributionState, incrementPromptCount } from '../../utils/commitAttribution.js';
import { recordAttributionSnapshot } from '../../utils/sessionStorage.js';
import {
  computeStandaloneAgentContext,
  restoreAgentFromSession,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
  exitRestoredWorktree,
} from '../../utils/sessionRestore.js';
import { isBgSession, updateSessionName, updateSessionActivity } from '../../utils/concurrentSessions.js';
import { type InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { restoreRemoteAgentTasks } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { BackgroundAgentSelector } from '../../components/tasks/BackgroundAgentSelector.js';
import { usePipeLifecycle, usePipeRouting } from './runtime/usePipeRuntime.js';
import { useRemoteRuntime } from './runtime/useRemoteRuntime.js';
import { useQueryMetrics } from './query/useQueryMetrics.js';
import { useQueryEvents } from './query/useQueryEvents.js';
import { useQueryExecution } from './query/useQueryExecution.js';
import { useQueryRunner } from './query/useQueryRunner.js';
// Dead code elimination: conditional import for loop mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/index.js') : null;
const PROACTIVE_NO_OP_SUBSCRIBE = (_cb: () => void) => () => {};
const PROACTIVE_FALSE = () => false;
const PROACTIVE_NULL = (): number | null => null;
const SUGGEST_BG_PR_NOOP = (_p: string, _n: string): boolean => false;
const useProactive =
  feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/useProactive.js').useProactive : null;
const useScheduledTasks = feature('AGENT_TRIGGERS')
  ? require('../../hooks/useScheduledTasks.js').useScheduledTasks
  : null;
const useGoalContinuation: typeof import('../../hooks/useGoalContinuation.js').useGoalContinuation | null = feature(
  'GOAL',
)
  ? require('../../hooks/useGoalContinuation.js').useGoalContinuation
  : null;
/* eslint-enable @typescript-eslint/no-require-imports */
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { useTaskListWatcher } from '../../hooks/useTaskListWatcher.js';
import type { SandboxAskCallback, NetworkHostPattern } from '../../utils/sandbox/sandbox-adapter.js';

import {
  type IDEExtensionInstallationStatus,
  closeOpenDiffs,
  getConnectedIdeClient,
  type IdeType,
} from '../../utils/ide.js';
import { useIDEIntegration } from '../../hooks/useIDEIntegration.js';
import exit from '../../commands/exit/index.js';
import { ExitFlow } from '../../components/ExitFlow.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';
import {
  popAllEditable,
  enqueue,
  type SetAppState,
  getCommandQueue,
  getCommandQueueLength,
  removeByFilter,
} from '../../utils/messageQueueManager.js';
import { useCommandQueue } from '../../hooks/useCommandQueue.js';
import { SessionBackgroundHint } from '../../components/SessionBackgroundHint.js';
import { startBackgroundSession } from '../../tasks/LocalMainSessionTask.js';
import { useSessionBackgrounding } from '../../hooks/useSessionBackgrounding.js';
import { diagnosticTracker } from '../../services/diagnosticTracking.js';
import { handleSpeculationAccept, type ActiveSpeculationState } from '../../services/PromptSuggestion/speculation.js';
import { IdeOnboardingDialog } from '../../components/IdeOnboardingDialog.js';
import { EffortCallout, shouldShowEffortCallout } from '../../components/EffortCallout.js';
import type { EffortValue } from '../../utils/effort.js';
import { RemoteCallout } from '../../components/RemoteCallout.js';
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const AntModelSwitchCallout =
  process.env.USER_TYPE === 'ant' ? require('../../components/AntModelSwitchCallout.js').AntModelSwitchCallout : null;
const shouldShowAntModelSwitch =
  process.env.USER_TYPE === 'ant'
    ? require('../../components/AntModelSwitchCallout.js').shouldShowModelSwitchCallout
    : (): boolean => false;
const UndercoverAutoCallout =
  process.env.USER_TYPE === 'ant' ? require('../../components/UndercoverAutoCallout.js').UndercoverAutoCallout : null;
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import { activityManager } from '../../utils/activityManager.js';
import { createAbortController } from '../../utils/abortController.js';
import { MCPConnectionManager } from 'src/services/mcp/MCPConnectionManager.js';
import { useFeedbackSurvey } from 'src/components/FeedbackSurvey/useFeedbackSurvey.js';
import { useMemorySurvey } from 'src/components/FeedbackSurvey/useMemorySurvey.js';
import { usePostCompactSurvey } from 'src/components/FeedbackSurvey/usePostCompactSurvey.js';
import { FeedbackSurvey } from 'src/components/FeedbackSurvey/FeedbackSurvey.js';
import { useChromeExtensionNotification } from 'src/hooks/useChromeExtensionNotification.js';
import { useOfficialMarketplaceNotification } from 'src/hooks/useOfficialMarketplaceNotification.js';
import { usePromptsFromClaudeInChrome } from 'src/hooks/usePromptsFromClaudeInChrome.js';
import { getTipToShowOnSpinner, recordShownTip } from 'src/services/tips/tipScheduler.js';
import type { Theme } from 'src/utils/theme.js';
import {
  checkAndDisableAutoModeIfNeeded,
  useKickOffCheckAndDisableAutoModeIfNeeded,
} from 'src/utils/permissions/bypassPermissionsKillswitch.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { SANDBOX_NETWORK_ACCESS_TOOL_NAME } from 'src/cli/structuredIO.js';
import { useFileHistorySnapshotInit } from 'src/hooks/useFileHistorySnapshotInit.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { SandboxViolationExpandedView } from 'src/components/SandboxViolationExpandedView.js';
import { useSettingsErrors } from 'src/hooks/notifs/useSettingsErrors.js';
import { useMcpConnectivityStatus } from 'src/hooks/notifs/useMcpConnectivityStatus.js';
import { AUTO_MODE_DESCRIPTION } from 'src/components/AutoModeOptInDialog.js';
import { useLspInitializationNotification } from 'src/hooks/notifs/useLspInitializationNotification.js';
import { useLspPluginRecommendation } from 'src/hooks/useLspPluginRecommendation.js';
import { LspRecommendationMenu } from 'src/components/LspRecommendation/LspRecommendationMenu.js';
import { useClaudeCodeHintRecommendation } from 'src/hooks/useClaudeCodeHintRecommendation.js';
import { PluginHintMenu } from 'src/components/ClaudeCodeHint/PluginHintMenu.js';
import { SearchExtraToolsHint } from 'src/components/SearchExtraToolsHint.js';
import { useSearchExtraToolsHint } from 'src/hooks/useSearchExtraToolsHint.js';
import {
  DesktopUpsellStartup,
  shouldShowDesktopUpsellStartup,
} from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import { usePluginInstallationStatus } from 'src/hooks/notifs/usePluginInstallationStatus.js';
import { usePluginAutoupdateNotification } from 'src/hooks/notifs/usePluginAutoupdateNotification.js';
import { performStartupChecks } from 'src/utils/plugins/performStartupChecks.js';
import { UserTextMessage } from 'src/components/messages/UserTextMessage.js';
import { AwsAuthStatusBox } from '../../components/AwsAuthStatusBox.js';
import { useRateLimitWarningNotification } from 'src/hooks/notifs/useRateLimitWarningNotification.js';
import { useDeprecationWarningNotification } from 'src/hooks/notifs/useDeprecationWarningNotification.js';
import { useIDEStatusIndicator } from 'src/hooks/notifs/useIDEStatusIndicator.js';
import { useModelMigrationNotifications } from 'src/hooks/notifs/useModelMigrationNotifications.js';
import { useCanSwitchToExistingSubscription } from 'src/hooks/notifs/useCanSwitchToExistingSubscription.js';
import { useTeammateLifecycleNotification } from 'src/hooks/notifs/useTeammateShutdownNotification.js';
import { useFastModeNotification } from 'src/hooks/notifs/useFastModeNotification.js';
import {
  AutoRunIssueNotification,
  shouldAutoRunIssue,
  getAutoRunIssueReasonText,
  getAutoRunCommand,
  type AutoRunIssueReason,
} from '../../utils/autoRunIssue.js';
import type { HookProgress } from '../../types/hooks.js';
import { TungstenLiveMonitor } from '@claude-code-best/builtin-tools/tools/TungstenTool/TungstenLiveMonitor.js';
// WebBrowserPanel removed — browser-lite returns results inline via tool_result.
// For full browser interaction use Claude-in-Chrome MCP tools.
import { IssueFlagBanner } from '../../components/PromptInput/IssueFlagBanner.js';
import { useIssueFlagBanner } from '../../hooks/useIssueFlagBanner.js';
import { CompanionSprite, CompanionFloatingBubble, MIN_COLS_FOR_FULL_SPRITE } from '../../buddy/CompanionSprite.js';
import { DevBar } from '../../components/DevBar.js';
import { UltraplanChoiceDialog } from '../../components/ultraplan/UltraplanChoiceDialog.js';
import { UltraplanLaunchDialog } from '../../components/ultraplan/UltraplanLaunchDialog.js';
import { launchUltraplan } from '../../commands/ultraplan.js';
// Session manager removed - using AppState now
import type { RemoteSessionConfig } from '../../remote/RemoteSessionManager.js';
import type { RemoteMessageContent } from '../../utils/teleport/api.js';
import { FullscreenLayout } from '../../components/FullscreenLayout.js';
import { isFullscreenEnvEnabled, maybeGetTmuxMouseHint, isMouseTrackingEnabled } from '../../utils/fullscreen.js';
import { AlternateScreen } from '@anthropic/ink';
import { ScrollKeybindingHandler } from '../../components/ScrollKeybindingHandler.js';
import {
  useMessageActions,
  MessageActionsKeybindings,
  MessageActionsBar,
  type MessageActionCaps,
} from '../../components/messageActions.js';
import { setClipboard } from '@anthropic/ink';
import type { ScrollBoxHandle } from '@anthropic/ink';
import { createAttachmentMessage, getQueuedCommandAttachments } from '../../utils/attachments.js';

// Stable empty array for hooks that accept MCPServerConnection[] — avoids
// creating a new [] literal on every render in remote mode, which would
// cause useEffect dependency changes and infinite re-render loops.
const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

// Stable stub for useAssistantHistory's non-KAIROS branch — avoids a new
// function identity each render, which would break composedOnScroll's memo.
const HISTORY_STUB = { maybeLoadOlder: (_: ScrollBoxHandle) => {} };
// Window after a user-initiated scroll during which type-into-empty does NOT
// repin to bottom. Josh Rosen's workflow: Claude emits long output → scroll
// up to read the start → start typing → before this fix, snapped to bottom.
// https://anthropic.slack.com/archives/C07VBSHV7EV/p1773545449871739
const RECENT_SCROLL_REPIN_WINDOW_MS = 3000;

// Use LRU cache to prevent unbounded memory growth
// 100 files should be sufficient for most coding sessions while preventing
// memory issues when working across many files in large projects

export type Props = {
  commands: Command[];
  debug: boolean;
  initialTools: Tool[];
  // Initial messages to populate the REPL with
  initialMessages?: MessageType[];
  // Deferred hook messages promise — REPL renders immediately and injects
  // hook messages when they resolve. Awaited before the first API call.
  pendingHookMessages?: Promise<HookResultMessage[]>;
  initialFileHistorySnapshots?: FileHistorySnapshot[];
  // Content-replacement records from a resumed session's transcript — used to
  // reconstruct contentReplacementState so the same results are re-replaced
  initialContentReplacements?: ContentReplacementRecord[];
  // Initial agent context for session resume (name/color set via /rename or /color)
  initialAgentName?: string;
  initialAgentColor?: AgentColorName;
  mcpClients?: MCPServerConnection[];
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  autoConnectIdeFlag?: boolean;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  // Optional callback invoked before query execution
  // Called after user message is added to conversation but before API call
  // Return false to prevent query execution
  onBeforeQuery?: (input: string, newMessages: MessageType[]) => Promise<boolean>;
  // Optional callback when a turn completes (model finishes responding)
  onTurnComplete?: (messages: MessageType[]) => void | Promise<void>;
  // When true, disables REPL input (hides prompt and prevents message selector)
  disabled?: boolean;
  // Optional agent definition to use for the main thread
  mainThreadAgentDefinition?: AgentDefinition;
  // When true, disables all slash commands
  disableSlashCommands?: boolean;
  // Task list id: when set, enables tasks mode that watches a task list and auto-processes tasks.
  taskListId?: string;
  // Remote session config for --remote mode (uses CCR as execution engine)
  remoteSessionConfig?: RemoteSessionConfig;
  // Direct connect config for `claude connect` mode (connects to a claude server)
  directConnectConfig?: DirectConnectConfig;
  // SSH session for `claude ssh` mode (local REPL, remote tools over ssh)
  sshSession?: SSHSession;
  // Thinking configuration to use when thinking is enabled
  thinkingConfig: ThinkingConfig;
};

export type Screen = 'prompt' | 'transcript';

export function REPL({
  commands: initialCommands,
  debug,
  initialTools,
  initialMessages,
  pendingHookMessages,
  initialFileHistorySnapshots,
  initialContentReplacements,
  initialAgentName: _initialAgentName,
  initialAgentColor: _initialAgentColor,
  mcpClients: initialMcpClients,
  dynamicMcpConfig: initialDynamicMcpConfig,
  autoConnectIdeFlag,
  strictMcpConfig = false,
  systemPrompt: customSystemPrompt,
  appendSystemPrompt,
  onBeforeQuery,
  onTurnComplete,
  disabled = false,
  mainThreadAgentDefinition: initialMainThreadAgentDefinition,
  disableSlashCommands = false,
  taskListId,
  remoteSessionConfig,
  directConnectConfig,
  sshSession,
  thinkingConfig,
}: Props): React.ReactNode {
  const isRemoteSession = !!remoteSessionConfig;

  // Env-var gates hoisted to mount-time — isEnvTruthy does toLowerCase+trim+
  // includes, and these were on the render path (hot during PageUp spam).
  const titleDisabled = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE), []);
  const moreRightEnabled = useMemo(
    () => process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.CLAUDE_MORERIGHT),
    [],
  );
  const disableVirtualScroll = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL), []);
  const disableMessageActionsRaw = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MESSAGE_ACTIONS), []);
  const disableMessageActions = feature('MESSAGE_ACTIONS') ? disableMessageActionsRaw : false;

  // Log REPL mount/unmount lifecycle
  useEffect(() => {
    logForDebugging(`[REPL:mount] REPL mounted, disabled=${disabled}`);
    return () => logForDebugging(`[REPL:unmount] REPL unmounting`);
  }, [disabled]);

  // Agent definition is state so /resume can update it mid-session
  const [mainThreadAgentDefinition, setMainThreadAgentDefinition] = useState(initialMainThreadAgentDefinition);

  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const verbose = useAppState(s => s.verbose);
  const mcp = useAppState(s => s.mcp);
  const plugins = useAppState(s => s.plugins);
  const fileHistory = useAppState(s => s.fileHistory);
  const initialMessage = useAppState(s => s.initialMessage);
  const queuedCommands = useCommandQueue();
  // feature() is a build-time constant — dead code elimination removes the hook
  // call entirely in external builds, so this is safe despite looking conditional.
  // These fields contain excluded strings that must not appear in external builds.
  const {
    agentDefinitions,
    spinnerTip,
    showExpandedTodos,
    pendingWorkerRequest,
    pendingSandboxRequest,
    teamContext,
    tasks,
    workerSandboxPermissions,
    elicitation,
    ultraplanPendingChoice,
    ultraplanLaunchPending,
    viewingAgentTaskId,
    viewedTeammateTask,
    viewedAgentTask,
    setAppState,
  } = useReplAgentState();

  const store = useAppStateStore();
  const terminal = useTerminalNotification();
  const mainLoopModel = useMainLoopModel();

  // Note: standaloneAgentContext is initialized in main.tsx (via initialState) or
  // ResumeConversation.tsx (via setAppState before rendering REPL) to avoid
  // useEffect-based state initialization on mount (per CLAUDE.md guidelines)

  // Local state for commands (hot-reloadable when skill files change)
  const [localCommands, setLocalCommands] = useState(initialCommands);

  // Watch for skill file changes and reload all commands
  useSkillsChange(isRemoteSession ? undefined : getProjectRoot(), setLocalCommands);

  // Track proactive mode for tools dependency - SleepTool filters by proactive state
  const proactiveActive = React.useSyncExternalStore(
    proactiveModule?.subscribeToProactiveChanges ?? PROACTIVE_NO_OP_SUBSCRIBE,
    proactiveModule?.isProactiveActive ?? PROACTIVE_FALSE,
  );
  const proactiveNextTickAt = React.useSyncExternalStore<number | null>(
    proactiveModule?.subscribeToProactiveChanges ?? PROACTIVE_NO_OP_SUBSCRIBE,
    proactiveModule?.getNextTickAt ?? PROACTIVE_NULL,
  );

  // BriefTool.isEnabled() reads getUserMsgOptIn() from bootstrap state, which
  // /brief flips mid-session alongside isBriefOnly. The memo below needs a
  // React-visible dep to re-run getTools() when that happens; isBriefOnly is
  // the AppState mirror that triggers the re-render. Without this, toggling
  // /brief mid-session leaves the stale tool list (no SendUserMessage) and
  // the model emits plain text the brief filter hides.
  const isBriefOnly = useAppState(s => s.isBriefOnly);

  const localTools = useMemo(
    () => getTools(toolPermissionContext),
    [toolPermissionContext, proactiveActive, isBriefOnly],
  );

  useKickOffCheckAndDisableAutoModeIfNeeded();

  const [dynamicMcpConfig, setDynamicMcpConfig] = useState<Record<string, ScopedMcpServerConfig> | undefined>(
    initialDynamicMcpConfig,
  );

  const onChangeDynamicMcpConfig = useCallback(
    (config: Record<string, ScopedMcpServerConfig>) => {
      setDynamicMcpConfig(config);
    },
    [setDynamicMcpConfig],
  );

  const [screen, setScreen] = useState<Screen>('prompt');
  const { addNotification, removeNotification } = useNotifications();
  const { relayPipeMessage, pipeReturnHadErrorRef, routeToSelectedPipes } = usePipeRouting({
    store,
    setAppState,
    addNotification,
  });

  // eslint-disable-next-line prefer-const
  let trySuggestBgPRIntercept = SUGGEST_BG_PR_NOOP;

  const mcpClients = useMergedClients(initialMcpClients, mcp.clients);

  // IDE integration
  const [ideSelection, setIDESelection] = useState<IDESelection | undefined>(undefined);
  const [ideToInstallExtension, setIDEToInstallExtension] = useState<IdeType | null>(null);
  const [ideInstallationStatus, setIDEInstallationStatus] = useState<IDEExtensionInstallationStatus | null>(null);
  const [showIdeOnboarding, setShowIdeOnboarding] = useState(false);
  // Dead code elimination: model switch callout state (ant-only)
  const [showModelSwitchCallout, setShowModelSwitchCallout] = useState(() => {
    if (process.env.USER_TYPE === 'ant') {
      return shouldShowAntModelSwitch();
    }
    return false;
  });
  const [showEffortCallout, setShowEffortCallout] = useState(() => shouldShowEffortCallout(mainLoopModel));
  const showRemoteCallout = useAppState(s => s.showRemoteCallout);
  const [showDesktopUpsellStartup, setShowDesktopUpsellStartup] = useState(() => shouldShowDesktopUpsellStartup());
  // notifications
  useModelMigrationNotifications();
  useCanSwitchToExistingSubscription();
  useIDEStatusIndicator({ ideSelection, mcpClients, ideInstallationStatus });
  useMcpConnectivityStatus({ mcpClients });
  usePluginInstallationStatus();
  usePluginAutoupdateNotification();
  useSettingsErrors();
  useRateLimitWarningNotification(mainLoopModel);
  useFastModeNotification();
  useDeprecationWarningNotification(mainLoopModel);
  useAntOrgWarningNotification();
  useChromeExtensionNotification();
  useOfficialMarketplaceNotification();
  useLspInitializationNotification();
  useTeammateLifecycleNotification();
  const { recommendation: lspRecommendation, handleResponse: handleLspResponse } = useLspPluginRecommendation();
  const { recommendation: hintRecommendation, handleResponse: handleHintResponse } = useClaudeCodeHintRecommendation();
  const searchExtraToolsHint = useSearchExtraToolsHint();

  // Memoize the combined initial tools array to prevent reference changes
  const combinedInitialTools = useMemo(() => {
    return [...localTools, ...initialTools];
  }, [localTools, initialTools]);

  // Initialize plugin management
  useManagePlugins({ enabled: !isRemoteSession });

  const tasksV2 = useTasksV2WithCollapseEffect();

  // Start background plugin installations

  // SECURITY: This code is guaranteed to run ONLY after the "trust this folder" dialog
  // has been confirmed by the user. The trust dialog is shown in cli.tsx (line ~387)
  // before the REPL component is rendered. The dialog blocks execution until the user
  // accepts, and only then is the REPL component mounted and this effect runs.
  // This ensures that plugin installations from repository and user settings only
  // happen after explicit user consent to trust the current working directory.
  useEffect(() => {
    if (isRemoteSession) return;
    void performStartupChecks(setAppState);
  }, [setAppState, isRemoteSession]);

  // Allow Claude in Chrome MCP to send prompts through MCP notifications
  // and sync permission mode changes to the Chrome extension
  usePromptsFromClaudeInChrome(isRemoteSession ? EMPTY_MCP_CLIENTS : mcpClients, toolPermissionContext.mode);

  // Initialize swarm features: teammate hooks and context
  // Handles both fresh spawns and resumed teammate sessions
  useSwarmInitialization(setAppState, initialMessages, {
    enabled: !isRemoteSession,
  });

  const mergedTools = useMergedTools(combinedInitialTools, mcp.tools, toolPermissionContext);

  // Apply agent tool restrictions if mainThreadAgentDefinition is set
  const { tools, allowedAgentTypes } = useMemo(() => {
    if (!mainThreadAgentDefinition) {
      return {
        tools: mergedTools,
        allowedAgentTypes: undefined as string[] | undefined,
      };
    }
    const resolved = resolveAgentTools(mainThreadAgentDefinition, mergedTools, false, true);
    return {
      tools: resolved.resolvedTools,
      allowedAgentTypes: resolved.allowedAgentTypes,
    };
  }, [mainThreadAgentDefinition, mergedTools]);

  // Merge commands from local state, plugins, and MCP
  const commandsWithPlugins = useMergedCommands(localCommands, plugins.commands as Command[]);
  const mergedCommands = useMergedCommands(commandsWithPlugins, mcp.commands as Command[]);
  // Filter out all commands if disableSlashCommands is true
  const commands = useMemo(() => (disableSlashCommands ? [] : mergedCommands), [disableSlashCommands, mergedCommands]);

  useIdeLogging(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients);
  useIdeSelection(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients, setIDESelection);

  const [streamMode, setStreamMode] = useState<SpinnerMode>('responding');
  // Ref mirror so onSubmit can read the latest value without adding
  // streamMode to its deps. streamMode flips between
  // requesting/responding/tool-use ~10x per turn during streaming; having it
  // in onSubmit's deps was recreating onSubmit on every flip, which
  // cascaded into PromptInput prop churn and downstream useCallback/useMemo
  // invalidation. The only consumers inside callbacks are debug logging and
  // telemetry (handlePromptSubmit.ts), so a stale-by-one-render value is
  // harmless — but ref mirrors sync on every render anyway so it's fresh.
  const streamModeRef = useRef(streamMode);
  streamModeRef.current = streamMode;
  const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
  const [streamingThinking, setStreamingThinking] = useState<StreamingThinking | null>(null);

  // Auto-hide streaming thinking after 30 seconds of being completed
  useEffect(() => {
    if (streamingThinking && !streamingThinking.isStreaming && streamingThinking.streamingEndedAt) {
      const elapsed = Date.now() - streamingThinking.streamingEndedAt;
      const remaining = 30000 - elapsed;
      if (remaining > 0) {
        const timer = setTimeout(setStreamingThinking, remaining, null);
        return () => clearTimeout(timer);
      } else {
        setStreamingThinking(null);
      }
    }
  }, [streamingThinking]);

  const [abortController, setAbortController] = useState<AbortController | null>(null);
  // Ref that always points to the current abort controller, used by the
  // REPL bridge to abort the active query when a remote interrupt arrives.
  const abortControllerRef = useRef<AbortController | null>(null);
  abortControllerRef.current = abortController;

  // Timestamp (ms) of the most recent local-jsx panel dismissal (e.g. ESC on
  // /workflows). Used by onCancel's grace-period guard: the ESC that closes
  // a local-jsx panel (or any quick follow-up ESC within the grace window)
  // must not fall through to abortController.abort('user-cancel') — otherwise
  // closing the /workflows panel via ESC would kill the in-flight Workflow
  // tool. The chat:cancel keybinding's isActive gate (`!isLocalJSXCommand`)
  // only shields the panel while it's mounted; once React commits the
  // unmount, the next ESC reaches onCancel unguarded. This ref closes that
  // race without touching keybinding registration order.
  const localJSXClosedAtRef = useRef(0);

  // Track whether the last turn was user-aborted (Ctrl+C / Escape).
  // When true, useGoalContinuation skips the continuation enqueue so
  // interrupted turns don't spin into an unstoppable loop. Reset to
  // false at the start of the next user-initiated turn.
  const [wasAborted, setWasAborted] = useState(false);

  // Ref for the bridge result callback — set after useReplBridge initializes,
  // read in the onQuery finally block to notify mobile clients that a turn ended.
  const sendBridgeResultRef = useRef<() => void>(() => {});

  // Ref for the synchronous restore callback — set after restoreMessageSync is
  // defined, read in the onQuery finally block for auto-restore on interrupt.
  const restoreMessageSyncRef = useRef<(m: UserMessage) => void>(() => {});

  // Ref to the fullscreen layout's scroll box for keyboard scrolling.
  // Null when fullscreen mode is disabled (ref never attached).
  const scrollRef = useRef<ScrollBoxHandle>(null);
  // Separate ref for the modal slot's inner ScrollBox — passed through
  // FullscreenLayout → ModalContext so Tabs can attach it to its own
  // ScrollBox for tall content (e.g. /status's MCP-server list). NOT
  // keyboard-driven — ScrollKeybindingHandler stays on the outer ref so
  // PgUp/PgDn/wheel always scroll the transcript behind the modal.
  // Plumbing kept for future modal-scroll wiring.
  const modalScrollRef = useRef<ScrollBoxHandle>(null);
  // Timestamp of the last user-initiated scroll (wheel, PgUp/PgDn, ctrl+u,
  // End/Home, G, drag-to-scroll). Stamped in composedOnScroll — the single
  // chokepoint ScrollKeybindingHandler calls for every user scroll action.
  // Programmatic scrolls (repinScroll's scrollToBottom, sticky auto-follow)
  // do NOT go through composedOnScroll, so they don't stamp this. Ref not
  // state: no re-render on every wheel tick.
  const lastUserScrollTsRef = useRef(0);

  // Synchronous state machine for the query lifecycle. Replaces the
  // error-prone dual-state pattern where isLoading (React state, async
  // batched) and isQueryRunning (ref, sync) could desync. See QueryGuard.ts.
  const queryGuard = React.useRef(new QueryGuard()).current;

  // Subscribe to the guard — true during dispatching or running.
  // This is the single source of truth for "is a local query in flight".
  const isQueryActive = React.useSyncExternalStore(queryGuard.subscribe, queryGuard.getSnapshot);

  // Separate loading flag for operations outside the local query guard:
  // remote sessions (useRemoteSession / useDirectConnect) and foregrounded
  // background tasks (useSessionBackgrounding). These don't route through
  // onQuery / queryGuard, so they need their own spinner-visibility state.
  // Initialize true if remote mode with initial prompt (CCR processing it).
  const [isExternalLoading, setIsExternalLoadingRaw] = React.useState(remoteSessionConfig?.hasInitialPrompt ?? false);

  // Derived: any loading source active. Read-only — no setter. Local query
  // loading is driven by queryGuard (reserve/tryStart/end/cancelReservation),
  // external loading by setIsExternalLoading.
  const isLoading = isQueryActive || isExternalLoading;

  // Elapsed time is computed by SpinnerWithVerb from these refs on each
  // animation frame, avoiding a useInterval that re-renders the entire REPL.
  const [userInputOnProcessing, setUserInputOnProcessingRaw] = React.useState<string | undefined>(undefined);
  // messagesRef.current.length at the moment userInputOnProcessing was set.
  // The placeholder hides once displayedMessages grows past this — i.e. the
  // real user message has landed in the visible transcript.
  const userInputBaselineRef = React.useRef(0);
  // True while the submitted prompt is being processed but its user message
  // hasn't reached setMessages yet. setMessages uses this to keep the
  // baseline in sync when unrelated async messages (bridge status, hook
  // results, scheduled tasks) land during that window.
  const userMessagePendingRef = React.useRef(false);

  // Wall-clock time tracking refs for accurate elapsed time calculation
  const loadingStartTimeRef = React.useRef<number>(0);
  const totalPausedMsRef = React.useRef(0);
  const pauseStartTimeRef = React.useRef<number | null>(null);
  const resetTimingRefs = React.useCallback(() => {
    loadingStartTimeRef.current = Date.now();
    totalPausedMsRef.current = 0;
    pauseStartTimeRef.current = null;
  }, []);

  // Reset timing refs inline when isQueryActive transitions false→true.
  // queryGuard.reserve() (in executeUserInput) fires BEFORE processUserInput's
  // first await, but the ref reset in onQuery's try block runs AFTER. During
  // that gap, React renders the spinner with loadingStartTimeRef=0, computing
  // elapsedTimeMs = Date.now() - 0 ≈ 56 years. This inline reset runs on the
  // first render where isQueryActive is observed true — the same render that
  // first shows the spinner — so the ref is correct by the time the spinner
  // reads it. See INC-4549.
  const wasQueryActiveRef = React.useRef(false);
  if (isQueryActive && !wasQueryActiveRef.current) {
    resetTimingRefs();
  }
  wasQueryActiveRef.current = isQueryActive;

  // Wrapper for setIsExternalLoading that resets timing refs on transition
  // to true — SpinnerWithVerb reads these for elapsed time, so they must be
  // reset for remote sessions / foregrounded tasks too (not just local
  // queries, which reset them in onQuery). Without this, a remote-only
  // session would show ~56 years elapsed (Date.now() - 0).
  const setIsExternalLoading = React.useCallback(
    (value: boolean) => {
      setIsExternalLoadingRaw(value);
      if (value) resetTimingRefs();
    },
    [resetTimingRefs],
  );

  // Start time of the first turn that had swarm teammates running
  // Used to compute total elapsed time (including teammate execution) for the deferred message
  const swarmStartTimeRef = React.useRef<number | null>(null);
  const swarmBudgetInfoRef = React.useRef<{ tokens: number; limit: number; nudges: number } | undefined>(undefined);

  // Ref to track current focusedInputDialog for use in callbacks
  // This avoids stale closures when checking dialog state in timer callbacks
  const focusedInputDialogRef = React.useRef<FocusedInputDialog>(undefined);

  // How long after the last keystroke before deferred dialogs are shown
  const PROMPT_SUPPRESSION_MS = 1500;
  // True when user is actively typing — defers interrupt dialogs so keystrokes
  // don't accidentally dismiss or answer a permission prompt the user hasn't read yet.
  const [isPromptInputActive, setIsPromptInputActive] = React.useState(false);

  // tmux + fullscreen + `mouse off`: one-time hint that wheel won't scroll.
  // We no longer mutate tmux's session-scoped mouse option (it poisoned
  // sibling panes); tmux users already know this tradeoff from vim/less.
  useEffect(() => {
    if (isFullscreenEnvEnabled()) {
      void maybeGetTmuxMouseHint().then(hint => {
        if (hint) {
          addNotification({
            key: 'tmux-mouse-hint',
            text: hint,
            priority: 'low',
          });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showUndercoverCallout, setShowUndercoverCallout] = useState(false);
  useEffect(() => {
    if (process.env.USER_TYPE === 'ant') {
      void (async () => {
        // Wait for repo classification to settle (memoized, no-op if primed).
        const { isInternalModelRepo } = await import('../../utils/commitAttribution.js');
        await isInternalModelRepo();
        const { shouldShowUndercoverAutoNotice } = await import('../../utils/undercover.js');
        if (shouldShowUndercoverAutoNotice()) {
          setShowUndercoverCallout(true);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [toolJSX, setToolJSXInternal] = useState<{
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand?: boolean;
    isImmediate?: boolean;
  } | null>(null);

  // Track local JSX commands separately so tools can't overwrite them.
  // This enables "immediate" commands (like /btw) to persist while Claude is processing.
  const localJSXCommandRef = useRef<{
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand: true;
  } | null>(null);

  // Wrapper for setToolJSX that preserves local JSX commands (like /btw).
  // When a local JSX command is active, we ignore updates from tools
  // unless they explicitly set clearLocalJSX: true (from onDone callbacks).
  //
  // TO ADD A NEW IMMEDIATE COMMAND:
  // 1. Set `immediate: true` in the command definition
  // 2. Set `isLocalJSXCommand: true` when calling setToolJSX in the command's JSX
  // 3. In the onDone callback, use `setToolJSX({ jsx: null, shouldHidePromptInput: false, clearLocalJSX: true })`
  //    to explicitly clear the overlay when the user dismisses it
  const setToolJSX = useCallback(
    (
      args: {
        jsx: React.ReactNode | null;
        shouldHidePromptInput: boolean;
        shouldContinueAnimation?: true;
        showSpinner?: boolean;
        isLocalJSXCommand?: boolean;
        clearLocalJSX?: boolean;
      } | null,
    ) => {
      // If setting a local JSX command, store it in the ref
      if (args?.isLocalJSXCommand) {
        const { clearLocalJSX: _, ...rest } = args;
        localJSXCommandRef.current = { ...rest, isLocalJSXCommand: true };
        setToolJSXInternal(rest);
        return;
      }

      // If there's an active local JSX command in the ref
      if (localJSXCommandRef.current) {
        // Allow clearing only if explicitly requested (from onDone callbacks)
        if (args?.clearLocalJSX) {
          localJSXCommandRef.current = null;
          setToolJSXInternal(null);
          // Stamp the dismissal so onCancel's grace-period guard can swallow
          // the ESC that just dismissed the panel (and any quick follow-up).
          localJSXClosedAtRef.current = Date.now();
          return;
        }
        // Otherwise, keep the local JSX command visible - ignore tool updates
        return;
      }

      // No active local JSX command, allow any update
      if (args?.clearLocalJSX) {
        setToolJSXInternal(null);
        return;
      }
      setToolJSXInternal(args);
    },
    [],
  );
  const [toolUseConfirmQueue, setToolUseConfirmQueue] = useState<ToolUseConfirm[]>([]);
  // Sticky footer JSX registered by permission request components (currently
  // only ExitPlanModePermissionRequest). Renders in FullscreenLayout's `bottom`
  // slot so response options stay visible while the user scrolls a long plan.
  const [permissionStickyFooter, setPermissionStickyFooter] = useState<React.ReactNode | null>(null);
  const [sandboxPermissionRequestQueue, setSandboxPermissionRequestQueue] = useState<
    Array<{
      hostPattern: NetworkHostPattern;
      resolvePromise: (allowConnection: boolean) => void;
    }>
  >([]);
  const [promptQueue, setPromptQueue] = useState<
    Array<{
      request: PromptRequest;
      title: string;
      toolInputSummary?: string | null;
      resolve: (response: PromptResponse) => void;
      reject: (error: Error) => void;
    }>
  >([]);

  // Track bridge cleanup functions for sandbox permission requests so the
  // local dialog handler can cancel the remote prompt when the local user
  // responds first. Keyed by host to support concurrent same-host requests.
  const sandboxBridgeCleanupRef = useRef<Map<string, Array<() => void>>>(new Map());

  // -- Terminal title management
  // Session title (set via /rename or restored on resume) wins over
  // the agent name, which wins over the Haiku-extracted topic;
  // all fall back to the product name.
  const terminalTitleFromRename = useAppState(s => s.settings.terminalTitleFromRename) !== false;
  const sessionTitle = terminalTitleFromRename ? getCurrentSessionTitle(getSessionId()) : undefined;
  const [haikuTitle, setHaikuTitle] = useState<string>();
  // Gates the one-shot Haiku call that generates the tab title. Seeded true
  // on resume (initialMessages present) so we don't re-title a resumed
  // session from mid-conversation context.
  const haikuTitleAttemptedRef = useRef((initialMessages?.length ?? 0) > 0);
  const agentTitle = mainThreadAgentDefinition?.agentType;
  const terminalTitle = sessionTitle ?? agentTitle ?? haikuTitle ?? 'Claude Code';
  const isWaitingForApproval =
    toolUseConfirmQueue.length > 0 || promptQueue.length > 0 || pendingWorkerRequest || pendingSandboxRequest;
  // Local-jsx commands (like /plugin, /config) show user-facing dialogs that
  // wait for input. Require jsx != null — if the flag is stuck true but jsx
  // is null, treat as not-showing so TextInput focus and queue processor
  // aren't deadlocked by a phantom overlay.
  const isShowingLocalJSXCommand = toolJSX?.isLocalJSXCommand === true && toolJSX?.jsx != null;
  const titleIsAnimating = isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand;
  // Title animation state lives in <AnimatedTerminalTitle> so the 960ms tick
  // doesn't re-render REPL. titleDisabled/terminalTitle are still computed
  // here because onQueryImpl reads them (background session description,
  // haiku title extraction gate).

  // Prevent macOS from sleeping while Claude is working
  useEffect(() => {
    if (isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand) {
      startPreventSleep();
      return () => stopPreventSleep();
    }
  }, [isLoading, isWaitingForApproval, isShowingLocalJSXCommand]);

  const sessionStatus: TabStatusKind =
    isWaitingForApproval || isShowingLocalJSXCommand ? 'waiting' : isLoading ? 'busy' : 'idle';

  const waitingFor =
    sessionStatus !== 'waiting'
      ? undefined
      : toolUseConfirmQueue.length > 0
        ? `approve ${toolUseConfirmQueue[0]!.tool.name}`
        : pendingWorkerRequest
          ? 'worker request'
          : pendingSandboxRequest
            ? 'sandbox request'
            : isShowingLocalJSXCommand
              ? 'dialog open'
              : 'input needed';

  // Push status to the PID file for `claude ps`. Fire-and-forget; ps falls
  // back to transcript-tail derivation when this is missing/stale.
  useEffect(() => {
    if (feature('BG_SESSIONS')) {
      void updateSessionActivity({ status: sessionStatus, waitingFor });
    }
  }, [sessionStatus, waitingFor]);

  // 3P default: off — OSC 21337 is ant-only while the spec stabilizes.
  // Gated so we can roll back if the sidebar indicator conflicts with
  // the title spinner in terminals that render both. When the flag is
  // on, the user-facing config setting controls whether it's active.
  const tabStatusGateEnabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_sidebar', false);
  const showStatusInTerminalTab = tabStatusGateEnabled && (getGlobalConfig().showStatusInTerminalTab ?? false);
  useTabStatus(titleDisabled || !showStatusInTerminalTab ? null : sessionStatus);

  // Register the leader's setToolUseConfirmQueue for in-process teammates
  useEffect(() => {
    registerLeaderToolUseConfirmQueue(setToolUseConfirmQueue);
    return () => unregisterLeaderToolUseConfirmQueue();
  }, [setToolUseConfirmQueue]);

  const idleHintShownRef = useRef<string | false>(false);
  const {
    messages,
    messagesRef,
    setMessages,
    setUserInputOnProcessing,
    cursor,
    setCursor,
    cursorNavRef,
    unseenDivider,
    dividerYRef,
    jumpToNew,
    repinScroll,
    composedOnScroll,
    awaitPendingHooks,
    deferredMessages,
  } = useMessageTimeline({
    initialMessages,
    pendingHookMessages,
    remoteSessionConfig,
    isLoading,
    scrollRef,
    lastUserScrollTsRef,
    userInputBaselineRef,
    userMessagePendingRef,
    setUserInputOnProcessingRaw,
    setAppState,
  });
  const { inputValue, inputValueRef, setInputValue, inputMode, setInputMode, stashedPrompt, setStashedPrompt } =
    useReplInputState({
      repinScroll,
      lastUserScrollTsRef,
      setIsPromptInputActive,
      trySuggestBgPRIntercept,
    });
  const {
    activeRemote,
    remoteSession,
    inProgressToolUseIDs,
    setInProgressToolUseIDs,
    hasInterruptibleToolInProgressRef,
  } = useRemoteRuntime({
    remoteSessionConfig,
    directConnectConfig,
    sshSession,
    setMessages,
    setIsLoading: setIsExternalLoading,
    setLocalCommands,
    setToolUseConfirmQueue,
    tools: combinedInitialTools,
    setStreamingToolUses,
    setStreamMode,
  });

  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const [submitCount, setSubmitCount] = useState(0);
  // Ref instead of state to avoid triggering React re-renders on every
  // streaming text_delta. The spinner reads this via its animation timer.
  const reducedMotion = useAppState(s => s.settings.prefersReducedMotion) ?? false;
  const showStreamingText = !reducedMotion && !hasCursorUpViewportYankBug();
  const {
    responseLengthRef,
    apiMetricsRef,
    setResponseLength,
    streamingText,
    setStreamingText,
    onStreamingText,
    visibleStreamingText,
  } = useQueryMetrics(showStreamingText);

  // Streaming text display: set state directly per delta (Ink's 16ms render
  // throttle batches rapid updates). Cleared on message arrival (messages.ts)
  // so displayedMessages switches from deferredMessages to messages atomically.

  // Hide the in-progress source line so text streams line-by-line, not
  // char-by-char. lastIndexOf returns -1 when no newline, giving '' → null.
  // Guard on showStreamingText so toggling reducedMotion mid-stream
  // immediately hides the streaming preview.

  const [lastQueryCompletionTime, setLastQueryCompletionTime] = useState(0);
  const [spinnerMessage, setSpinnerMessage] = useState<string | null>(null);
  const [spinnerColor, setSpinnerColor] = useState<keyof Theme | null>(null);
  const [spinnerShimmerColor, setSpinnerShimmerColor] = useState<keyof Theme | null>(null);
  const [isMessageSelectorVisible, setIsMessageSelectorVisible] = useState(false);
  const [messageSelectorPreselect, setMessageSelectorPreselect] = useState<UserMessage | undefined>(undefined);
  const [showCostDialog, setShowCostDialog] = useState(false);
  const [conversationId, setConversationId] = useState(randomUUID());

  // Idle-return dialog: shown when user submits after a long idle gap
  const [idleReturnPending, setIdleReturnPending] = useState<{
    input: string;
    idleMinutes: number;
  } | null>(null);
  const skipIdleCheckRef = useRef(false);
  const lastQueryCompletionTimeRef = useRef(lastQueryCompletionTime);
  lastQueryCompletionTimeRef.current = lastQueryCompletionTime;

  // Aggregate tool result budget: per-conversation decision tracking.
  // When the GrowthBook flag is on, query.ts enforces the budget; when
  // off (undefined), enforcement is skipped entirely. Stale entries after
  // /clear, rewind, or compact are harmless (tool_use_ids are UUIDs, stale
  // keys are never looked up). Memory is bounded by total replacement count
  // × ~2KB preview over the REPL lifetime — negligible.
  //
  // Lazy init via useState initializer — useRef(expr) evaluates expr on every
  // render (React ignores it after first, but the computation still runs).
  // For large resumed sessions, reconstruction does O(messages × blocks)
  // work; we only want that once.
  const [contentReplacementStateRef] = useState(() => ({
    current: provisionContentReplacementState(initialMessages, initialContentReplacements),
  }));
  registerCompactCleanup(() => {
    contentReplacementStateRef.current = createContentReplacementState();
  });

  const [haveShownCostDialog, setHaveShownCostDialog] = useState(getGlobalConfig().hasAcknowledgedCostThreshold);
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const [showBashesDialog, setShowBashesDialog] = useState<string | boolean>(false);
  const [isSearchingHistory, setIsSearchingHistory] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // showBashesDialog is REPL-level so it survives PromptInput unmounting.
  // When ultraplan approval fires while the pill dialog is open, PromptInput
  // unmounts (focusedInputDialog → 'ultraplan-choice') but this stays true;
  // after accepting, PromptInput remounts into an empty "No tasks" dialog
  // (the completed ultraplan task has been filtered out). Close it here.
  useEffect(() => {
    if (ultraplanPendingChoice && showBashesDialog) {
      setShowBashesDialog(false);
    }
  }, [ultraplanPendingChoice, showBashesDialog]);

  const isTerminalFocused = useTerminalFocus();
  const terminalFocusRef = useRef(isTerminalFocused);
  terminalFocusRef.current = isTerminalFocused;

  const [theme] = useTheme();

  // resetLoadingState runs twice per turn (onQueryImpl tail + onQuery finally).
  // Without this guard, both calls pick a tip → two recordShownTip → two
  // saveGlobalConfig writes back-to-back. Reset at submit in onSubmit.
  const tipPickedThisTurnRef = React.useRef(false);
  const pickNewSpinnerTip = useCallback(() => {
    if (tipPickedThisTurnRef.current) return;
    tipPickedThisTurnRef.current = true;
    const newMessages = messagesRef.current.slice(bashToolsProcessedIdx.current);
    for (const tool of extractBashToolsFromMessages(newMessages)) {
      bashTools.current.add(tool);
    }
    bashToolsProcessedIdx.current = messagesRef.current.length;
    void getTipToShowOnSpinner({
      theme,
      readFileState: readFileState.current,
      bashTools: bashTools.current,
    }).then(async tip => {
      if (tip) {
        const content = await tip.content({ theme });
        setAppState(prev => ({
          ...prev,
          spinnerTip: content,
        }));
        recordShownTip(tip);
      } else {
        setAppState(prev => {
          if (prev.spinnerTip === undefined) return prev;
          return { ...prev, spinnerTip: undefined };
        });
      }
    });
  }, [setAppState, theme]);

  // Resets UI loading state. Does NOT call onTurnComplete - that should be
  // called explicitly only when a query turn actually completes.
  const resetLoadingState = useCallback(() => {
    // isLoading is now derived from queryGuard — no setter call needed.
    // queryGuard.end() (onQuery finally) or cancelReservation() (executeUserInput
    // finally) have already transitioned the guard to idle by the time this runs.
    // External loading (remote/backgrounding) is reset separately by those hooks.
    setIsExternalLoading(false);
    setUserInputOnProcessing(undefined);
    responseLengthRef.current = 0;
    apiMetricsRef.current = [];
    setStreamingText(null);
    setStreamingToolUses([]);
    setSpinnerMessage(null);
    setSpinnerColor(null);
    setSpinnerShimmerColor(null);
    pickNewSpinnerTip();
    endInteractionSpan();
    // Speculative bash classifier checks are only valid for the current
    // turn's commands — clear after each turn to avoid accumulating
    // Promise chains for unconsumed checks (denied/aborted paths).
    clearSpeculativeChecks();
  }, [pickNewSpinnerTip]);

  // Session backgrounding — hook is below, after getToolUseContext

  const hasRunningTeammates = useMemo(
    () => getAllInProcessTeammateTasks(tasks).some(t => t.status === 'running'),
    [tasks],
  );

  // Show deferred turn duration message once all swarm teammates finish
  useEffect(() => {
    if (!hasRunningTeammates && swarmStartTimeRef.current !== null) {
      const totalMs = Date.now() - swarmStartTimeRef.current;
      const deferredBudget = swarmBudgetInfoRef.current;
      swarmStartTimeRef.current = null;
      swarmBudgetInfoRef.current = undefined;
      setMessages(prev => [
        ...prev,
        createTurnDurationMessage(
          totalMs,
          deferredBudget,
          // Count only what recordTranscript will persist — ephemeral
          // progress ticks and non-ant attachments are filtered by
          // isLoggableMessage and never reach disk. Using raw prev.length
          // would make checkResumeConsistency report false delta<0 for
          // every turn that ran a progress-emitting tool.
          count(prev, isLoggableMessage),
        ),
      ]);
    }
  }, [hasRunningTeammates, setMessages]);

  // Show auto permissions warning when entering auto mode
  // (either via Shift+Tab toggle or on startup). Debounced to avoid
  // flashing when the user is cycling through modes quickly.
  // Only shown 3 times total across sessions.
  const safeYoloMessageShownRef = useRef(false);
  useEffect(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (toolPermissionContext.mode !== 'auto') {
        safeYoloMessageShownRef.current = false;
        return;
      }
      if (safeYoloMessageShownRef.current) return;
      const config = getGlobalConfig();
      const count = config.autoPermissionsNotificationCount ?? 0;
      if (count >= 3) return;
      const timer = setTimeout(
        (ref, setMessages) => {
          ref.current = true;
          saveGlobalConfig(prev => {
            const prevCount = prev.autoPermissionsNotificationCount ?? 0;
            if (prevCount >= 3) return prev;
            return {
              ...prev,
              autoPermissionsNotificationCount: prevCount + 1,
            };
          });
          setMessages(prev => [...prev, createSystemMessage(AUTO_MODE_DESCRIPTION, 'warning')]);
        },
        800,
        safeYoloMessageShownRef,
        setMessages,
      );
      return () => clearTimeout(timer);
    }
  }, [toolPermissionContext.mode, setMessages]);

  // If worktree creation was slow and sparse-checkout isn't configured,
  // nudge the user toward settings.worktree.sparsePaths.
  const worktreeTipShownRef = useRef(false);
  useEffect(() => {
    if (worktreeTipShownRef.current) return;
    const wt = getCurrentWorktreeSession();
    if (!wt?.creationDurationMs || wt.usedSparsePaths) return;
    if (wt.creationDurationMs < 15_000) return;
    worktreeTipShownRef.current = true;
    const secs = Math.round(wt.creationDurationMs / 1000);
    setMessages(prev => [
      ...prev,
      createSystemMessage(
        `Worktree creation took ${secs}s. For large repos, set \`worktree.sparsePaths\` in .claude/settings.json to check out only the directories you need — e.g. \`{"worktree": {"sparsePaths": ["src", "packages/foo"]}}\`.`,
        'info',
      ),
    ]);
  }, [setMessages]);

  // Hide spinner when the only in-progress tool is Sleep
  const onlySleepToolActive = useMemo(() => {
    const lastAssistant = messages.findLast(m => m.type === 'assistant');
    if (lastAssistant?.type !== 'assistant') return false;
    const content = lastAssistant.message?.content;
    const contentArray = Array.isArray(content) ? content : [];
    const inProgressToolUses = contentArray.filter(
      (b): b is ContentBlock & { type: 'tool_use'; id: string } =>
        b.type === 'tool_use' && inProgressToolUseIDs.has((b as { id: string }).id),
    );
    return (
      inProgressToolUses.length > 0 &&
      inProgressToolUses.every(b => b.type === 'tool_use' && b.name === SLEEP_TOOL_NAME)
    );
  }, [messages, inProgressToolUseIDs]);

  const {
    onBeforeQuery: mrOnBeforeQuery,
    onTurnComplete: mrOnTurnComplete,
    render: mrRender,
  } = useMoreRight({
    enabled: moreRightEnabled,
    setMessages,
    inputValue,
    setInputValue,
    setToolJSX,
  });

  const showSpinner =
    (!toolJSX || toolJSX.showSpinner === true) &&
    toolUseConfirmQueue.length === 0 &&
    promptQueue.length === 0 &&
    // Show spinner during input processing, API call, while teammates are running,
    // or while pending task notifications are queued (prevents spinner bounce between consecutive notifications)
    (isLoading ||
      userInputOnProcessing ||
      hasRunningTeammates ||
      // Keep spinner visible while task notifications are queued for processing.
      // Without this, the spinner briefly disappears between consecutive notifications
      // (e.g., multiple background agents completing in rapid succession) because
      // isLoading goes false momentarily between processing each one.
      getCommandQueueLength() > 0) &&
    // Hide spinner when waiting for leader to approve permission request
    !pendingWorkerRequest &&
    !onlySleepToolActive &&
    // Hide spinner when streaming text is visible (the text IS the feedback),
    // but keep it when isBriefOnly suppresses the streaming text display
    (!visibleStreamingText || isBriefOnly);

  // Check if any permission or ask question prompt is currently visible
  // This is used to prevent the survey from opening while prompts are active
  const hasActivePrompt =
    toolUseConfirmQueue.length > 0 ||
    promptQueue.length > 0 ||
    sandboxPermissionRequestQueue.length > 0 ||
    elicitation.queue.length > 0 ||
    workerSandboxPermissions.queue.length > 0;

  const feedbackSurveyOriginal = useFeedbackSurvey(messages, isLoading, submitCount, 'session', hasActivePrompt);

  const skillImprovementSurvey = useSkillImprovementSurvey(setMessages);

  const showIssueFlagBanner = useIssueFlagBanner(messages, submitCount);

  // Wrap feedback survey handler to trigger auto-run /issue
  const feedbackSurvey = useMemo(
    () => ({
      ...feedbackSurveyOriginal,
      handleSelect: (selected: 'dismissed' | 'bad' | 'fine' | 'good') => {
        // Reset the ref when a new survey response comes in
        didAutoRunIssueRef.current = false;
        const showedTranscriptPrompt = feedbackSurveyOriginal.handleSelect(selected);
        // Auto-run /issue for "bad" if transcript prompt wasn't shown
        if (selected === 'bad' && !showedTranscriptPrompt && shouldAutoRunIssue('feedback_survey_bad')) {
          setAutoRunIssueReason('feedback_survey_bad');
          didAutoRunIssueRef.current = true;
        }
      },
    }),
    [feedbackSurveyOriginal],
  );

  // Post-compact survey: shown after compaction if feature gate is enabled
  const postCompactSurvey = usePostCompactSurvey(messages, isLoading, hasActivePrompt, { enabled: !isRemoteSession });

  // Memory survey: shown when the assistant mentions memory and a memory file
  // was read this conversation
  const memorySurvey = useMemorySurvey(messages, isLoading, hasActivePrompt, {
    enabled: !isRemoteSession,
  });

  // Frustration detection: show transcript sharing prompt after detecting frustrated messages
  const frustrationDetection = useFrustrationDetection(
    messages,
    isLoading,
    hasActivePrompt,
    feedbackSurvey.state !== 'closed' || postCompactSurvey.state !== 'closed' || memorySurvey.state !== 'closed',
  );

  // Initialize IDE integration
  useIDEIntegration({
    autoConnectIdeFlag,
    ideToInstallExtension,
    setDynamicMcpConfig,
    setShowIdeOnboarding,
    setIDEInstallationState: setIDEInstallationStatus,
  });

  useFileHistorySnapshotInit(initialFileHistorySnapshots, fileHistory, fileHistoryState =>
    setAppState(prev => ({
      ...prev,
      fileHistory: fileHistoryState,
    })),
  );

  // Lazy init: useRef(createX()) would call createX on every render and
  // discard the result. LRUCache construction inside FileStateCache is
  // expensive (~170ms), so we use useState's lazy initializer to create
  // it exactly once, then feed that stable reference into useRef.
  const [initialReadFileState] = useState(() => createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE));
  const readFileState = useRef(initialReadFileState);
  const bashTools = useRef(new Set<string>());
  const bashToolsProcessedIdx = useRef(0);
  // Session-scoped skill discovery tracking (feeds was_discovered on
  // tengu_skill_tool_invocation). Must persist across getToolUseContext
  // rebuilds within a session: turn-0 discovery writes via processUserInput
  // before onQuery builds its own context, and discovery on turn N must
  // still attribute a SkillTool call on turn N+k. Cleared in clearConversation.
  const discoveredSkillNamesRef = useRef(new Set<string>());
  // Session-level dedup for nested_memory CLAUDE.md attachments.
  // readFileState is a 100-entry LRU; once it evicts a CLAUDE.md path,
  // the next discovery cycle re-injects it. Cleared in clearConversation.
  const loadedNestedMemoryPathsRef = useRef(new Set<string>());

  // Helper to restore read file state from messages (used for resume flows)
  // This allows Claude to edit files that were read in previous sessions
  const restoreReadFileState = useCallback((messages: MessageType[], cwd: string) => {
    const extracted = extractReadFilesFromMessages(messages, cwd, READ_FILE_STATE_CACHE_SIZE);
    readFileState.current = mergeFileStateCaches(readFileState.current, extracted);
    for (const tool of extractBashToolsFromMessages(messages)) {
      bashTools.current.add(tool);
    }
  }, []);

  const resume = useConversationResume({
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
  });

  // Extract read file state from initialMessages on mount
  // This handles CLI flag resume (--resume-session) and ResumeConversation screen
  // where messages are passed as props rather than through the resume callback
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      restoreReadFileState(initialMessages, getOriginalCwd());
      void restoreRemoteAgentTasks({
        abortController: new AbortController(),
        getAppState: () => store.getState(),
        setAppState,
      });
    }
    // Only run on mount - initialMessages shouldn't change during component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { status: apiKeyStatus, reverify } = useApiKeyVerification();

  // Auto-run /issue state
  const [autoRunIssueReason, setAutoRunIssueReason] = useState<AutoRunIssueReason | null>(null);
  // Ref to track if autoRunIssue was triggered this survey cycle,
  // so we can suppress the [1] follow-up prompt even after
  // autoRunIssueReason is cleared.
  const didAutoRunIssueRef = useRef(false);

  // State for exit feedback flow
  const { exitFlow, isExiting, handleExit } = useExitInteraction();

  // Calculate if cost dialog should be shown
  const showingCostDialog = !isLoading && showCostDialog;

  // Determine which dialog should have focus (if any)
  // Permission and interactive dialogs can show even when toolJSX is set,
  // as long as shouldContinueAnimation is true. This prevents deadlocks when
  // agents set background hints while waiting for user interaction.
  const focusedInputDialog = selectFocusedInputDialog({
    exiting: isExiting || !!exitFlow,
    messageSelector: isMessageSelectorVisible,
    promptInputActive: isPromptInputActive,
    sandboxPermission: !!sandboxPermissionRequestQueue[0],
    toolPermission: !!toolUseConfirmQueue[0],
    prompt: !!promptQueue[0],
    workerSandboxPermission: !!workerSandboxPermissions.queue[0],
    elicitation: !!elicitation.queue[0],
    cost: showingCostDialog,
    idleReturn: !!idleReturnPending,
    allowDialogsWithAnimation: !toolJSX || toolJSX.shouldContinueAnimation === true,
    isLoading,
    ultraplanChoice: !!ultraplanPendingChoice,
    ultraplanLaunch: !!ultraplanLaunchPending,
    ideOnboarding: showIdeOnboarding,
    modelSwitch: showModelSwitchCallout,
    undercoverCallout: showUndercoverCallout,
    effortCallout: showEffortCallout,
    remoteCallout: showRemoteCallout,
    lspRecommendation: !!lspRecommendation,
    pluginHint: !!hintRecommendation,
    searchExtraToolsHint: searchExtraToolsHint.visible,
    desktopUpsell: showDesktopUpsellStartup,
  });

  // True when permission prompts exist but are hidden because the user is typing
  const hasSuppressedDialogs =
    isPromptInputActive &&
    (sandboxPermissionRequestQueue[0] ||
      toolUseConfirmQueue[0] ||
      promptQueue[0] ||
      workerSandboxPermissions.queue[0] ||
      elicitation.queue[0] ||
      showingCostDialog);

  // Keep ref in sync so timer callbacks can read the current value
  focusedInputDialogRef.current = focusedInputDialog;

  // Immediately capture pause/resume when focusedInputDialog changes
  // This ensures accurate timing even under high system load, rather than
  // relying on the 100ms polling interval to detect state changes
  useEffect(() => {
    if (!isLoading) return;

    const isPaused = focusedInputDialog === 'tool-permission';
    const now = Date.now();

    if (isPaused && pauseStartTimeRef.current === null) {
      // Just entered pause state - record the exact moment
      pauseStartTimeRef.current = now;
    } else if (!isPaused && pauseStartTimeRef.current !== null) {
      // Just exited pause state - accumulate paused time immediately
      totalPausedMsRef.current += now - pauseStartTimeRef.current;
      pauseStartTimeRef.current = null;
    }
  }, [focusedInputDialog, isLoading]);

  // Re-pin scroll to bottom whenever the permission overlay appears or
  // dismisses. Overlay now renders below messages inside the same
  // ScrollBox (no remount), so we need an explicit scrollToBottom for:
  //  - appear: user may have been scrolled up (sticky broken) — the
  //    dialog is blocking and must be visible
  //  - dismiss: user may have scrolled up to read context during the
  //    overlay, and onScroll was suppressed so the pill state is stale
  // useLayoutEffect so the re-pin commits before the Ink frame renders —
  // no 1-frame flash of the wrong scroll position.
  const prevDialogRef = useRef(focusedInputDialog);
  useLayoutEffect(() => {
    const was = prevDialogRef.current === 'tool-permission';
    const now = focusedInputDialog === 'tool-permission';
    if (was !== now) repinScroll();
    prevDialogRef.current = focusedInputDialog;
  }, [focusedInputDialog, repinScroll]);

  const { onCancel } = useCancelInteraction({
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
  });
  // Function to handle queued command when canceling a permission request
  const handleQueuedCommandOnCancel = useCallback(() => {
    const result = popAllEditable(inputValue, 0);
    if (!result) return;
    setInputValue(result.text);
    setInputMode('prompt');

    // Restore images from queued commands to pastedContents
    if (result.images.length > 0) {
      setPastedContents(prev => {
        const newContents = { ...prev };
        for (const image of result.images) {
          newContents[image.id] = image;
        }
        return newContents;
      });
    }
  }, [setInputValue, setInputMode, inputValue, setPastedContents]);

  // CancelRequestHandler props - rendered inside KeybindingSetup
  const cancelRequestProps = {
    setToolUseConfirmQueue,
    onCancel,
    onAgentsKilled: () => setMessages(prev => [...prev, createAgentsKilledMessage()]),
    isMessageSelectorVisible: isMessageSelectorVisible || !!showBashesDialog,
    screen,
    abortSignal: abortController?.signal,
    popCommandFromQueue: handleQueuedCommandOnCancel,
    vimMode,
    isLocalJSXCommand: toolJSX?.isLocalJSXCommand,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    inputValue,
    streamMode,
  };

  useEffect(() => {
    const totalCost = getTotalCost();
    if (totalCost >= 5 /* $5 */ && !showCostDialog && !haveShownCostDialog) {
      logEvent('tengu_cost_threshold_reached', {});
      // Mark as shown even if the dialog won't render (no console billing
      // access). Otherwise this effect re-fires on every message change for
      // the rest of the session — 200k+ spurious events observed.
      setHaveShownCostDialog(true);
      if (hasConsoleBillingAccess()) {
        setShowCostDialog(true);
      }
    }
  }, [messages, showCostDialog, haveShownCostDialog]);

  const sandboxAskCallback: SandboxAskCallback = useCallback(
    async (hostPattern: NetworkHostPattern) => {
      // If running as a swarm worker, forward the request to the leader via mailbox
      if (isAgentSwarmsEnabled() && isSwarmWorker()) {
        const requestId = generateSandboxRequestId();

        // Send the request to the leader via mailbox
        const sent = await sendSandboxPermissionRequestViaMailbox(hostPattern.host, requestId);

        return new Promise(resolveShouldAllowHost => {
          if (!sent) {
            // If we couldn't send via mailbox, fall back to local handling
            setSandboxPermissionRequestQueue(prev => [
              ...prev,
              {
                hostPattern,
                resolvePromise: resolveShouldAllowHost,
              },
            ]);
            return;
          }

          // Register the callback for when the leader responds
          registerSandboxPermissionCallback({
            requestId,
            host: hostPattern.host,
            resolve: resolveShouldAllowHost,
          });

          // Update AppState to show pending indicator
          setAppState(prev => ({
            ...prev,
            pendingSandboxRequest: {
              requestId,
              host: hostPattern.host,
            },
          }));
        });
      }

      // Normal flow for non-workers: show local UI and optionally race
      // against the REPL bridge (Remote Control) if connected.
      return new Promise(resolveShouldAllowHost => {
        let resolved = false;
        function resolveOnce(allow: boolean): void {
          if (resolved) return;
          resolved = true;
          resolveShouldAllowHost(allow);
        }

        // Queue the local sandbox permission dialog
        setSandboxPermissionRequestQueue(prev => [
          ...prev,
          {
            hostPattern,
            resolvePromise: resolveOnce,
          },
        ]);

        // When the REPL bridge is connected, also forward the sandbox
        // permission request as a can_use_tool control_request so the
        // remote user (e.g. on claude.ai) can approve it too.
        if (feature('BRIDGE_MODE')) {
          const bridgeCallbacks = store.getState().replBridgePermissionCallbacks;
          if (bridgeCallbacks) {
            const bridgeRequestId = randomUUID();
            bridgeCallbacks.sendRequest(
              bridgeRequestId,
              SANDBOX_NETWORK_ACCESS_TOOL_NAME,
              { host: hostPattern.host },
              randomUUID(),
              `Allow network connection to ${hostPattern.host}?`,
            );

            const unsubscribe = bridgeCallbacks.onResponse(bridgeRequestId, response => {
              unsubscribe();
              const allow = response.behavior === 'allow';
              // Resolve ALL pending requests for the same host, not just
              // this one — mirrors the local dialog handler pattern.
              setSandboxPermissionRequestQueue(queue => {
                queue
                  .filter(item => item.hostPattern.host === hostPattern.host)
                  .forEach(item => item.resolvePromise(allow));
                return queue.filter(item => item.hostPattern.host !== hostPattern.host);
              });
              // Clean up all sibling bridge subscriptions for this host
              // (other concurrent same-host requests) before deleting.
              const siblingCleanups = sandboxBridgeCleanupRef.current.get(hostPattern.host);
              if (siblingCleanups) {
                for (const fn of siblingCleanups) {
                  fn();
                }
                sandboxBridgeCleanupRef.current.delete(hostPattern.host);
              }
            });

            // Register cleanup so the local dialog handler can cancel
            // the remote prompt and unsubscribe when the local user
            // responds first.
            const cleanup = () => {
              unsubscribe();
              bridgeCallbacks.cancelRequest(bridgeRequestId);
            };
            const existing = sandboxBridgeCleanupRef.current.get(hostPattern.host) ?? [];
            existing.push(cleanup);
            sandboxBridgeCleanupRef.current.set(hostPattern.host, existing);
          }
        }
      });
    },
    [setAppState, store],
  );

  // #34044: if user explicitly set sandbox.enabled=true but deps are missing,
  // isSandboxingEnabled() returns false silently. Surface the reason once at
  // mount so users know their security config isn't being enforced. Full
  // reason goes to debug log; notification points to /sandbox for details.
  // addNotification is stable (useCallback) so the effect fires once.
  useEffect(() => {
    const reason = SandboxManager.getSandboxUnavailableReason();
    if (!reason) return;
    if (SandboxManager.isSandboxRequired()) {
      process.stderr.write(
        `\nError: sandbox required but unavailable: ${reason}\n` +
          `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
      );
      gracefulShutdownSync(1, 'other');
      return;
    }
    logForDebugging(`sandbox disabled: ${reason}`, { level: 'warn' });
    addNotification({
      key: 'sandbox-unavailable',
      jsx: (
        <>
          <Text color="warning">sandbox disabled</Text>
          <Text dimColor> · /sandbox</Text>
        </>
      ),
      priority: 'medium',
    });
  }, [addNotification]);

  if (SandboxManager.isSandboxingEnabled()) {
    // If sandboxing is enabled (setting.sandbox is defined, initialise the manager)
    SandboxManager.initialize(sandboxAskCallback).catch(err => {
      // Initialization/validation failed - display error and exit
      process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`);
      gracefulShutdownSync(1, 'other');
    });
  }

  const setToolPermissionContext = useCallback(
    (context: ToolPermissionContext, options?: { preserveMode?: boolean }) => {
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: {
          ...context,
          // Preserve the coordinator's mode only when explicitly requested.
          // Workers' getAppState() returns a transformed context with mode
          // 'acceptEdits' that must not leak into the coordinator's actual
          // state via permission-rule updates — those call sites pass
          // { preserveMode: true }. User-initiated mode changes (e.g.,
          // selecting "allow all edits") must NOT be overridden.
          mode: options?.preserveMode ? prev.toolPermissionContext.mode : context.mode,
        },
      }));

      // When permission context changes, recheck all queued items
      // This handles the case where approving item1 with "don't ask again"
      // should auto-approve other queued items that now match the updated rules
      setImmediate(setToolUseConfirmQueue => {
        // Use setToolUseConfirmQueue callback to get current queue state
        // instead of capturing it in the closure, to avoid stale closure issues
        setToolUseConfirmQueue(currentQueue => {
          currentQueue.forEach(item => {
            void item.recheckPermission();
          });
          return currentQueue;
        });
      }, setToolUseConfirmQueue);
    },
    [setAppState, setToolUseConfirmQueue],
  );

  // Register the leader's setToolPermissionContext for in-process teammates
  useEffect(() => {
    registerLeaderSetToolPermissionContext(setToolPermissionContext);
    return () => unregisterLeaderSetToolPermissionContext();
  }, [setToolPermissionContext]);

  const canUseTool = useCanUseTool(setToolUseConfirmQueue, setToolPermissionContext);

  const requestPrompt = useCallback(
    (title: string, toolInputSummary?: string | null) =>
      (request: PromptRequest): Promise<PromptResponse> =>
        new Promise<PromptResponse>((resolve, reject) => {
          setPromptQueue(prev => [...prev, { request, title, toolInputSummary, resolve, reject }]);
        }),
    [],
  );

  const getToolUseContext = useCallback(
    (
      messages: MessageType[],
      _newMessages: MessageType[],
      abortController: AbortController,
      mainLoopModel: string,
    ): ProcessUserInputContext => {
      // Read mutable values fresh from the store rather than closure-capturing
      // useAppState() snapshots. Same values today (closure is refreshed by the
      // render between turns); decouples freshness from React's render cycle for
      // a future headless conversation loop. Same pattern refreshTools() uses.
      const s = store.getState();

      // Compute tools fresh from store.getState() rather than the closure-
      // captured `tools`. useManageMCPConnections populates appState.mcp
      // async as servers connect — the store may have newer MCP state than
      // the closure captured at render time. Also doubles as refreshTools()
      // for mid-query tool list updates.
      const computeTools = () => {
        const state = store.getState();
        const assembled = assembleToolPool(state.toolPermissionContext, state.mcp.tools);
        const merged = mergeAndFilterTools(combinedInitialTools, assembled, state.toolPermissionContext.mode);
        if (!mainThreadAgentDefinition) return merged;
        return resolveAgentTools(mainThreadAgentDefinition, merged, false, true).resolvedTools;
      };

      return {
        abortController,
        options: {
          commands,
          tools: computeTools(),
          debug,
          verbose: s.verbose,
          mainLoopModel,
          thinkingConfig: s.thinkingEnabled !== false ? thinkingConfig : { type: 'disabled' },
          // Merge fresh from store rather than closing over useMergedClients'
          // memoized output. initialMcpClients is a prop (session-constant).
          mcpClients: mergeClients(initialMcpClients, s.mcp.clients),
          mcpResources: s.mcp.resources,
          ideInstallationStatus: ideInstallationStatus,
          isNonInteractiveSession: false,
          dynamicMcpConfig,
          theme,
          agentDefinitions: allowedAgentTypes ? { ...s.agentDefinitions, allowedAgentTypes } : s.agentDefinitions,
          customSystemPrompt,
          appendSystemPrompt,
          refreshTools: computeTools,
        },
        getAppState: () => store.getState(),
        setAppState,
        messages,
        setMessages,
        updateFileHistoryState(updater: (prev: FileHistoryState) => FileHistoryState) {
          // Perf: skip the setState when the updater returns the same reference
          // (e.g. fileHistoryTrackEdit returns `state` when the file is already
          // tracked). Otherwise every no-op call would notify all store listeners.
          setAppState(prev => {
            const updated = updater(prev.fileHistory);
            if (updated === prev.fileHistory) return prev;
            return { ...prev, fileHistory: updated };
          });
        },
        updateAttributionState(updater: (prev: AttributionState) => AttributionState) {
          setAppState(prev => {
            const updated = updater(prev.attribution);
            if (updated === prev.attribution) return prev;
            return { ...prev, attribution: updated };
          });
        },
        openMessageSelector: () => {
          if (!disabled) {
            setIsMessageSelectorVisible(true);
          }
        },
        onChangeAPIKey: reverify,
        readFileState: readFileState.current,
        setToolJSX,
        addNotification,
        appendSystemMessage: msg => setMessages(prev => [...prev, msg]),
        sendOSNotification: opts => {
          void sendNotification(opts, terminal);
        },
        onChangeDynamicMcpConfig,
        onInstallIDEExtension: setIDEToInstallExtension,
        nestedMemoryAttachmentTriggers: new Set<string>(),
        loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
        dynamicSkillDirTriggers: new Set<string>(),
        discoveredSkillNames: discoveredSkillNamesRef.current,
        setResponseLength,
        pushApiMetricsEntry:
          process.env.USER_TYPE === 'ant'
            ? (ttftMs: number) => {
                const now = Date.now();
                const baseline = responseLengthRef.current;
                apiMetricsRef.current.push({
                  ttftMs,
                  firstTokenTime: now,
                  lastTokenTime: now,
                  responseLengthBaseline: baseline,
                  endResponseLength: baseline,
                });
              }
            : undefined,
        setStreamMode,
        onCompactProgress: event => {
          switch (event.type) {
            case 'hooks_start':
              setSpinnerColor('claudeBlue_FOR_SYSTEM_SPINNER');
              setSpinnerShimmerColor('claudeBlueShimmer_FOR_SYSTEM_SPINNER');
              setSpinnerMessage(
                event.hookType === 'pre_compact'
                  ? 'Running PreCompact hooks\u2026'
                  : event.hookType === 'post_compact'
                    ? 'Running PostCompact hooks\u2026'
                    : 'Running SessionStart hooks\u2026',
              );
              break;
            case 'compact_start':
              setSpinnerMessage('Compacting conversation');
              break;
            case 'compact_end':
              setSpinnerMessage(null);
              setSpinnerColor(null);
              setSpinnerShimmerColor(null);
              break;
          }
        },
        setInProgressToolUseIDs,
        setHasInterruptibleToolInProgress: (v: boolean) => {
          hasInterruptibleToolInProgressRef.current = v;
        },
        resume,
        setConversationId,
        requestPrompt: feature('HOOK_PROMPTS') ? requestPrompt : undefined,
        contentReplacementState: contentReplacementStateRef.current,
      };
    },
    [
      commands,
      combinedInitialTools,
      mainThreadAgentDefinition,
      debug,
      initialMcpClients,
      ideInstallationStatus,
      dynamicMcpConfig,
      theme,
      allowedAgentTypes,
      store,
      setAppState,
      reverify,
      addNotification,
      setMessages,
      onChangeDynamicMcpConfig,
      resume,
      requestPrompt,
      disabled,
      customSystemPrompt,
      appendSystemPrompt,
      setConversationId,
    ],
  );

  // Session backgrounding (Ctrl+B to background/foreground)
  const handleBackgroundQuery = useCallback(() => {
    // Stop the foreground query so the background one takes over
    abortController?.abort('background');
    // Aborting subagents may produce task-completed notifications.
    // Clear task notifications so the queue processor doesn't immediately
    // start a new foreground query; forward them to the background session.
    const removedNotifications = removeByFilter(cmd => cmd.mode === 'task-notification');

    void (async () => {
      const toolUseContext = getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel);

      const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([
        getSystemPrompt(
          toolUseContext.options.tools,
          mainLoopModel,
          Array.from(toolPermissionContext.additionalWorkingDirectories.keys()),
          toolUseContext.options.mcpClients,
        ),
        getUserContext(),
        getSystemContext(),
      ]);

      const systemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt,
      });
      toolUseContext.renderedSystemPrompt = systemPrompt;

      const notificationAttachments = await getQueuedCommandAttachments(removedNotifications).catch(() => []);
      const notificationMessages = notificationAttachments.map(createAttachmentMessage);

      // Deduplicate: if the query loop already yielded a notification into
      // messagesRef before we removed it from the queue, skip duplicates.
      // We use prompt text for dedup because source_uuid is not set on
      // task-notification QueuedCommands (enqueuePendingNotification callers
      // don't pass uuid), so it would always be undefined.
      const existingPrompts = new Set<string>();
      for (const m of messagesRef.current) {
        if (
          m.type === 'attachment' &&
          m.attachment!.type === 'queued_command' &&
          m.attachment!.commandMode === 'task-notification' &&
          typeof m.attachment!.prompt === 'string'
        ) {
          existingPrompts.add(m.attachment!.prompt);
        }
      }
      const uniqueNotifications = notificationMessages.filter(
        m =>
          m.attachment.type === 'queued_command' &&
          (typeof m.attachment.prompt !== 'string' || !existingPrompts.has(m.attachment.prompt)),
      );

      startBackgroundSession({
        messages: [...messagesRef.current, ...uniqueNotifications],
        queryParams: {
          systemPrompt,
          userContext,
          systemContext,
          canUseTool,
          toolUseContext,
          querySource: getQuerySourceForREPL(),
        },
        description: terminalTitle,
        setAppState,
        agentDefinition: mainThreadAgentDefinition,
      });
    })();
  }, [
    abortController,
    mainLoopModel,
    toolPermissionContext,
    mainThreadAgentDefinition,
    getToolUseContext,
    customSystemPrompt,
    appendSystemPrompt,
    canUseTool,
    setAppState,
  ]);

  const { handleBackgroundSession } = useSessionBackgrounding({
    setMessages,
    setIsLoading: setIsExternalLoading,
    resetLoadingState,
    setAbortController,
    onBackgroundQuery: handleBackgroundQuery,
  });

  const onQueryEvent = useQueryEvents({
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
  });
  const onQueryImpl = useQueryExecution({
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
  });
  const onQuery = useQueryRunner({
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
    sendBridgeResultRef,
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
  });
  // Handle initial message (from CLI args or plan mode exit with context clear)
  // This effect runs when isLoading becomes false and there's a pending message
  const initialMessageRef = useRef(false);
  useEffect(() => {
    const pending = initialMessage;
    if (!pending || isLoading || initialMessageRef.current) return;

    // Mark as processing to prevent re-entry
    initialMessageRef.current = true;

    async function processInitialMessage(initialMsg: NonNullable<typeof pending>) {
      // Clear context if requested (plan mode exit)
      if (initialMsg.clearContext) {
        // Preserve the plan slug before clearing context, so the new session
        // can access the same plan file after regenerateSessionId()
        const oldPlanSlug = initialMsg.message.planContent ? getPlanSlug() : undefined;

        const { clearConversation } = await import('../../commands/clear/conversation.js');
        await clearConversation({
          setMessages,
          readFileState: readFileState.current,
          discoveredSkillNames: discoveredSkillNamesRef.current,
          loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
          getAppState: () => store.getState(),
          setAppState,
          setConversationId,
        });
        haikuTitleAttemptedRef.current = false;
        setHaikuTitle(undefined);
        bashTools.current.clear();
        bashToolsProcessedIdx.current = 0;

        // Restore the plan slug for the new session so getPlan() finds the file
        if (oldPlanSlug) {
          setPlanSlug(getSessionId(), oldPlanSlug);
        }
      }

      // Atomically: clear initial message, set permission mode and rules
      setAppState(prev => {
        // Build and apply permission updates (mode + allowedPrompts rules)
        let updatedToolPermissionContext = initialMsg.mode
          ? applyPermissionUpdates(
              prev.toolPermissionContext,
              buildPermissionUpdates(initialMsg.mode, initialMsg.allowedPrompts),
            )
          : prev.toolPermissionContext;
        // For auto, override the mode (buildPermissionUpdates maps
        // it to 'default' via toExternalPermissionMode) and strip dangerous rules
        if (feature('TRANSCRIPT_CLASSIFIER') && initialMsg.mode === 'auto') {
          updatedToolPermissionContext = stripDangerousPermissionsForAutoMode({
            ...updatedToolPermissionContext,
            mode: 'auto',
            prePlanMode: undefined,
          });
        }

        return {
          ...prev,
          initialMessage: null,
          toolPermissionContext: updatedToolPermissionContext,
        };
      });

      // Create file history snapshot for code rewind
      if (fileHistoryEnabled()) {
        void fileHistoryMakeSnapshot((updater: (prev: FileHistoryState) => FileHistoryState) => {
          setAppState(prev => ({
            ...prev,
            fileHistory: updater(prev.fileHistory),
          }));
        }, initialMsg.message.uuid);
      }

      // Ensure SessionStart hook context is available before the first API
      // call. onSubmit calls this internally but the onQuery path below
      // bypasses onSubmit — hoist here so both paths see hook messages.
      await awaitPendingHooks();

      // Route all initial prompts through onSubmit to ensure UserPromptSubmit hooks fire
      // TODO: Simplify by always routing through onSubmit once it supports
      // ContentBlockParam arrays (images) as input
      const content = initialMsg.message.message.content;

      // Route all string content through onSubmit to ensure hooks fire
      // For complex content (images, etc.), fall back to direct onQuery
      // Plan messages bypass onSubmit to preserve planContent metadata for rendering
      if (typeof content === 'string' && !initialMsg.message.planContent) {
        // Route through onSubmit for proper processing including UserPromptSubmit hooks
        void onSubmit(content, {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        });
      } else {
        // Plan messages or complex content (images, etc.) - send directly to model
        // Plan messages use onQuery to preserve planContent metadata for rendering
        // TODO: Once onSubmit supports ContentBlockParam arrays, remove this branch
        const newAbortController = createAbortController();
        setAbortController(newAbortController);

        void onQuery(
          [initialMsg.message],
          newAbortController,
          true, // shouldQuery
          [], // additionalAllowedTools
          mainLoopModel,
        );
      }

      // Reset ref after a delay to allow new initial messages
      setTimeout(
        ref => {
          ref.current = false;
        },
        100,
        initialMessageRef,
      );
    }

    void processInitialMessage(pending);
  }, [initialMessage, isLoading, setMessages, setAppState, onQuery, mainLoopModel, tools]);

  const { onSubmit } = usePromptSubmission({
    repinScroll,
    routeToSelectedPipes,
    setMessages,
    inputMode,
    pastedContents,
    setInputValue,
    setPastedContents,
    setInputMode,
    setIDESelection,
    commands,
    idleHintShownRef,
    lastQueryCompletionTimeRef,
    messagesRef,
    queryGuard,
    inputValueRef,
    setToolJSX,
    addNotification,
    stashedPrompt,
    setStashedPrompt,
    getToolUseContext,
    mainLoopModel,
    activeRemote,
    isLoading,
    skipIdleCheckRef,
    setIdleReturnPending,
    setSubmitCount,
    tipPickedThisTurnRef,
    setUserInputOnProcessing,
    resetTimingRefs,
    setAppState,
    readFileState,
    setAbortController,
    onQuery,
    awaitPendingHooks,
    isExternalLoading,
    ideSelection,
    abortController,
    onBeforeQuery,
    canUseTool,
    streamModeRef,
    hasInterruptibleToolInProgressRef,
  });
  const { onAgentSubmit } = useAgentActions({
    setAppState,
    setInputValue,
    getToolUseContext,
    messagesRef,
    canUseTool,
    mainLoopModel,
    addNotification,
  });

  // Handlers for auto-run /issue or /good-claude (defined after onSubmit)
  const handleAutoRunIssue = useCallback(() => {
    const command = autoRunIssueReason ? getAutoRunCommand(autoRunIssueReason) : '/issue';
    setAutoRunIssueReason(null); // Clear the state
    onSubmit(command, {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {},
    }).catch(err => {
      logForDebugging(`Auto-run ${command} failed: ${errorMessage(err)}`);
    });
  }, [onSubmit, autoRunIssueReason]);

  const handleCancelAutoRunIssue = useCallback(() => {
    setAutoRunIssueReason(null);
  }, []);

  // Handler for when user presses 1 on survey thanks screen to share details
  const handleSurveyRequestFeedback = useCallback(() => {
    const command = process.env.USER_TYPE === 'ant' ? '/issue' : '/feedback';
    onSubmit(command, {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {},
    }).catch(err => {
      logForDebugging(`Survey feedback request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [onSubmit]);

  // onSubmit is unstable (deps include `messages` which changes every turn).
  // `handleOpenRateLimitOptions` is prop-drilled to every MessageRow, and each
  // MessageRow fiber pins the closure (and transitively the entire REPL render
  // scope, ~1.8KB) at mount time. Using a ref keeps this callback stable so
  // old REPL scopes can be GC'd — saves ~35MB over a 1000-turn session.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const handleOpenRateLimitOptions = useCallback(() => {
    void onSubmitRef.current('/rate-limit-options', {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {},
    });
  }, []);

  const handleShowMessageSelector = useCallback(() => {
    setIsMessageSelectorVisible(prev => !prev);
  }, []);

  const { rewindConversationTo, handleRestoreMessage } = useConversationActions({
    messagesRef,
    setMessages,
    setConversationId,
    setAppState,
    setInputValue,
    setInputMode,
    setPastedContents,
    restoreMessageSyncRef,
  });
  // Not memoized — hook stores caps via ref, reads latest closure at dispatch.
  // 24-char prefix: deriveUUID preserves first 24, renderable uuid prefix-matches raw source.
  const findRawIndex = (uuid: string) => {
    const prefix = uuid.slice(0, 24);
    return messages.findIndex(m => m.uuid.slice(0, 24) === prefix);
  };
  const messageActionCaps: MessageActionCaps = {
    copy: text =>
      // setClipboard RETURNS OSC 52 — caller must stdout.write (tmux side-effects load-buffer, but that's tmux-only).
      void setClipboard(text).then(raw => {
        if (raw) process.stdout.write(raw);
        addNotification({
          // Same key as text-selection copy — repeated copies replace toast, don't queue.
          key: 'selection-copied',
          text: 'copied',
          color: 'success',
          priority: 'immediate',
          timeoutMs: 2000,
        });
      }),
    edit: async msg => {
      // Same skip-confirm check as /rewind: lossless → direct, else confirm dialog.
      const rawIdx = findRawIndex(msg.uuid);
      const raw = rawIdx >= 0 ? messages[rawIdx] : undefined;
      if (!raw || !selectableUserMessagesFilter(raw)) return;
      const noFileChanges = !(await fileHistoryHasAnyChanges(fileHistory, raw.uuid));
      const onlySynthetic = messagesAfterAreOnlySynthetic(messages, rawIdx);
      if (noFileChanges && onlySynthetic) {
        // rewindConversationTo's setMessages races stream appends — cancel first (idempotent).
        onCancel();
        // handleRestoreMessage also restores pasted images.
        void handleRestoreMessage(raw);
      } else {
        // Dialog path: onPreRestore (= onCancel) fires when user CONFIRMS, not on nevermind.
        setMessageSelectorPreselect(raw);
        setIsMessageSelectorVisible(true);
      }
    },
  };
  const { enter: enterMessageActions, handlers: messageActionHandlers } = useMessageActions(
    cursor,
    setCursor,
    cursorNavRef,
    messageActionCaps,
  );

  async function onInit() {
    // Always verify API key on startup, so we can show the user an error in the
    // bottom right corner of the screen if the API key is invalid.
    void reverify();

    // Populate readFileState with CLAUDE.md files at startup
    const memoryFiles = await getMemoryFiles();
    if (memoryFiles.length > 0) {
      const fileList = memoryFiles
        .map(f => `  [${f.type}] ${f.path} (${f.content.length} chars)${f.parent ? ` (included by ${f.parent})` : ''}`)
        .join('\n');
      logForDebugging(`Loaded ${memoryFiles.length} CLAUDE.md/rules files:\n${fileList}`);
    } else {
      logForDebugging('No CLAUDE.md/rules files found');
    }
    for (const file of memoryFiles) {
      // When the injected content doesn't match disk (stripped HTML comments,
      // stripped frontmatter, MEMORY.md truncation), cache the RAW disk bytes
      // with isPartialView so Edit/Write require a real Read first while
      // getChangedFiles + nested_memory dedup still work.
      readFileState.current.set(file.path, {
        content: file.contentDiffersFromDisk ? (file.rawContent ?? file.content) : file.content,
        timestamp: Date.now(),
        offset: undefined,
        limit: undefined,
        isPartialView: file.contentDiffersFromDisk,
      });
    }

    // Initial message handling is done via the initialMessage effect
  }

  // Register cost summary tracker
  useCostSummary(useFpsMetrics());

  // Record transcripts locally, for debugging and conversation recovery
  // Don't record conversation if we only have initial messages; optimizes
  // the case where user resumes a conversation then quites before doing
  // anything else
  useLogMessages(messages, messages.length === initialMessages?.length);

  // REPL Bridge: replicate user/assistant messages to the bridge session
  // for remote access via claude.ai. No-op in external builds or when not enabled.
  const { sendBridgeResult } = useReplBridge(messages, setMessages, abortControllerRef, commands, mainLoopModel);
  sendBridgeResultRef.current = sendBridgeResult;

  useAfterFirstRender();

  // Track prompt queue usage for analytics. Fire once per transition from
  // empty to non-empty, not on every length change -- otherwise a render loop
  // (concurrent onQuery thrashing, etc.) spams saveGlobalConfig, which hits
  // ELOCKED under concurrent sessions and falls back to unlocked writes.
  // That write storm is the primary trigger for ~/.claude.json corruption
  // (GH #3117).
  const hasCountedQueueUseRef = useRef(false);
  useEffect(() => {
    if (queuedCommands.length < 1) {
      hasCountedQueueUseRef.current = false;
      return;
    }
    if (hasCountedQueueUseRef.current) return;
    hasCountedQueueUseRef.current = true;
    saveGlobalConfig(current => ({
      ...current,
      promptQueueUseCount: (current.promptQueueUseCount ?? 0) + 1,
    }));
  }, [queuedCommands.length]);

  // Process queued commands when query completes and queue has items

  const executeQueuedInput = useCallback(
    async (queuedCommands: QueuedCommand[]) => {
      await handlePromptSubmit({
        helpers: {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        },
        queryGuard,
        commands,
        onInputChange: () => {},
        setPastedContents: () => {},
        setToolJSX,
        getToolUseContext,
        messages,
        mainLoopModel,
        ideSelection,
        setUserInputOnProcessing,
        setAbortController,
        onQuery,
        setAppState,
        querySource: getQuerySourceForREPL(),
        onBeforeQuery,
        canUseTool,
        addNotification,
        setMessages,
        queuedCommands,
      });
    },
    [
      queryGuard,
      commands,
      setToolJSX,
      getToolUseContext,
      messages,
      mainLoopModel,
      ideSelection,
      setUserInputOnProcessing,
      canUseTool,
      setAbortController,
      onQuery,
      addNotification,
      setAppState,
      onBeforeQuery,
    ],
  );

  useQueueProcessor({
    executeQueuedInput,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    queryGuard,
  });

  // We'll use the global lastInteractionTime from state.ts

  // Update last interaction time when input changes.
  // Must be immediate because useEffect runs after the Ink render cycle flush.
  useEffect(() => {
    activityManager.recordUserActivity();
    updateLastInteractionTime(true);
  }, [inputValue, submitCount]);

  useEffect(() => {
    if (submitCount === 1) {
      startBackgroundHousekeeping();
    }
  }, [submitCount]);

  // Show notification when Claude is done responding and user is idle
  useEffect(() => {
    // Don't set up notification if Claude is busy
    if (isLoading) return;

    // Only enable notifications after the first new interaction in this session
    if (submitCount === 0) return;

    // No query has completed yet
    if (lastQueryCompletionTime === 0) return;

    // Set timeout to check idle state
    const timer = setTimeout(
      (lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal) => {
        // Check if user has interacted since the response ended
        const lastUserInteraction = getLastInteractionTime();

        if (lastUserInteraction > lastQueryCompletionTime) {
          // User has interacted since Claude finished - they're not idle, don't notify
          return;
        }

        // User hasn't interacted since response ended, check other conditions
        const idleTimeSinceResponse = Date.now() - lastQueryCompletionTime;
        if (
          !isLoading &&
          !toolJSX &&
          // Use ref to get current dialog state, avoiding stale closure
          focusedInputDialogRef.current === undefined &&
          idleTimeSinceResponse >= getGlobalConfig().messageIdleNotifThresholdMs
        ) {
          void sendNotification(
            {
              message: 'Claude is waiting for your input',
              notificationType: 'idle_prompt',
            },
            terminal,
          );
        }
      },
      getGlobalConfig().messageIdleNotifThresholdMs,
      lastQueryCompletionTime,
      isLoading,
      toolJSX,
      focusedInputDialogRef,
      terminal,
    );

    return () => clearTimeout(timer);
  }, [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal]);

  // Idle-return hint: show notification when idle threshold is exceeded.
  // Timer fires after the configured idle period; notification persists until
  // dismissed or the user submits.
  useEffect(() => {
    if (lastQueryCompletionTime === 0) return;
    if (isLoading) return;
    const willowMode: string = getFeatureValue_CACHED_MAY_BE_STALE('tengu_willow_mode', 'off');
    if (willowMode !== 'hint' && willowMode !== 'hint_v2') return;
    if (getGlobalConfig().idleReturnDismissed) return;

    const tokenThreshold = Number(process.env.CLAUDE_CODE_IDLE_TOKEN_THRESHOLD ?? 100_000);
    if (getTotalInputTokens() < tokenThreshold) return;

    const idleThresholdMs = Number(process.env.CLAUDE_CODE_IDLE_THRESHOLD_MINUTES ?? 75) * 60_000;
    const elapsed = Date.now() - lastQueryCompletionTime;
    const remaining = idleThresholdMs - elapsed;

    const timer = setTimeout(
      (lqct, addNotif, msgsRef, mode, hintRef) => {
        if (msgsRef.current.length === 0) return;
        const totalTokens = getTotalInputTokens();
        const formattedTokens = formatTokens(totalTokens);
        const idleMinutes = (Date.now() - lqct) / 60_000;
        addNotif({
          key: 'idle-return-hint',
          jsx:
            mode === 'hint_v2' ? (
              <>
                <Text dimColor>new task? </Text>
                <Text color="suggestion">/clear</Text>
                <Text dimColor> to save </Text>
                <Text color="suggestion">{formattedTokens} tokens</Text>
              </>
            ) : (
              <Text color="warning">new task? /clear to save {formattedTokens} tokens</Text>
            ),
          priority: 'medium',
          // Persist until submit — the hint fires at T+75min idle, user may
          // not return for hours. removeNotification in useEffect cleanup
          // handles dismissal. 0x7FFFFFFF = setTimeout max (~24.8 days).
          timeoutMs: 0x7fffffff,
        });
        hintRef.current = mode;
        logEvent('tengu_idle_return_action', {
          action: 'hint_shown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          variant: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          idleMinutes: Math.round(idleMinutes),
          messageCount: msgsRef.current.length,
          totalInputTokens: totalTokens,
        });
      },
      Math.max(0, remaining),
      lastQueryCompletionTime,
      addNotification,
      messagesRef,
      willowMode,
      idleHintShownRef,
    );

    return () => {
      clearTimeout(timer);
      removeNotification('idle-return-hint');
      idleHintShownRef.current = false;
    };
  }, [lastQueryCompletionTime, isLoading, addNotification, removeNotification]);

  // Submits incoming prompts from teammate messages or tasks mode as new turns
  // Returns true if submission succeeded, false if a query is already running
  const handleIncomingPrompt = useCallback(
    (input: string | QueuedCommand, options?: { isMeta?: boolean }): boolean => {
      if (queryGuard.isActive) return false;

      // Defer to user-queued commands — user input always takes priority
      // over system messages (teammate messages, task list items, etc.)
      // Read from the module-level store at call time (not the render-time
      // snapshot) to avoid a stale closure — this callback's deps don't
      // include the queue.
      if (getCommandQueue().some(cmd => cmd.mode === 'prompt' || cmd.mode === 'bash')) {
        return false;
      }

      const queuedCommand =
        typeof input === 'string'
          ? ({
              value: input,
              mode: 'prompt',
              isMeta: options?.isMeta ? true : undefined,
            } satisfies QueuedCommand)
          : input;

      void (async () => {
        const claim = await claimConsumableQueuedAutonomyCommands([queuedCommand]);
        const command = claim.attachmentCommands[0];
        if (!command) return;

        const newAbortController = createAbortController();
        setAbortController(newAbortController);

        // Create a user message with the formatted content (includes XML wrapper)
        const userMessage = createUserMessage({
          content: command.value,
          isMeta: command.isMeta ? true : undefined,
          origin: command.origin,
        });

        let executed = false;
        try {
          executed = (await onQuery([userMessage], newAbortController, true, [], mainLoopModel)) !== false;
        } catch (error: unknown) {
          try {
            await finalizeAutonomyCommandsForTurn({
              commands: claim.claimedCommands,
              outcome: { type: 'failed', error },
              currentDir: getCwd(),
              priority: 'later',
            });
          } catch (finalizeError: unknown) {
            logError(toError(finalizeError));
          }
          logError(toError(error));
          return;
        }

        // Only finalize as completed when onQuery actually executed the turn
        // (it returns false from the concurrent-guard path without running).
        // Keep this finalize in its own try/catch so a failure here does not
        // trigger a second finalize as `failed` for the same commands.
        if (!executed) {
          return;
        }
        try {
          const nextCommands = await finalizeAutonomyCommandsForTurn({
            commands: claim.claimedCommands,
            outcome: { type: 'completed' },
            currentDir: getCwd(),
            priority: 'later',
          });
          for (const nextCommand of nextCommands) {
            enqueue(nextCommand);
          }
        } catch (finalizeError: unknown) {
          logError(toError(finalizeError));
        }
      })().catch((error: unknown) => {
        logError(toError(error));
      });
      return true;
    },
    [onQuery, mainLoopModel, store],
  );

  usePipeLifecycle({
    store,
    tools,
    setMessages,
    setToolUseConfirmQueue,
    getToolUseContext,
    mainLoopModel,
    isLoading,
    focusedInputDialog,
    handleIncomingPrompt,
  });

  // Scheduled tasks from .claude/scheduled_tasks.json (CronCreate/Delete/List)
  if (feature('AGENT_TRIGGERS')) {
    // Assistant mode bypasses the isLoading gate (the proactive tick →
    // Sleep → tick loop would otherwise starve the scheduler).
    // kairosEnabled is set once in initialState (main.tsx) and never mutated — no
    // subscription needed. The tengu_kairos_cron runtime gate is checked inside
    // useScheduledTasks's effect (not here) since wrapping a hook call in a dynamic
    // condition would break rules-of-hooks.
    const assistantMode = store.getState().kairosEnabled;
    useScheduledTasks!({ isLoading, assistantMode, setMessages });
  }

  // Note: Permission polling is now handled by useInboxPoller
  // - Workers receive permission responses via mailbox messages
  // - Leaders receive permission requests via mailbox messages

  if (process.env.USER_TYPE === 'ant') {
    // Tasks mode: watch for tasks and auto-process them
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useTaskListWatcher({
      taskListId,
      isLoading,
      onSubmitTask: handleIncomingPrompt,
    });
  }

  // Proactive mode: auto-tick when enabled (via /proactive command)
  // Moved out of USER_TYPE === 'ant' block so external users can use it.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useProactive?.({
    // Suppress ticks while an initial message is pending — the initial
    // message will be processed asynchronously and a premature tick would
    // race with it, causing concurrent-query enqueue of expanded skill text.
    isLoading: isLoading || initialMessage !== null,
    queuedCommandsLength: queuedCommands.length,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    isInPlanMode: toolPermissionContext.mode === 'plan',
    onQueueTick: (command: QueuedCommand) => enqueue(command),
  });

  // Goal auto-continuation: enqueue a steering prompt when idle + active goal
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useGoalContinuation?.({
    isLoading: isLoading || initialMessage !== null,
    wasAborted,
    queuedCommandsLength: queuedCommands.length,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    isInPlanMode: toolPermissionContext.mode === 'plan',
    isQueryActiveNow: queryGuard.getSnapshot,
    onContinuationEnqueued: ({ turn, objective }) => {
      const visibleGoalTurnInput = `Goal auto-continue (${turn}/1): continue advancing "${objective}".`;
      setMessages(oldMessages => [
        ...oldMessages,
        createUserMessage({
          content: visibleGoalTurnInput,
          isVisibleInTranscriptOnly: true,
        }),
      ]);
    },
    onMaxTurnsReached: () => {
      addNotification({
        key: 'goal-max-turns-reached',
        text: 'Goal reached max continuation turns (1). Run /goal continue to reset turn counter and continue.',
        priority: 'immediate',
      });
    },
  });

  useEffect(() => {
    if (!proactiveActive) {
      notifyAutomationStateChanged(null);
      return;
    }

    if (isLoading) {
      return;
    }

    if (
      proactiveNextTickAt !== null &&
      queuedCommands.length === 0 &&
      !isShowingLocalJSXCommand &&
      toolPermissionContext.mode !== 'plan' &&
      initialMessage === null
    ) {
      notifyAutomationStateChanged({
        enabled: true,
        phase: 'standby',
        next_tick_at: proactiveNextTickAt,
        sleep_until: null,
      });
      return;
    }

    notifyAutomationStateChanged({
      enabled: true,
      phase: null,
      next_tick_at: null,
      sleep_until: null,
    });
  }, [
    initialMessage,
    isLoading,
    isShowingLocalJSXCommand,
    proactiveActive,
    proactiveNextTickAt,
    queuedCommands.length,
    toolPermissionContext.mode,
  ]);

  // Abort the current operation when a 'now' priority message arrives
  // (e.g. from a chat UI client via UDS).
  useEffect(() => {
    if (queuedCommands.some(cmd => cmd.priority === 'now')) {
      abortControllerRef.current?.abort('interrupt');
    }
  }, [queuedCommands]);

  const onInitRef = useRef(onInit);
  onInitRef.current = onInit;
  const diagnosticTrackerRef = useRef(diagnosticTracker);
  diagnosticTrackerRef.current = diagnosticTracker;

  // Initial load
  useEffect(() => {
    void onInitRef.current();

    // Cleanup on unmount
    return () => {
      void diagnosticTrackerRef.current.shutdown();
    };
  }, []);

  // Listen for suspend/resume events
  const { internal_eventEmitter } = useStdin();
  const [remountKey, setRemountKey] = useState(0);
  useEffect(() => {
    const handleSuspend = () => {
      // Print suspension instructions
      process.stdout.write(
        `\nClaude Code has been suspended. Run \`fg\` to bring Claude Code back.\nNote: ctrl + z now suspends Claude Code, ctrl + _ undoes input.\n`,
      );
    };

    const handleResume = () => {
      // Force complete component tree replacement instead of terminal clear
      // Ink now handles line count reset internally on SIGCONT
      setRemountKey(prev => prev + 1);
    };

    internal_eventEmitter?.on('suspend', handleSuspend);
    internal_eventEmitter?.on('resume', handleResume);
    return () => {
      internal_eventEmitter?.off('suspend', handleSuspend);
      internal_eventEmitter?.off('resume', handleResume);
    };
  }, [internal_eventEmitter]);

  // Derive stop hook spinner suffix from messages state
  const stopHookSpinnerSuffix = useMemo(() => {
    if (!isLoading) return null;

    // Find stop hook progress messages
    const progressMsgs = messages.filter((m): m is ProgressMessage<HookProgress> => {
      if (m.type !== 'progress') return false;
      const data = m.data as Record<string, unknown>;
      return data.type === 'hook_progress' && (data.hookEvent === 'Stop' || data.hookEvent === 'SubagentStop');
    });
    if (progressMsgs.length === 0) return null;

    // Get the most recent stop hook execution
    const currentToolUseID = progressMsgs.at(-1)?.toolUseID;
    if (!currentToolUseID) return null;

    // Check if there's already a summary message for this execution (hooks completed)
    const hasSummaryForCurrentExecution = messages.some(
      m => m.type === 'system' && m.subtype === 'stop_hook_summary' && m.toolUseID === currentToolUseID,
    );
    if (hasSummaryForCurrentExecution) return null;

    const currentHooks = progressMsgs.filter(p => p.toolUseID === currentToolUseID);
    const total = currentHooks.length;

    // Count completed hooks
    const completedCount = count(messages, m => {
      if (m.type !== 'attachment') return false;
      const attachment = m.attachment!;
      return (
        'hookEvent' in attachment &&
        (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') &&
        'toolUseID' in attachment &&
        attachment.toolUseID === currentToolUseID
      );
    });

    // Check if any hook has a custom status message
    const customMessage = currentHooks.find(p => p.data.statusMessage)?.data.statusMessage;

    if (customMessage) {
      // Use custom message with progress counter if multiple hooks
      return total === 1 ? `${customMessage}…` : `${customMessage}… ${completedCount}/${total}`;
    }

    // Fall back to default behavior
    const hookType = currentHooks[0]?.data.hookEvent === 'SubagentStop' ? 'subagent stop' : 'stop';

    if (process.env.USER_TYPE === 'ant') {
      const cmd = currentHooks[completedCount]?.data.command;
      const label = cmd ? ` '${truncateToWidth(cmd, 40)}'` : '';
      return total === 1
        ? `running ${hookType} hook${label}`
        : `running ${hookType} hook${label}\u2026 ${completedCount}/${total}`;
    }

    return total === 1 ? `running ${hookType} hook` : `running stop hooks… ${completedCount}/${total}`;
  }, [messages, isLoading]);

  const {
    showAllInTranscript,
    setShowAllInTranscript,
    dumpMode,
    editorStatus,
    handleEnterTranscript,
    handleExitTranscript,
    virtualScrollActive,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchCount,
    setSearchCount,
    searchCurrent,
    setSearchCurrent,
    onSearchMatchesChange,
    jumpRef,
    scanElement,
    setHighlight,
    setPositions,
    transcriptCols,
    globalKeybindingProps,
    transcriptMessages,
    transcriptStreamingToolUses,
  } = useTranscriptControls({
    screen,
    setScreen,
    messages,
    deferredMessages,
    streamingToolUses,
    tools,
    disableVirtualScroll,
  });
  // Handle shift+down for teammate navigation and background task management.
  // Guard onOpenBackgroundTasks when a local-jsx dialog (e.g. /mcp) is open —
  // otherwise Shift+Down stacks BackgroundTasksDialog on top and deadlocks input.
  // Third case: Shift+Down toggles the pipe IPC selector panel when pipes are active.
  useBackgroundTaskNavigation({
    onOpenBackgroundTasks: isShowingLocalJSXCommand ? undefined : () => setShowBashesDialog(true),
    onTogglePipeSelector: () => {
      setAppState((prev: any) => {
        const pIpc = prev.pipeIpc ?? {};
        return { ...prev, pipeIpc: { ...pIpc, selectorOpen: !pIpc.selectorOpen } };
      });
    },
  });
  // Auto-exit viewing mode when teammate completes or errors
  useTeammateViewAutoExit();

  // Get viewed agent task (inlined from selectors for explicit data flow).
  // viewedAgentTask: teammate OR local_agent — drives the boolean checks
  // below. viewedTeammateTask: teammate-only narrowed, for teammate-specific
  // field access (inProgressToolUseIDs).
  // Bypass useDeferredValue when streaming text is showing so Messages renders
  // the final message in the same frame streaming text clears. Also bypass when
  // not loading — deferredMessages only matters during streaming (keeps input
  // responsive); after the turn ends, showing messages immediately prevents a
  // jitter gap where the spinner is gone but the answer hasn't appeared yet.
  // Only reducedMotion users keep the deferred path during loading.
  return (
    <ReplView
      state={{
        abortController,
        addNotification,
        agentDefinitions,
        AntModelSwitchCallout,
        apiKeyStatus,
        apiMetricsRef,
        autoRunIssueReason,
        bashTools,
        bashToolsProcessedIdx,
        cancelRequestProps,
        commands,
        composedOnScroll,
        conversationId,
        cursor,
        cursorNavRef,
        debug,
        deferredMessages,
        didAutoRunIssueRef,
        disabled,
        disableMessageActions,
        disableVirtualScroll,
        discoveredSkillNamesRef,
        dividerYRef,
        dumpMode,
        dynamicMcpConfig,
        editorStatus,
        elicitation,
        enterMessageActions,
        exitFlow,
        feedbackSurvey,
        focusedInputDialog,
        frustrationDetection,
        getToolUseContext,
        globalKeybindingProps,
        haikuTitleAttemptedRef,
        handleAutoRunIssue,
        handleBackgroundSession,
        handleCancelAutoRunIssue,
        handleExit,
        handleHintResponse,
        handleLspResponse,
        handleOpenRateLimitOptions,
        handleQueuedCommandOnCancel,
        handleRestoreMessage,
        handleShowMessageSelector,
        handleSurveyRequestFeedback,
        hasRunningTeammates,
        hasSuppressedDialogs,
        hintRecommendation,
        ideInstallationStatus,
        ideSelection,
        idleReturnPending,
        inProgressToolUseIDs,
        inputMode,
        inputValue,
        isBriefOnly,
        isExiting,
        isHelpOpen,
        isLoading,
        isMessageSelectorVisible,
        isSearchingHistory,
        isShowingLocalJSXCommand,
        jumpRef,
        jumpToNew,
        loadedNestedMemoryPathsRef,
        loadingStartTimeRef,
        lspRecommendation,
        mainLoopModel,
        mcpClients,
        memorySurvey,
        messageActionHandlers,
        messages,
        messageSelectorPreselect,
        messagesRef,
        modalScrollRef,
        mrRender,
        onAgentSubmit,
        onCancel,
        onSearchMatchesChange,
        onSubmit,
        onSubmitRef,
        pastedContents,
        pauseStartTimeRef,
        pendingSandboxRequest,
        pendingWorkerRequest,
        permissionStickyFooter,
        postCompactSurvey,
        proactiveModule,
        promptQueue,
        queryGuard,
        readFileState,
        remountKey,
        responseLengthRef,
        sandboxBridgeCleanupRef,
        sandboxPermissionRequestQueue,
        scanElement,
        scrollRef,
        searchCount,
        searchCurrent,
        searchExtraToolsHint,
        searchOpen,
        searchQuery,
        setAppState,
        setConversationId,
        setCursor,
        setHaikuTitle,
        setHaveShownCostDialog,
        setHighlight,
        setIdleReturnPending,
        setInputMode,
        setInputValue,
        setIsHelpOpen,
        setIsMessageSelectorVisible,
        setIsSearchingHistory,
        setMessages,
        setMessageSelectorPreselect,
        setPastedContents,
        setPermissionStickyFooter,
        setPositions,
        setPromptQueue,
        setSandboxPermissionRequestQueue,
        setSearchCount,
        setSearchCurrent,
        setSearchOpen,
        setSearchQuery,
        setShowBashesDialog,
        setShowCostDialog,
        setShowDesktopUpsellStartup,
        setShowEffortCallout,
        setShowIdeOnboarding,
        setShowModelSwitchCallout,
        setShowUndercoverCallout,
        setStashedPrompt,
        setToolPermissionContext,
        setToolUseConfirmQueue,
        setVimMode,
        showAllInTranscript,
        showBashesDialog,
        showExpandedTodos,
        showIssueFlagBanner,
        showSpinner,
        showStatusInTerminalTab,
        showStreamingText,
        skillImprovementSurvey,
        skipIdleCheckRef,
        spinnerColor,
        spinnerMessage,
        spinnerShimmerColor,
        spinnerTip,
        stashedPrompt,
        stopHookSpinnerSuffix,
        store,
        streamingThinking,
        streamingToolUses,
        streamMode,
        strictMcpConfig,
        submitCount,
        tasksV2,
        teamContext,
        terminalTitle,
        titleDisabled,
        titleIsAnimating,
        toolJSX,
        toolPermissionContext,
        tools,
        toolUseConfirmQueue,
        totalPausedMsRef,
        transcriptCols,
        transcriptMessages,
        transcriptStreamingToolUses,
        ultraplanLaunchPending,
        ultraplanPendingChoice,
        UndercoverAutoCallout,
        unseenDivider,
        userInputBaselineRef,
        userInputOnProcessing,
        verbose,
        viewedAgentTask,
        viewedTeammateTask,
        vimMode,
        visibleStreamingText,
        workerSandboxPermissions,
        screen,
      }}
    />
  );
}
