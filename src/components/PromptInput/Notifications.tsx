import { feature } from 'bun:bundle';
import * as React from 'react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type Notification, useNotifications } from 'src/context/notifications.js';
import { logEvent } from 'src/services/analytics/index.js';
import { useAppState } from 'src/state/AppState.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import { useIdeConnectionStatus } from '../../hooks/useIdeConnectionStatus.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { Box, Text } from '@anthropic/ink';
import { calculateTokenWarningState } from '../../services/compact/autoCompact.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { Message } from '../../types/message.js';
import { getExternalEditor } from '../../utils/editor.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatDuration } from '../../utils/format.js';
import { setEnvHookNotifier } from '../../utils/hooks/fileChangedWatcher.js';
import { toIDEDisplayName } from '../../utils/ide.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { IdeStatusIndicator } from '../IdeStatusIndicator.js';
import { MemoryUsageIndicator } from '../MemoryUsageIndicator.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';
import { TokenWarning } from '../TokenWarning.js';
import { SandboxPromptFooterHint } from './SandboxPromptFooterHint.js';

export const FOOTER_TEMPORARY_STATUS_TIMEOUT = 5000;

type Props = {
  apiKeyStatus: VerificationStatus;
  debug: boolean;
  verbose: boolean;
  messages: Message[];
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  isInputWrapped?: boolean;
  isNarrow?: boolean;
};

export function Notifications({
  apiKeyStatus,
  debug,
  verbose,
  messages,
  ideSelection,
  mcpClients,
  isInputWrapped = false,
  isNarrow = false,
}: Props): ReactNode {
  const tokenUsage = useMemo(() => {
    const messagesForTokenCount = getMessagesAfterCompactBoundary(messages);
    return tokenCountFromLastAPIResponse(messagesForTokenCount);
  }, [messages]);

  // AppState-sourced model — same source as API requests. getMainLoopModel()
  // re-reads settings.json on every call, so another session's /model write
  // would leak into this session's display (anthropics/claude-code#37596).
  const mainLoopModel = useMainLoopModel();
  const isShowingCompactMessage = calculateTokenWarningState(tokenUsage, mainLoopModel).isAboveWarningThreshold;
  const { status: ideStatus } = useIdeConnectionStatus(mcpClients);
  const notifications = useAppState(s => s.notifications);
  const { addNotification, removeNotification } = useNotifications();

  // Register env hook notifier for CwdChanged/FileChanged feedback
  useEffect(() => {
    setEnvHookNotifier((text, isError) => {
      addNotification({
        key: 'env-hook',
        text,
        color: isError ? 'error' : undefined,
        priority: isError ? 'medium' : 'low',
        timeoutMs: isError ? 8000 : 5000,
      });
    });
    return () => setEnvHookNotifier(null);
  }, [addNotification]);

  // Check if we should show the IDE selection indicator
  const shouldShowIdeSelection =
    ideStatus === 'connected' && (ideSelection?.filePath || (ideSelection?.text && ideSelection.lineCount > 0));

  // Check if the external editor hint should be shown
  const editor = getExternalEditor();
  const shouldShowExternalEditorHint =
    isInputWrapped &&
    !isShowingCompactMessage &&
    apiKeyStatus !== 'invalid' &&
    apiKeyStatus !== 'missing' &&
    editor !== undefined;

  // Show external editor hint as notification when input is wrapped
  useEffect(() => {
    if (shouldShowExternalEditorHint && editor) {
      logEvent('tengu_external_editor_hint_shown', {});
      addNotification({
        key: 'external-editor-hint',
        jsx: (
          <Text dimColor>
            <ConfigurableShortcutHint
              action="chat:externalEditor"
              context="Chat"
              fallback="ctrl+g"
              description={`edit in ${toIDEDisplayName(editor)}`}
            />
          </Text>
        ),
        priority: 'immediate',
        timeoutMs: 5000,
      });
    } else {
      removeNotification('external-editor-hint');
    }
  }, [shouldShowExternalEditorHint, editor, addNotification, removeNotification]);

  return (
    <SentryErrorBoundary>
      <Box flexDirection="column" alignItems={isNarrow ? 'flex-start' : 'flex-end'} flexShrink={0} overflowX="hidden">
        <NotificationContent
          ideSelection={ideSelection}
          mcpClients={mcpClients}
          notifications={notifications}
          apiKeyStatus={apiKeyStatus}
          debug={debug}
          verbose={verbose}
          tokenUsage={tokenUsage}
          mainLoopModel={mainLoopModel}
        />
      </Box>
    </SentryErrorBoundary>
  );
}

function NotificationContent({
  ideSelection,
  mcpClients,
  notifications,
  apiKeyStatus,
  debug,
  verbose,
  tokenUsage,
  mainLoopModel,
}: {
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  notifications: {
    current: Notification | null;
    queue: Notification[];
  };
  apiKeyStatus: VerificationStatus;
  debug: boolean;
  verbose: boolean;
  tokenUsage: number;
  mainLoopModel: string;
}): ReactNode {
  const isBriefOnlyState = useAppState(s => s.isBriefOnly);
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ? isBriefOnlyState : false;

  return (
    <>
      <IdeStatusIndicator ideSelection={ideSelection} mcpClients={mcpClients} />
      {notifications.current &&
        ('jsx' in notifications.current ? (
          <Text wrap="truncate" key={notifications.current.key}>
            {notifications.current.jsx}
          </Text>
        ) : (
          <Text color={notifications.current.color} dimColor={!notifications.current.color} wrap="truncate">
            {notifications.current.text}
          </Text>
        ))}
      {(apiKeyStatus === 'invalid' || apiKeyStatus === 'missing') && (
        <Box>
          <Text color="error" wrap="truncate">
            {isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
              ? 'Authentication error · Try again'
              : 'Not logged in · Run /login'}
          </Text>
        </Box>
      )}
      {debug && (
        <Box>
          <Text color="warning" wrap="truncate">
            Debug mode
          </Text>
        </Box>
      )}
      {apiKeyStatus !== 'invalid' && apiKeyStatus !== 'missing' && verbose && (
        <Box>
          <Text dimColor wrap="truncate">
            {tokenUsage} tokens
          </Text>
        </Box>
      )}
      {!isBriefOnly && <TokenWarning tokenUsage={tokenUsage} model={mainLoopModel} />}
      <MemoryUsageIndicator />
      <SandboxPromptFooterHint />
    </>
  );
}
