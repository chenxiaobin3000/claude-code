import { AgentTool } from '@claude-code/builtin-tools/tools/AgentTool/AgentTool.js'
import React from 'react'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type { AssistantMessage } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const directive = args.trim()
  if (!directive) {
    onDone('Usage: /subtask <directive>', { display: 'system' })
    return null
  }

  const lastAssistantMessage = [...context.messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.type === 'assistant',
    )
  if (!lastAssistantMessage) {
    onDone('Cannot start subtask: no assistant response in this session.', {
      display: 'system',
    })
    return null
  }

  try {
    void AgentTool.call(
      {
        prompt: directive,
        run_in_background: true,
        description: 'session subtask',
      },
      context,
      context.canUseTool!,
      lastAssistantMessage,
    ).catch(error => {
      logForDebugging(`Subtask async error: ${String(error)}`, {
        level: 'error',
      })
    })
    onDone('Subtask started in this session.', { display: 'system' })
  } catch (error) {
    onDone(
      `Subtask failed: ${error instanceof Error ? error.message : String(error)}`,
      { display: 'system' },
    )
  }
  return null
}
