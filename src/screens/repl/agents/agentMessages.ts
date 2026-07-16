import { FORK_SUBAGENT_TYPE } from '@claude-code-best/builtin-tools/tools/AgentTool/forkSubagent.js'
import { FORK_BOILERPLATE_TAG } from '../../../constants/xml.js'
import {
  isLocalAgentTask,
  type LocalAgentTaskState,
} from '../../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { InProcessTeammateTaskState } from '../../../tasks/InProcessTeammateTask/types.js'
import type { Message as MessageType } from '../../../types/message.js'
import { createUserMessage } from '../../../utils/messages.js'

type ViewedAgentTask = InProcessTeammateTaskState | LocalAgentTaskState
const FORK_BOILERPLATE_OPEN_TAG = `<${FORK_BOILERPLATE_TAG}>`

function isForkBoilerplateTextBlock(block: {
  type: string
  text?: string
}): boolean {
  return (
    block.type === 'text' &&
    typeof block.text === 'string' &&
    block.text.includes(FORK_BOILERPLATE_OPEN_TAG)
  )
}

export function buildDisplayedAgentMessages(
  viewedAgentTask: ViewedAgentTask | undefined,
  rawAgentMessages: MessageType[] | undefined,
): MessageType[] | undefined {
  if (!viewedAgentTask) return undefined
  const agentMessages = rawAgentMessages ?? []
  if (
    !isLocalAgentTask(viewedAgentTask) ||
    viewedAgentTask.agentType !== FORK_SUBAGENT_TYPE ||
    !viewedAgentTask.prompt
  ) {
    return agentMessages
  }

  const trimmedPrompt = viewedAgentTask.prompt.trim()
  let boilerplateIndex = -1
  let lastAssistantToolUseIndex = -1
  let promptAlreadyRendered = false
  for (let index = 0; index < agentMessages.length; index++) {
    const message = agentMessages[index]!
    if (message.type === 'user' && Array.isArray(message.message?.content)) {
      const hasBoilerplate = message.message.content.some(
        isForkBoilerplateTextBlock,
      )
      if (hasBoilerplate) {
        boilerplateIndex = index
      } else if (!promptAlreadyRendered) {
        const firstText = message.message.content.find(
          block => block.type === 'text' && typeof block.text === 'string',
        ) as { type: 'text'; text: string } | undefined
        if (firstText?.text.trim() === trimmedPrompt)
          promptAlreadyRendered = true
      }
      continue
    }
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message?.content)
    ) {
      if (message.message.content.some(block => block.type === 'tool_use'))
        lastAssistantToolUseIndex = index
    }
  }

  const stripped =
    boilerplateIndex === -1
      ? agentMessages
      : agentMessages.map((message, index) => {
          if (
            index !== boilerplateIndex ||
            !Array.isArray(message.message?.content)
          )
            return message
          return {
            ...message,
            message: {
              ...message.message,
              content: message.message.content.filter(
                block => !isForkBoilerplateTextBlock(block),
              ),
            },
          }
        })

  if (promptAlreadyRendered) return stripped
  const insertAt =
    boilerplateIndex !== -1
      ? boilerplateIndex + 1
      : lastAssistantToolUseIndex + 1
  const synthetic = createUserMessage({
    content: viewedAgentTask.prompt,
    timestamp: new Date(viewedAgentTask.startTime).toISOString(),
  })
  return [
    ...stripped.slice(0, insertAt),
    synthetic,
    ...stripped.slice(insertAt),
  ]
}
