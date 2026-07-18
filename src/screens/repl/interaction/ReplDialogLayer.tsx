import { feature } from 'bun:bundle';
import {
  snapshotOutputTokensForTurn,
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  getBudgetContinuationCount,
  getTotalInputTokens,
} from '../../../bootstrap/state.js';
import { CostThresholdDialog } from '../../../components/CostThresholdDialog.js';
import { IdleReturnDialog } from '../../../components/IdleReturnDialog.js';
import {
  isSwarmWorker,
  generateSandboxRequestId,
  sendSandboxPermissionRequestViaMailbox,
  sendSandboxPermissionResponseViaMailbox,
} from '../../../utils/swarm/permissionSync.js';
import { WorkerPendingPermission } from '../../../components/permissions/WorkerPendingPermission.js';
import { ElicitationDialog } from '../../../components/mcp/ElicitationDialog.js';
import { PromptDialog } from '../../../components/hooks/PromptDialog.js';
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
import type { SandboxAskCallback, NetworkHostPattern } from '../../../utils/sandbox/sandbox-adapter.js';
import { IdeOnboardingDialog } from '../../../components/IdeOnboardingDialog.js';
import { EffortCallout, shouldShowEffortCallout } from '../../../components/EffortCallout.js';
import { createAbortController } from '../../../utils/abortController.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { SearchExtraToolsHint } from 'src/components/SearchExtraToolsHint.js';
import {
  DesktopUpsellStartup,
  shouldShowDesktopUpsellStartup,
} from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import type { ReactNode } from 'react';
import type { ReplViewState } from '../view/ReplView.js';

