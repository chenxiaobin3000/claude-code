import { Text } from '@anthropic/ink';
import { useCallback } from 'react';
import { resumeAgentBackground } from '@claude-code-best/builtin-tools/tools/AgentTool/resumeAgent.js';
import type { useNotifications } from '../../../context/notifications.js';
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js';
import type { useSetAppState } from '../../../state/AppState.js';
import { injectUserMessageToTeammate } from '../../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from '../../../tasks/InProcessTeammateTask/types.js';
import {
  appendMessageToLocalAgent,
  isLocalAgentTask,
  type LocalAgentTaskState,
  queuePendingMessage,
} from '../../../tasks/LocalAgentTask/LocalAgentTask.js';
import type { ToolUseContext } from '../../../Tool.js';
import type { Message as MessageType } from '../../../types/message.js';
import { errorMessage } from '../../../utils/errors.js';
import type { PromptInputHelpers } from '../../../utils/handlePromptSubmit.js';
import { logForDebugging } from '../../../utils/debug.js';
import { createUserMessage } from '../../../utils/messages.js';

type SetAppState = ReturnType<typeof useSetAppState>;
type AddNotification = ReturnType<typeof useNotifications>['addNotification'];

export function useAgentActions({
  setAppState,
  setInputValue,
  getToolUseContext,
  messagesRef,
  canUseTool,
  mainLoopModel,
  addNotification,
}: {
  setAppState: SetAppState;
  setInputValue: (value: string) => void;
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ToolUseContext;
  messagesRef: React.MutableRefObject<MessageType[]>;
  canUseTool: CanUseToolFn;
  mainLoopModel: string;
  addNotification: AddNotification;
}) {
  const onAgentSubmit = useCallback(
    async (input: string, task: InProcessTeammateTaskState | LocalAgentTaskState, helpers: PromptInputHelpers) => {
      if (isLocalAgentTask(task)) {
        appendMessageToLocalAgent(task.id, createUserMessage({ content: input }), setAppState);
        if (task.status === 'running') {
          queuePendingMessage(task.id, input, setAppState);
        } else {
          void resumeAgentBackground({
            agentId: task.id,
            prompt: input,
            toolUseContext: getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel),
            canUseTool,
          }).catch(error => {
            logForDebugging(`resumeAgentBackground failed: ${errorMessage(error)}`);
            addNotification({
              key: `resume-agent-failed-${task.id}`,
              jsx: <Text color="error">Failed to resume agent: {errorMessage(error)}</Text>,
              priority: 'low',
            });
          });
        }
      } else {
        injectUserMessageToTeammate(task.id, input, undefined, setAppState);
      }
      setInputValue('');
      helpers.setCursorOffset(0);
      helpers.clearBuffer();
    },
    [setAppState, setInputValue, getToolUseContext, messagesRef, canUseTool, mainLoopModel, addNotification],
  );

  return { onAgentSubmit };
}
