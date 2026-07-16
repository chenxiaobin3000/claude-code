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
import { RemoteCallout } from '../../../components/RemoteCallout.js';
import { createAbortController } from '../../../utils/abortController.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { LspRecommendationMenu } from 'src/components/LspRecommendation/LspRecommendationMenu.js';
import { PluginHintMenu } from 'src/components/ClaudeCodeHint/PluginHintMenu.js';
import { SearchExtraToolsHint } from 'src/components/SearchExtraToolsHint.js';
import {
  DesktopUpsellStartup,
  shouldShowDesktopUpsellStartup,
} from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import { UltraplanChoiceDialog } from '../../../components/ultraplan/UltraplanChoiceDialog.js';
import { UltraplanLaunchDialog } from '../../../components/ultraplan/UltraplanLaunchDialog.js';
import { launchUltraplan } from '../../../commands/ultraplan.js';
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
    handleHintResponse,
    handleLspResponse,
    hintRecommendation,
    ideInstallationStatus,
    idleReturnPending,
    loadedNestedMemoryPathsRef,
    lspRecommendation,
    mainLoopModel,
    messagesRef,
    onSubmitRef,
    pendingSandboxRequest,
    pendingWorkerRequest,
    promptQueue,
    queryGuard,
    readFileState,
    sandboxBridgeCleanupRef,
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
    ultraplanLaunchPending,
    ultraplanPendingChoice,
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

            // Clean up bridge subscriptions and cancel remote prompts
            // for this host since the local user already responded.
            const cleanups = sandboxBridgeCleanupRef.current.get(approvedHost);
            if (cleanups) {
              for (const fn of cleanups) {
                fn();
              }
              sandboxBridgeCleanupRef.current.delete(approvedHost);
            }
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
      {focusedInputDialog === 'remote-callout' && (
        <RemoteCallout
          onDone={selection => {
            setAppState((prev: any) => {
              if (!prev.showRemoteCallout) return prev;
              return {
                ...prev,
                showRemoteCallout: false,
                ...(selection === 'enable' && {
                  replBridgeEnabled: true,
                  replBridgeExplicit: true,
                  replBridgeOutboundOnly: false,
                }),
              };
            });
          }}
        />
      )}

      {exitFlow}

      {focusedInputDialog === 'plugin-hint' && hintRecommendation && (
        <PluginHintMenu
          pluginName={hintRecommendation.pluginName}
          pluginDescription={hintRecommendation.pluginDescription}
          marketplaceName={hintRecommendation.marketplaceName}
          sourceCommand={hintRecommendation.sourceCommand}
          onResponse={handleHintResponse}
        />
      )}

      {focusedInputDialog === 'search-extra-tools-hint' && searchExtraToolsHint.visible && (
        <SearchExtraToolsHint
          tools={searchExtraToolsHint.tools}
          onSelect={searchExtraToolsHint.handleSelect}
          onDismiss={searchExtraToolsHint.handleDismiss}
        />
      )}

      {focusedInputDialog === 'lsp-recommendation' && lspRecommendation && (
        <LspRecommendationMenu
          pluginName={lspRecommendation.pluginName}
          pluginDescription={lspRecommendation.pluginDescription}
          fileExtension={lspRecommendation.fileExtension}
          onResponse={handleLspResponse}
        />
      )}

      {focusedInputDialog === 'desktop-upsell' && (
        <DesktopUpsellStartup onDone={() => setShowDesktopUpsellStartup(false)} />
      )}

      {feature('ULTRAPLAN')
        ? focusedInputDialog === 'ultraplan-choice' &&
          ultraplanPendingChoice && (
            <UltraplanChoiceDialog
              plan={ultraplanPendingChoice.plan}
              sessionId={ultraplanPendingChoice.sessionId}
              taskId={ultraplanPendingChoice.taskId}
              setMessages={setMessages}
              readFileState={readFileState.current}
              getAppState={() => store.getState()}
              setConversationId={setConversationId}
            />
          )
        : null}

      {feature('ULTRAPLAN')
        ? focusedInputDialog === 'ultraplan-launch' &&
          ultraplanLaunchPending && (
            <UltraplanLaunchDialog
              onChoice={(choice, opts) => {
                const blurb = ultraplanLaunchPending.blurb;
                setAppState((prev: any) =>
                  prev.ultraplanLaunchPending ? { ...prev, ultraplanLaunchPending: undefined } : prev,
                );
                if (choice === 'cancel') return;
                // Command's onDone used display:'skip', so add the
                // echo here — gives immediate feedback before the
                // ~5s teleportToRemote resolves.
                setMessages((prev: any[]) => [
                  ...prev,
                  createCommandInputMessage(formatCommandInputTags('ultraplan', blurb)),
                ]);
                const appendStdout = (msg: string) =>
                  setMessages((prev: any[]) => [
                    ...prev,
                    createCommandInputMessage(
                      `<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(msg)}</${LOCAL_COMMAND_STDOUT_TAG}>`,
                    ),
                  ]);
                // Defer the second message if a query is mid-turn
                // so it lands after the assistant reply, not
                // between the user's prompt and the reply.
                const appendWhenIdle = (msg: string) => {
                  if (!queryGuard.isActive) {
                    appendStdout(msg);
                    return;
                  }
                  const unsub = queryGuard.subscribe(() => {
                    if (queryGuard.isActive) return;
                    unsub();
                    // Skip if the user stopped ultraplan while we
                    // were waiting — avoids a stale "Monitoring
                    // <url>" message for a session that's gone.
                    if (!store.getState().ultraplanSessionUrl) return;
                    appendStdout(msg);
                  });
                };
                void launchUltraplan({
                  blurb,
                  promptIdentifier: opts?.promptIdentifier,
                  getAppState: () => store.getState(),
                  setAppState,
                  signal: createAbortController().signal,
                  disconnectedBridge: opts?.disconnectedBridge,
                  onSessionReady: appendWhenIdle,
                })
                  .then(appendStdout)
                  .catch(logError);
              }}
            />
          )
        : null}
    </>
  );
}
