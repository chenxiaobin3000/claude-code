import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'node:crypto'
import {
  adaptOpenAIStreamToAnthropic,
  anthropicMessagesToOpenAI,
  anthropicToolChoiceToOpenAI,
  anthropicToolsToOpenAI,
} from '@ant/model-provider'
import { formatDeferredToolLine } from '@claude-code-best/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../types/message.js'
import { getModelMaxOutputTokens } from '../../../utils/context.js'
import { collectSensitiveStrings } from '../../../utils/logRedaction.js'
import { resolveModelTarget } from '../../../utils/model/modelRegistry.js'
import { isDeferredToolsDeltaEnabled } from '../../../utils/searchExtraTools.js'
import { getOpenAIClient } from '../../api/openai/client.js'
import {
  buildOpenAIRequestBody,
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
} from '../../api/openai/requestBody.js'
import type { ModelProvider } from '../provider.js'
import type { PreparedModelRequest } from '../types.js'

function isOpenAIConvertibleMessage(
  message: Message,
): message is AssistantMessage | UserMessage {
  return message.type === 'assistant' || message.type === 'user'
}

function prependDeferredToolListIfNeeded(
  messages: (AssistantMessage | UserMessage)[],
  request: PreparedModelRequest,
): (AssistantMessage | UserMessage)[] {
  if (!request.useSearchExtraTools || isDeferredToolsDeltaEnabled()) {
    return messages
  }

  const deferredToolList = request.allTools
    .filter(tool => request.deferredToolNames.has(tool.name))
    .map(formatDeferredToolLine)
    .sort()
    .join('\n')

  if (!deferredToolList) return messages

  return [
    {
      type: 'user',
      uuid: randomUUID(),
      message: {
        role: 'user',
        content: `<available-deferred-tools>\n${deferredToolList}\n</available-deferred-tools>`,
      },
      timestamp: new Date().toISOString(),
      isMeta: true,
    } as UserMessage,
    ...messages,
  ]
}

export const openAIProvider: ModelProvider = {
  id: 'openai',

  async createStream(request, signal, context) {
    const target = resolveModelTarget(request.options.model)
    const model = target.model
    const enableThinking = isOpenAIThinkingEnabled(model)
    const messages = anthropicMessagesToOpenAI(
      prependDeferredToolListIfNeeded(
        request.messages.filter(isOpenAIConvertibleMessage),
        request,
      ),
      request.systemPrompt,
      { enableThinking },
    )
    const standardTools = request.toolSchemas.filter(tool => {
      const type = (tool as unknown as Record<string, unknown>).type
      return type !== 'advisor_20260301' && type !== 'computer_20250124'
    }) as BetaToolUnion[]
    const tools = anthropicToolsToOpenAI(standardTools)
    const toolChoice = anthropicToolChoiceToOpenAI(request.options.toolChoice)
    const { upperLimit } = getModelMaxOutputTokens(model)
    const maxOutputTokens = resolveOpenAIMaxTokens(
      upperLimit,
      request.options.maxOutputTokensOverride,
    )
    const stream = await getOpenAIClient({
      target,
      maxRetries: 0,
      fetchOverride: request.options.fetchOverride as unknown as typeof fetch,
      source: request.options.querySource,
    }).chat.completions.create(
      buildOpenAIRequestBody({
        model,
        messages,
        tools,
        toolChoice,
        enableThinking,
        maxTokens: maxOutputTokens,
        temperatureOverride: request.options.temperatureOverride,
      }),
      { signal },
    )

    return {
      requestId: context.requestId,
      model,
      events: adaptOpenAIStreamToAnthropic(stream, model),
      metadata: {
        endpoint: target.baseUrl,
        requestMessages: messages,
        requestTools: tools,
        maxOutputTokens,
        thinking: enableThinking,
        sensitiveValues: [target.apiKey, ...collectSensitiveStrings(messages)],
      },
    }
  },
}