export function ReplDialogLayer({ state }: { state: ReplViewState }): ReactNode {
  const {
    AntModelSwitchCallout,
    bashTools,
    bashToolsProcessedIdx,
    discoveredSkillNamesRef,
    elicitation,
    exitFlow,
    focusedInputDialog,
    haikuTitleAttemptedRef,
    ideInstallationStatus,
    idleReturnPending,
    loadedNestedMemoryPathsRef,
    mainLoopModel,
    messagesRef,
    onSubmitRef,
    pendingSandboxRequest,
    pendingWorkerRequest,
    promptQueue,
    queryGuard,
    readFileState,
    sandboxPermissionRequestQueue,
    searchExtraToolsHint,
    setAppState,
    setConversationId,
    setHaikuTitle,
    setHaveShownCostDialog,
    setIdleReturnPending,
    setInputValue,
    setMessages,
    setPromptQueue,
    setSandboxPermissionRequestQueue,
    setShowCostDialog,
    setShowDesktopUpsellStartup,
    setShowEffortCallout,
    setShowIdeOnboarding,
    setShowModelSwitchCallout,
    setShowUndercoverCallout,
    skipIdleCheckRef,
    store,
    teamContext,
    UndercoverAutoCallout,
    workerSandboxPermissions,
  } = state;
  return (
    <>
      {focusedInputDialog === 'sandbox-permission' && (
        <SandboxPermissionRequest
          key={sandboxPermissionRequestQueue[0]!.hostPattern.host}
          hostPattern={sandboxPermissionRequestQueue[0]!.hostPattern}
          onUserResponse={(response: { allow: boolean; persistToSettings: boolean }) => {
            const { allow, persistToSettings } = response;
            const currentRequest = sandboxPermissionRequestQueue[0];
            if (!currentRequest) return;

            const approvedHost = currentRequest.hostPattern.host;

            if (persistToSettings) {
              const update = {
                type: 'addRules' as const,
                rules: [
                  {
                    toolName: WEB_FETCH_TOOL_NAME,
                    ruleContent: `domain:${approvedHost}`,
                  },
                ],
                behavior: (allow ? 'allow' : 'deny') as 'allow' | 'deny',
                destination: 'localSettings' as const,
              };

              setAppState((prev: any) => ({
                ...prev,
                toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, update),
              }));

              persistPermissionUpdate(update);

              // Immediately update sandbox in-memory config to prevent race conditions
              // where pending requests slip through before settings change is detected
              SandboxManager.refreshConfig();
            }

            // Resolve ALL pending requests for the same host (not just the first one)
            // This handles the case where multiple parallel requests came in for the same domain
            setSandboxPermissionRequestQueue((queue: any[]) => {
              queue
                .filter((item: any) => item.hostPattern.host === approvedHost)
                .forEach((item: any) => item.resolvePromise(allow));
              return queue.filter((item: any) => item.hostPattern.host !== approvedHost);
            });

          }}
        />
      )}
      {focusedInputDialog === 'prompt' && (
        <PromptDialog
          key={promptQueue[0]!.request.prompt}
          title={promptQueue[0]!.title}
          toolInputSummary={promptQueue[0]!.toolInputSummary}
          request={promptQueue[0]!.request}
          onRespond={selectedKey => {
            const item = promptQueue[0];
            if (!item) return;
            item.resolve({
              prompt_response: item.request.prompt,
              selected: selectedKey,
            });
            setPromptQueue(([, ...tail]: any[]) => tail);
          }}
          onAbort={() => {
            const item = promptQueue[0];
            if (!item) return;
            item.reject(new Error('Prompt cancelled by user'));
            setPromptQueue(([, ...tail]: any[]) => tail);
          }}
        />
      )}
      {/* Show pending indicator on worker while waiting for leader approval */}
      {pendingWorkerRequest && (
        <WorkerPendingPermission
          toolName={pendingWorkerRequest.toolName}
          description={pendingWorkerRequest.description}
        />
      )}
      {/* Show pending indicator for sandbox permission on worker side */}
      {pendingSandboxRequest && (
        <WorkerPendingPermission
          toolName="Network Access"
          description={`Waiting for leader to approve network access to ${pendingSandboxRequest.host}`}
        />
      )}
      {/* Worker sandbox permission requests from swarm workers */}
      {focusedInputDialog === 'worker-sandbox-permission' && (
        <SandboxPermissionRequest
          key={workerSandboxPermissions.queue[0]!.requestId}
          hostPattern={
            {
              host: workerSandboxPermissions.queue[0]!.host,
              port: undefined,
            } as NetworkHostPattern
          }
          onUserResponse={(response: { allow: boolean; persistToSettings: boolean }) => {
            const { allow, persistToSettings } = response;
            const currentRequest = workerSandboxPermissions.queue[0];
            if (!currentRequest) return;

            const approvedHost = currentRequest.host;

            // Send response via mailbox to the worker
            void sendSandboxPermissionResponseViaMailbox(
              currentRequest.workerName,
              currentRequest.requestId,
              approvedHost,
              allow,
              teamContext?.teamName,
            );

            if (persistToSettings && allow) {
              const update = {
                type: 'addRules' as const,
                rules: [
                  {
                    toolName: WEB_FETCH_TOOL_NAME,
                    ruleContent: `domain:${approvedHost}`,
                  },
                ],
                behavior: 'allow' as const,
                destination: 'localSettings' as const,
              };

              setAppState((prev: any) => ({
                ...prev,
                toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, update),
              }));

              persistPermissionUpdate(update);
              SandboxManager.refreshConfig();
            }

            // Remove from queue
            setAppState((prev: any) => ({
              ...prev,
              workerSandboxPermissions: {
                ...prev.workerSandboxPermissions,
                queue: prev.workerSandboxPermissions.queue.slice(1),
              },
            }));
          }}
        />
      )}
      {focusedInputDialog === 'elicitation' && (
        <ElicitationDialog
          key={elicitation.queue[0]!.serverName + ':' + String(elicitation.queue[0]!.requestId)}
          event={elicitation.queue[0]!}
          onResponse={(action, content) => {
            const currentRequest = elicitation.queue[0];
            if (!currentRequest) return;
            // Call respond callback to resolve Promise
            currentRequest.respond({ action, content });
            // For URL accept, keep in queue for phase 2
            const isUrlAccept = currentRequest.params.mode === 'url' && action === 'accept';
            if (!isUrlAccept) {
              setAppState((prev: any) => ({
                ...prev,
                elicitation: {
                  queue: prev.elicitation.queue.slice(1),
                },
              }));
            }
          }}
          onWaitingDismiss={action => {
            const currentRequest = elicitation.queue[0];
            // Remove from queue
            setAppState((prev: any) => ({
              ...prev,
              elicitation: {
                queue: prev.elicitation.queue.slice(1),
              },
            }));
            currentRequest?.onWaitingDismiss?.(action);
          }}
        />
      )}
      {focusedInputDialog === 'cost' && (
        <CostThresholdDialog
          onDone={() => {
            setShowCostDialog(false);
            setHaveShownCostDialog(true);
            saveGlobalConfig(current => ({
              ...current,
              hasAcknowledgedCostThreshold: true,
            }));
            logEvent('tengu_cost_threshold_acknowledged', {});
          }}
        />
      )}
      {focusedInputDialog === 'idle-return' && idleReturnPending && (
        <IdleReturnDialog
          idleMinutes={idleReturnPending.idleMinutes}
          totalInputTokens={getTotalInputTokens()}
          onDone={async action => {
            const pending = idleReturnPending;
            setIdleReturnPending(null);
            logEvent('tengu_idle_return_action', {
              action: action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              idleMinutes: Math.round(pending.idleMinutes),
              messageCount: messagesRef.current.length,
              totalInputTokens: getTotalInputTokens(),
            });
            if (action === 'dismiss') {
              setInputValue(pending.input);
              return;
            }
            if (action === 'never') {
              saveGlobalConfig(current => {
                if (current.idleReturnDismissed) return current;
                return { ...current, idleReturnDismissed: true };
              });
            }
            if (action === 'clear') {
              const { clearConversation } = await import('../../../commands/clear/conversation.js');
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
            }
            skipIdleCheckRef.current = true;
            void onSubmitRef.current(pending.input, {
              setCursorOffset: () => {},
              clearBuffer: () => {},
              resetHistory: () => {},
            });
          }}
        />
      )}
      {focusedInputDialog === 'ide-onboarding' && (
        <IdeOnboardingDialog onDone={() => setShowIdeOnboarding(false)} installationStatus={ideInstallationStatus} />
      )}
      {process.env.USER_TYPE === 'ant' && focusedInputDialog === 'model-switch' && AntModelSwitchCallout && (
        <AntModelSwitchCallout
          onDone={(selection: string, modelAlias?: string) => {
            setShowModelSwitchCallout(false);
            if (selection === 'switch' && modelAlias) {
              setAppState((prev: any) => ({
                ...prev,
                mainLoopModel: modelAlias,
                mainLoopModelForSession: null,
              }));
            }
          }}
        />
      )}
      {process.env.USER_TYPE === 'ant' && focusedInputDialog === 'undercover-callout' && UndercoverAutoCallout && (
        <UndercoverAutoCallout onDone={() => setShowUndercoverCallout(false)} />
      )}
      {focusedInputDialog === 'effort-callout' && (
        <EffortCallout
          model={mainLoopModel}
          onDone={selection => {
            setShowEffortCallout(false);
            if (selection !== 'dismiss') {
              setAppState((prev: any) => ({
                ...prev,
                effortValue: selection,
              }));
            }
          }}
        />
      )}

      {exitFlow}

      {focusedInputDialog === 'search-extra-tools-hint' && searchExtraToolsHint.visible && (
        <SearchExtraToolsHint
          tools={searchExtraToolsHint.tools}
          onSelect={searchExtraToolsHint.handleSelect}
          onDismiss={searchExtraToolsHint.handleDismiss}
        />
      )}

      {focusedInputDialog === 'desktop-upsell' && (
        <DesktopUpsellStartup onDone={() => setShowDesktopUpsellStartup(false)} />
      )}

    </>
  );
}
