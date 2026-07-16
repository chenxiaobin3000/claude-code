import { feature } from 'bun:bundle';
import {
  MessageSelector,
  selectableUserMessagesFilter,
  messagesAfterAreOnlySynthetic,
} from '../../../components/MessageSelector.js';
import { getSystemPrompt } from '../../../constants/prompts.js';
import { buildEffectiveSystemPrompt } from '../../../utils/systemPrompt.js';
import { getSystemContext, getUserContext } from '../../../context.js';
import { getShortcutDisplay } from '../../../keybindings/shortcutFormat.js';
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
import type {
  Message as MessageType,
  UserMessage,
  ProgressMessage,
  HookResultMessage,
  PartialCompactDirection,
} from '../../../types/message.js';
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
import { createAbortController } from '../../../utils/abortController.js';
import { isFullscreenEnvEnabled, maybeGetTmuxMouseHint, isMouseTrackingEnabled } from '../../../utils/fullscreen.js';
import type { ReactNode } from 'react';
import type { ReplViewState } from '../view/ReplView.js';

export function ReplMessageSelector({ state }: { state: ReplViewState }): ReactNode {
  const {
    addNotification,
    focusedInputDialog,
    getToolUseContext,
    handleRestoreMessage,
    mainLoopModel,
    messages,
    messageSelectorPreselect,
    onCancel,
    proactiveModule,
    setAppState,
    setConversationId,
    setInputMode,
    setInputValue,
    setIsMessageSelectorVisible,
    setMessages,
    setMessageSelectorPreselect,
  } = state;
  return (
    <>
      {focusedInputDialog === 'message-selector' && (
        <MessageSelector
          messages={messages}
          preselectedMessage={messageSelectorPreselect}
          onPreRestore={onCancel}
          onRestoreCode={async (message: UserMessage) => {
            await fileHistoryRewind((updater: (prev: FileHistoryState) => FileHistoryState) => {
              setAppState((prev: any) => ({
                ...prev,
                fileHistory: updater(prev.fileHistory),
              }));
            }, message.uuid);
          }}
          onSummarize={async (message: UserMessage, feedback?: string, direction: PartialCompactDirection = 'from') => {
            // Project snipped messages so the compact model
            // doesn't summarize content that was intentionally removed.
            const compactMessages = getMessagesAfterCompactBoundary(messages);

            const messageIndex = compactMessages.indexOf(message);
            if (messageIndex === -1) {
              // Selected a snipped or pre-compact message that the
              // selector still shows (REPL keeps full history for
              // scrollback). Surface why nothing happened instead
              // of silently no-oping.
              setMessages((prev: any[]) => [
                ...prev,
                createSystemMessage(
                  'That message is no longer in the active context (snipped or pre-compact). Choose a more recent message.',
                  'warning',
                ),
              ]);
              return;
            }

            const newAbortController = createAbortController();
            const context = getToolUseContext(compactMessages, [], newAbortController, mainLoopModel);

            const appState = context.getAppState();
            const defaultSysPrompt = await getSystemPrompt(
              context.options.tools,
              context.options.mainLoopModel,
              Array.from(appState.toolPermissionContext.additionalWorkingDirectories.keys()),
              context.options.mcpClients,
            );
            const systemPrompt = buildEffectiveSystemPrompt({
              mainThreadAgentDefinition: undefined,
              toolUseContext: context,
              customSystemPrompt: context.options.customSystemPrompt,
              defaultSystemPrompt: defaultSysPrompt,
              appendSystemPrompt: context.options.appendSystemPrompt,
            });
            const [userContext, systemContext] = await Promise.all([getUserContext(), getSystemContext()]);

            const result = await partialCompactConversation(
              compactMessages,
              messageIndex,
              context,
              {
                systemPrompt,
                userContext,
                systemContext,
                toolUseContext: context,
                forkContextMessages: compactMessages,
              },
              feedback,
              direction,
            );

            const kept = result.messagesToKeep ?? [];
            const ordered =
              direction === 'up_to' ? [...result.summaryMessages, ...kept] : [...kept, ...result.summaryMessages];
            const postCompact = [result.boundaryMarker, ...ordered, ...result.attachments, ...result.hookResults];
            // Fullscreen 'from' keeps scrollback; 'up_to' must not
            // (old[0] unchanged + grown array means incremental
            // useLogMessages path, so boundary never persisted).
            // Find by uuid since old is raw REPL history and snipped
            // entries can shift the projected messageIndex.
            if (isFullscreenEnvEnabled() && direction === 'from') {
              setMessages((old: any[]) => {
                const rawIdx = old.findIndex((m: any) => m.uuid === message.uuid);
                return [...old.slice(0, rawIdx === -1 ? 0 : rawIdx), ...postCompact];
              });
            } else {
              setMessages(postCompact);
            }
            // Partial compact bypasses handleMessageFromStream — clear
            // the context-blocked flag so proactive ticks resume.
            if (feature('PROACTIVE') || feature('KAIROS')) {
              proactiveModule?.setContextBlocked(false);
            }
            setConversationId(randomUUID());
            runPostCompactCleanup(context.options.querySource);

            if (direction === 'from') {
              const r = textForResubmit(message);
              if (r) {
                setInputValue(r.text);
                setInputMode(r.mode);
              }
            }

            // Show notification with ctrl+o hint
            const historyShortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
            addNotification({
              key: 'summarize-ctrl-o-hint',
              text: `Conversation summarized (${historyShortcut} for history)`,
              priority: 'medium',
              timeoutMs: 8000,
            });
          }}
          onRestoreMessage={handleRestoreMessage}
          onClose={() => {
            setIsMessageSelectorVisible(false);
            setMessageSelectorPreselect(undefined);
          }}
        />
      )}
    </>
  );
}
