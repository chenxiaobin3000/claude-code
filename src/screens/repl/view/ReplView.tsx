import { feature } from 'bun:bundle';
import { buildDisplayedAgentMessages } from '../agents/agentMessages.js';
import { ReplDialogLayer } from '../interaction/ReplDialogLayer.js';
import { ReplMessageSelector } from '../interaction/ReplMessageSelector.js';
import { AnimatedTerminalTitle, median, TranscriptModeFooter, TranscriptSearchBar } from './TranscriptChrome.js';
import { TranscriptScreen } from './TranscriptScreen.js';
import {
  snapshotOutputTokensForTurn,
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  getBudgetContinuationCount,
  getTotalInputTokens,
} from '../../../bootstrap/state.js';
import { count } from '../../../utils/array.js';
import { type TabStatusKind, Box, Text, useStdin, useTheme, useTerminalFocus, useTabStatus } from '@anthropic/ink';
import { CostThresholdDialog } from '../../../components/CostThresholdDialog.js';
import { IdleReturnDialog } from '../../../components/IdleReturnDialog.js';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import {
  isSwarmWorker,
  generateSandboxRequestId,
  sendSandboxPermissionRequestViaMailbox,
  sendSandboxPermissionResponseViaMailbox,
} from '../../../utils/swarm/permissionSync.js';
import { WorkerPendingPermission } from '../../../components/permissions/WorkerPendingPermission.js';
import {
  MessageSelector,
  selectableUserMessagesFilter,
  messagesAfterAreOnlySynthetic,
} from '../../../components/MessageSelector.js';
import { PermissionRequest, type ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js';
import { ElicitationDialog } from '../../../components/mcp/ElicitationDialog.js';
import { PromptDialog } from '../../../components/hooks/PromptDialog.js';
import PromptInput from '../../../components/PromptInput/PromptInput.js';
import { PromptInputQueuedCommands } from '../../../components/PromptInput/PromptInputQueuedCommands.js';
import { SkillImprovementSurvey } from '../../../components/SkillImprovementSurvey.js';
import { SpinnerWithVerb, BriefIdleStatus, type SpinnerMode } from '../../../components/Spinner.js';
import { getSystemPrompt } from '../../../constants/prompts.js';
import { buildEffectiveSystemPrompt } from '../../../utils/systemPrompt.js';
import { getSystemContext, getUserContext } from '../../../context.js';
import { GlobalKeybindingHandlers } from '../../../hooks/useGlobalKeybindings.js';
import { CommandKeybindingHandlers } from '../../../hooks/useCommandKeybindings.js';
import { KeybindingSetup } from '../../../keybindings/KeybindingProviderSetup.js';
import { getShortcutDisplay } from '../../../keybindings/shortcutFormat.js';
import { CancelRequestHandler } from '../../../hooks/useCancelRequest.js';
import { logError } from '../../../utils/log.js';
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  persistPermissionUpdate,
} from '../../../utils/permissions/PermissionUpdate.js';
import { WEB_FETCH_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/WebFetchTool/prompt.js';
import { getGlobalConfig, saveGlobalConfig, getGlobalConfigWriteCount } from '../../../utils/config.js';
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
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
} from '../../../utils/messages.js';
import {
  BASH_INPUT_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../../../constants/xml.js';
import { escapeXml } from '../../../utils/xml.js';
import type {
  Message as MessageType,
  UserMessage,
  ProgressMessage,
  HookResultMessage,
  PartialCompactDirection,
} from '../../../types/message.js';
import { Messages } from '../../../components/Messages.js';
import { TaskListV2 } from '../../../components/TaskListV2.js';
import { TeammateViewHeader } from '../../../components/TeammateViewHeader.js';
import { randomUUID, type UUID } from 'crypto';
import { runPostCompactCleanup, registerCompactCleanup } from '../../../services/compact/postCompactCleanup.js';
import { partialCompactConversation } from '../../../services/compact/compact.js';
import {
  fileHistoryMakeSnapshot,
  type FileHistoryState,
  fileHistoryRewind,
  type FileHistorySnapshot,
  copyFileHistoryForResume,
  fileHistoryEnabled,
  fileHistoryHasAnyChanges,
} from '../../../utils/fileHistory.js';
import { BackgroundAgentSelector } from '../../../components/tasks/BackgroundAgentSelector.js';
import type { SandboxAskCallback, NetworkHostPattern } from '../../../utils/sandbox/sandbox-adapter.js';
import { SessionBackgroundHint } from '../../../components/SessionBackgroundHint.js';
import { IdeOnboardingDialog } from '../../../components/IdeOnboardingDialog.js';
import { EffortCallout, shouldShowEffortCallout } from '../../../components/EffortCallout.js';
import { RemoteCallout } from '../../../components/RemoteCallout.js';
import { createAbortController } from '../../../utils/abortController.js';
import { MCPConnectionManager } from 'src/services/mcp/MCPConnectionManager.js';
import { FeedbackSurvey } from 'src/components/FeedbackSurvey/FeedbackSurvey.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { SearchExtraToolsHint } from 'src/components/SearchExtraToolsHint.js';
import {
  DesktopUpsellStartup,
  shouldShowDesktopUpsellStartup,
} from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import { UserTextMessage } from 'src/components/messages/UserTextMessage.js';
import { AwsAuthStatusBox } from '../../../components/AwsAuthStatusBox.js';
import {
  AutoRunIssueNotification,
  shouldAutoRunIssue,
  getAutoRunIssueReasonText,
  getAutoRunCommand,
  type AutoRunIssueReason,
} from '../../../utils/autoRunIssue.js';
import { TungstenLiveMonitor } from '@claude-code-best/builtin-tools/tools/TungstenTool/TungstenLiveMonitor.js';
import { IssueFlagBanner } from '../../../components/PromptInput/IssueFlagBanner.js';
import { CompanionSprite, CompanionFloatingBubble, MIN_COLS_FOR_FULL_SPRITE } from '../../../buddy/CompanionSprite.js';
import { DevBar } from '../../../components/DevBar.js';
import { UltraplanChoiceDialog } from '../../../components/ultraplan/UltraplanChoiceDialog.js';
import { UltraplanLaunchDialog } from '../../../components/ultraplan/UltraplanLaunchDialog.js';
import { launchUltraplan } from '../../../commands/ultraplan.js';
import { FullscreenLayout } from '../../../components/FullscreenLayout.js';
import { isFullscreenEnvEnabled, maybeGetTmuxMouseHint, isMouseTrackingEnabled } from '../../../utils/fullscreen.js';
import { AlternateScreen } from '@anthropic/ink';
import { ScrollKeybindingHandler } from '../../../components/ScrollKeybindingHandler.js';
import {
  useMessageActions,
  MessageActionsKeybindings,
  MessageActionsBar,
  type MessageActionCaps,
} from '../../../components/messageActions.js';

export interface ReplViewState {
  [key: string]: any;
}

export function ReplView({ state }: { state: ReplViewState }): React.ReactNode {
  const {
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
    handleOpenRateLimitOptions,
    handleQueuedCommandOnCancel,
    handleRestoreMessage,
    handleShowMessageSelector,
    handleSurveyRequestFeedback,
    hasRunningTeammates,
    hasSuppressedDialogs,
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
  } = state;
  const usesSyncMessages = showStreamingText || !isLoading;
  // When viewing an agent, never fall through to leader — empty until
  // bootstrap/stream fills. Closes the see-leader-type-agent footgun.
  const rawAgentMessages = viewedAgentTask?.messages;
  // Fork sidechain encodes the user prompt inside a mixed user message alongside
  // tool_result blocks; surface the prompt as a standalone bubble and strip the
  // boilerplate text from its original carrier while preserving tool_results.
  const displayedAgentMessages = useMemo(
    () => buildDisplayedAgentMessages(viewedAgentTask, rawAgentMessages),
    [viewedAgentTask, rawAgentMessages],
  );
  const displayedMessages = viewedAgentTask
    ? (displayedAgentMessages ?? [])
    : usesSyncMessages
      ? messages
      : deferredMessages;

  if (screen === 'transcript') {
    // Virtual scroll replaces the 30-message cap: everything is scrollable
    // and memory is bounded by the viewport. Without it, wrapping transcript
    // in a ScrollBox would mount all messages (~250 MB on long sessions —
    // the exact problem), so the kill switch and non-fullscreen paths must
    // fall through to the legacy render: no alt screen, dump to terminal
    // scrollback, 30-cap + Ctrl+E. Reusing scrollRef is safe — normal-mode
    // and transcript-mode are mutually exclusive (this early return), so
    // only one ScrollBox is ever mounted at a time.
    const transcriptScrollRef = isFullscreenEnvEnabled() && !disableVirtualScroll && !dumpMode ? scrollRef : undefined;
    const transcriptMessagesElement = (
      <Messages
        messages={transcriptMessages}
        tools={tools}
        commands={commands}
        verbose={true}
        toolJSX={null}
        toolUseConfirmQueue={[]}
        inProgressToolUseIDs={inProgressToolUseIDs}
        isMessageSelectorVisible={false}
        conversationId={conversationId}
        screen={screen}
        agentDefinitions={agentDefinitions}
        streamingToolUses={transcriptStreamingToolUses}
        showAllInTranscript={showAllInTranscript}
        onOpenRateLimitOptions={handleOpenRateLimitOptions}
        isLoading={isLoading}
        hidePastThinking={true}
        streamingThinking={streamingThinking}
        scrollRef={transcriptScrollRef}
        jumpRef={jumpRef}
        onSearchMatchesChange={onSearchMatchesChange}
        scanElement={scanElement}
        setPositions={setPositions}
        disableRenderCap={dumpMode}
      />
    );
    const transcriptToolJSX = toolJSX && (
      <Box flexDirection="column" width="100%">
        {toolJSX.jsx}
      </Box>
    );
    return (
      <TranscriptScreen
        titleIsAnimating={titleIsAnimating}
        terminalTitle={terminalTitle}
        titleDisabled={titleDisabled}
        showStatusInTerminalTab={showStatusInTerminalTab}
        globalKeybindingProps={globalKeybindingProps}
        onSubmit={onSubmit}
        localJsxCommandActive={toolJSX?.isLocalJSXCommand === true}
        transcriptScrollRef={transcriptScrollRef}
        scrollRef={scrollRef}
        focusedInputDialog={focusedInputDialog}
        searchOpen={searchOpen}
        jumpRef={jumpRef}
        cancelRequestProps={cancelRequestProps}
        transcriptMessagesElement={transcriptMessagesElement}
        transcriptToolJSX={transcriptToolJSX}
        searchCount={searchCount}
        searchCurrent={searchCurrent}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setSearchOpen={setSearchOpen}
        setSearchCount={setSearchCount}
        setSearchCurrent={setSearchCurrent}
        setHighlight={setHighlight}
        showAllInTranscript={showAllInTranscript}
        editorStatus={editorStatus}
        dumpMode={dumpMode}
      />
    );
  }

  // Show the placeholder until the real user message appears in
  // displayedMessages. userInputOnProcessing stays set for the whole turn
  // (cleared in resetLoadingState); this length check hides it once
  // displayedMessages grows past the baseline captured at submit time.
  // Covers both gaps: before setMessages is called (processUserInput), and
  // while deferredMessages lags behind messages. Suppressed when viewing an
  // agent — displayedMessages is a different array there, and onAgentSubmit
  // doesn't use the placeholder anyway.
  const placeholderText =
    userInputOnProcessing && !viewedAgentTask && displayedMessages.length <= userInputBaselineRef.current
      ? userInputOnProcessing
      : undefined;

  const toolPermissionOverlay =
    focusedInputDialog === 'tool-permission' ? (
      <PermissionRequest
        key={toolUseConfirmQueue[0]?.toolUseID}
        onDone={() => setToolUseConfirmQueue(([_, ...tail]: any[]) => tail)}
        onReject={handleQueuedCommandOnCancel}
        toolUseConfirm={toolUseConfirmQueue[0]!}
        toolUseContext={getToolUseContext(
          messages,
          messages,
          abortController ?? createAbortController(),
          mainLoopModel,
        )}
        verbose={verbose}
        workerBadge={toolUseConfirmQueue[0]?.workerBadge}
        setStickyFooter={isFullscreenEnvEnabled() ? setPermissionStickyFooter : undefined}
      />
    ) : null;

  // Narrow terminals: companion collapses to a one-liner that REPL stacks
  // on its own row (above input in fullscreen, below in scrollback) instead
  // of row-beside. Wide terminals keep the row layout with sprite on the right.
  const companionNarrow = transcriptCols < MIN_COLS_FOR_FULL_SPRITE;
  // Hide the sprite when PromptInput early-returns BackgroundTasksDialog.
  // The sprite sits as a row sibling of PromptInput, so the dialog's Pane
  // divider draws at useTerminalSize() width but only gets terminalWidth -
  // spriteWidth — divider stops short and dialog text wraps early. Don't
  // check footerSelection: pill FOCUS (arrow-down to tasks pill) must keep
  // the sprite visible so arrow-right can navigate to it.
  const companionVisible = !toolJSX?.shouldHidePromptInput && !focusedInputDialog && !showBashesDialog;

  // In fullscreen, ALL local-jsx slash commands float in the modal slot —
  // FullscreenLayout wraps them in an absolute-positioned bottom-anchored
  // pane (▔ divider, ModalContext). Pane/Dialog inside detect the context
  // and skip their own top-level frame. Non-fullscreen keeps the inline
  // render paths below. Commands that used to route through bottom
  // (immediate: /model, /mcp, /btw, ...) and scrollable (non-immediate:
  // /config, /theme, /diff, ...) both go here now.
  const toolJsxCentered = isFullscreenEnvEnabled() && toolJSX?.isLocalJSXCommand === true;
  const centeredModal: React.ReactNode = toolJsxCentered ? toolJSX!.jsx : null;
  // <AlternateScreen> at the root: everything below is inside its
  // <Box height={rows}>. Handlers/contexts are zero-height so ScrollBox's
  // flexGrow in FullscreenLayout resolves against this Box. The transcript
  // early return above wraps its virtual-scroll branch the same way; only
  // the 30-cap dump branch stays unwrapped for native terminal scrollback.

  const mainReturn = (
    <KeybindingSetup>
      <AnimatedTerminalTitle
        isAnimating={titleIsAnimating}
        title={terminalTitle}
        disabled={titleDisabled}
        noPrefix={showStatusInTerminalTab}
      />
      <GlobalKeybindingHandlers {...globalKeybindingProps} />
      <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
      {/* ScrollKeybindingHandler must mount before CancelRequestHandler so
          ctrl+c-with-selection copies instead of cancelling the active task.
          Its raw useInput handler only stops propagation when a selection
          exists — without one, ctrl+c falls through to CancelRequestHandler.
          PgUp/PgDn/wheel always scroll the transcript behind the modal —
          the modal's inner ScrollBox is not keyboard-driven. onScroll
          stays suppressed while a modal is showing so scroll doesn't
          stamp divider/pill state. */}
      <ScrollKeybindingHandler
        scrollRef={scrollRef}
        isActive={
          isFullscreenEnvEnabled() &&
          (centeredModal != null || !focusedInputDialog || focusedInputDialog === 'tool-permission')
        }
        onScroll={composedOnScroll}
      />
      {feature('MESSAGE_ACTIONS') && isFullscreenEnvEnabled() && !disableMessageActions ? (
        <MessageActionsKeybindings handlers={messageActionHandlers} isActive={cursor !== null} />
      ) : null}
      <CancelRequestHandler {...cancelRequestProps} />
      <MCPConnectionManager key={remountKey} dynamicMcpConfig={dynamicMcpConfig} isStrictMcpConfig={strictMcpConfig}>
        <FullscreenLayout
          scrollRef={scrollRef}
          overlay={toolPermissionOverlay}
          bottomFloat={
            feature('BUDDY') && companionVisible && !companionNarrow ? <CompanionFloatingBubble /> : undefined
          }
          modal={centeredModal}
          modalScrollRef={modalScrollRef}
          dividerYRef={dividerYRef}
          hidePill={!!viewedAgentTask}
          hideSticky={!!viewedTeammateTask}
          newMessageCount={unseenDivider?.count ?? 0}
          onPillClick={() => {
            setCursor(null);
            jumpToNew(scrollRef.current);
          }}
          scrollable={
            <>
              <TeammateViewHeader />
              <Messages
                messages={displayedMessages}
                tools={tools}
                commands={commands}
                verbose={verbose}
                toolJSX={toolJSX}
                toolUseConfirmQueue={toolUseConfirmQueue}
                inProgressToolUseIDs={
                  viewedTeammateTask ? (viewedTeammateTask.inProgressToolUseIDs ?? new Set()) : inProgressToolUseIDs
                }
                isMessageSelectorVisible={isMessageSelectorVisible}
                conversationId={conversationId}
                screen={screen}
                streamingToolUses={streamingToolUses}
                showAllInTranscript={showAllInTranscript}
                agentDefinitions={agentDefinitions}
                onOpenRateLimitOptions={handleOpenRateLimitOptions}
                isLoading={isLoading}
                streamingText={isLoading && !viewedAgentTask ? visibleStreamingText : null}
                isBriefOnly={viewedAgentTask ? false : isBriefOnly}
                unseenDivider={viewedAgentTask ? undefined : unseenDivider}
                scrollRef={isFullscreenEnvEnabled() ? scrollRef : undefined}
                trackStickyPrompt={isFullscreenEnvEnabled() ? true : undefined}
                cursor={cursor}
                setCursor={setCursor}
                cursorNavRef={cursorNavRef}
              />
              <AwsAuthStatusBox />
              {/* Hide the processing placeholder while a modal is showing —
                  it would sit at the last visible transcript row right above
                  the ▔ divider, showing "❯ /config" as redundant clutter
                  (the modal IS the /config UI). Outside modals it stays so
                  the user sees their input echoed while Claude processes. */}
              {!disabled && placeholderText && !centeredModal && (
                <UserTextMessage param={{ text: placeholderText, type: 'text' }} addMargin={true} verbose={verbose} />
              )}
              {toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) && !toolJsxCentered && (
                <Box flexDirection="column" width="100%">
                  {toolJSX.jsx}
                </Box>
              )}
              {process.env.USER_TYPE === 'ant' && <TungstenLiveMonitor />}
              {/* WebBrowserPanel removed — browser-lite, no panel */}
              <Box flexGrow={1} />
              {showSpinner && (
                <SpinnerWithVerb
                  mode={streamMode}
                  spinnerTip={spinnerTip}
                  responseLengthRef={responseLengthRef}
                  apiMetricsRef={apiMetricsRef}
                  overrideMessage={spinnerMessage}
                  spinnerSuffix={stopHookSpinnerSuffix}
                  verbose={verbose}
                  loadingStartTimeRef={loadingStartTimeRef}
                  totalPausedMsRef={totalPausedMsRef}
                  pauseStartTimeRef={pauseStartTimeRef}
                  overrideColor={spinnerColor}
                  overrideShimmerColor={spinnerShimmerColor}
                  hasActiveTools={inProgressToolUseIDs.size > 0}
                  leaderIsIdle={!isLoading}
                />
              )}
              {!showSpinner &&
                !isLoading &&
                !userInputOnProcessing &&
                !hasRunningTeammates &&
                isBriefOnly &&
                !viewedAgentTask && <BriefIdleStatus />}
            </>
          }
          bottom={
            <Box
              flexDirection={feature('BUDDY') && companionNarrow ? 'column' : 'row'}
              width="100%"
              alignItems={feature('BUDDY') && companionNarrow ? undefined : 'flex-end'}
            >
              {feature('BUDDY') && companionNarrow && isFullscreenEnvEnabled() && companionVisible ? (
                <CompanionSprite />
              ) : null}
              <Box flexDirection="column" flexGrow={1}>
                {isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}
                {permissionStickyFooter}
                {/* Immediate local-jsx commands (/btw, /sandbox, /assistant,
                  /issue) render here, NOT inside scrollable. They stay mounted
                  while the main conversation streams behind them, so ScrollBox
                  relayouts on each new message would drag them around. bottom
                  is flexShrink={0} outside the ScrollBox — it never moves.
                  Non-immediate local-jsx (/diff, /status, /theme, ~40 others)
                  stays in scrollable: the main loop is paused so no jiggle,
                  and their tall content (DiffDetailView renders up to 400
                  lines with no internal scroll) needs the outer ScrollBox. */}
                {toolJSX?.isLocalJSXCommand && toolJSX.isImmediate && !toolJsxCentered && (
                  <Box flexDirection="column" width="100%">
                    {toolJSX.jsx}
                  </Box>
                )}
                {!showSpinner && !toolJSX?.isLocalJSXCommand && showExpandedTodos && tasksV2 && tasksV2.length > 0 && (
                  <Box width="100%" flexDirection="column">
                    <TaskListV2 tasks={tasksV2} isStandalone={true} />
                  </Box>
                )}

                <ReplDialogLayer state={state} />
                {mrRender()}

                {!toolJSX?.shouldHidePromptInput && !focusedInputDialog && !isExiting && !disabled && !cursor && (
                  <>
                    {autoRunIssueReason && (
                      <AutoRunIssueNotification
                        onRun={handleAutoRunIssue}
                        onCancel={handleCancelAutoRunIssue}
                        reason={getAutoRunIssueReasonText(autoRunIssueReason)}
                      />
                    )}
                    {postCompactSurvey.state !== 'closed' ? (
                      <FeedbackSurvey
                        state={postCompactSurvey.state}
                        lastResponse={postCompactSurvey.lastResponse}
                        handleSelect={postCompactSurvey.handleSelect}
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                        onRequestFeedback={handleSurveyRequestFeedback}
                      />
                    ) : memorySurvey.state !== 'closed' ? (
                      <FeedbackSurvey
                        state={memorySurvey.state}
                        lastResponse={memorySurvey.lastResponse}
                        handleSelect={memorySurvey.handleSelect}
                        handleTranscriptSelect={memorySurvey.handleTranscriptSelect}
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                        onRequestFeedback={handleSurveyRequestFeedback}
                        message="How well did Claude use its memory? (optional)"
                      />
                    ) : (
                      <FeedbackSurvey
                        state={feedbackSurvey.state}
                        lastResponse={feedbackSurvey.lastResponse}
                        handleSelect={feedbackSurvey.handleSelect}
                        handleTranscriptSelect={feedbackSurvey.handleTranscriptSelect}
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                        onRequestFeedback={didAutoRunIssueRef.current ? undefined : handleSurveyRequestFeedback}
                      />
                    )}
                    {/* Frustration-triggered transcript sharing prompt */}
                    {frustrationDetection.state !== 'closed' && (
                      <FeedbackSurvey
                        state={frustrationDetection.state}
                        lastResponse={null}
                        handleSelect={() => {}}
                        handleTranscriptSelect={frustrationDetection.handleTranscriptSelect}
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                      />
                    )}
                    {/* Skill improvement survey - appears when improvements detected */}
                    {skillImprovementSurvey.suggestion && (
                      <SkillImprovementSurvey
                        isOpen={skillImprovementSurvey.isOpen}
                        skillName={skillImprovementSurvey.suggestion.skillName}
                        updates={skillImprovementSurvey.suggestion.updates}
                        handleSelect={skillImprovementSurvey.handleSelect}
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                      />
                    )}
                    {showIssueFlagBanner && <IssueFlagBanner />}
                    {}
                    <PromptInput
                      debug={debug}
                      ideSelection={ideSelection}
                      hasSuppressedDialogs={!!hasSuppressedDialogs}
                      isLocalJSXCommandActive={isShowingLocalJSXCommand}
                      getToolUseContext={getToolUseContext}
                      toolPermissionContext={toolPermissionContext}
                      setToolPermissionContext={setToolPermissionContext}
                      apiKeyStatus={apiKeyStatus}
                      commands={commands}
                      agents={agentDefinitions.activeAgents}
                      isLoading={isLoading}
                      onExit={handleExit}
                      verbose={verbose}
                      messages={messages}
                      input={inputValue}
                      onInputChange={setInputValue}
                      mode={inputMode}
                      onModeChange={setInputMode}
                      stashedPrompt={stashedPrompt}
                      setStashedPrompt={setStashedPrompt}
                      submitCount={submitCount}
                      onShowMessageSelector={handleShowMessageSelector}
                      onMessageActionsEnter={
                        // Works during isLoading — edit cancels first; uuid selection survives appends.
                        feature('MESSAGE_ACTIONS') && isFullscreenEnvEnabled() && !disableMessageActions
                          ? enterMessageActions
                          : undefined
                      }
                      mcpClients={mcpClients}
                      pastedContents={pastedContents}
                      setPastedContents={setPastedContents}
                      vimMode={vimMode}
                      setVimMode={setVimMode}
                      showBashesDialog={showBashesDialog}
                      setShowBashesDialog={setShowBashesDialog}
                      onSubmit={onSubmit}
                      onAgentSubmit={onAgentSubmit}
                      isSearchingHistory={isSearchingHistory}
                      setIsSearchingHistory={setIsSearchingHistory}
                      helpOpen={isHelpOpen}
                      setHelpOpen={setIsHelpOpen}
                    />
                    <SessionBackgroundHint onBackgroundSession={handleBackgroundSession} isLoading={isLoading} />
                    <BackgroundAgentSelector />
                  </>
                )}
                {cursor && (
                  // inputValue is REPL state; typed text survives the round-trip.
                  <MessageActionsBar cursor={cursor} />
                )}
                <ReplMessageSelector state={state} />
                {process.env.USER_TYPE === 'ant' && <DevBar />}
              </Box>
              {feature('BUDDY') && !(companionNarrow && isFullscreenEnvEnabled()) && companionVisible ? (
                <CompanionSprite />
              ) : null}
            </Box>
          }
        />
      </MCPConnectionManager>
    </KeybindingSetup>
  );
  if (isFullscreenEnvEnabled()) {
    return <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>{mainReturn}</AlternateScreen>;
  }
  return mainReturn;
}
