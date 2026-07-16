import { APIUserAbortError } from '@anthropic-ai/sdk/error'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import type { Tools } from '../../Tool.js'
import { API_MAX_MEDIA_PER_REQUEST } from '../../constants/apiLimits.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import { withStreamingVCR } from '../vcr.js'
import { queryModelOpenAI } from '../api/openai/index.js'
import {
  prepareMessages,
  prepareTools,
  stripExcessMediaItems,
} from './prepareRequest.js'
import type { ModelQueryOptions, PreparedModelRequest } from './types.js'

/** Single provider dispatch point for the OpenAI-only runtime. */
export async function* queryPreparedModel(
  request: PreparedModelRequest,
  signal: AbortSignal,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  boolean,
  void
> {
  yield* queryModelOpenAI(request, signal)
  return true
}

async function* executeModelQuery(params: {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  signal: AbortSignal
  options: ModelQueryOptions
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void,
  void
> {
  const preparedTools = await prepareTools(params.tools, params.options)
  const messages = stripExcessMediaItems(
    prepareMessages(params.messages, preparedTools.filteredTools, {
      useSearchExtraTools: preparedTools.useSearchExtraTools,
      allowAdvisorBlocks: false,
    }),
    API_MAX_MEDIA_PER_REQUEST,
  )

  yield* queryPreparedModel(
    {
      messages,
      systemPrompt: params.systemPrompt,
      ...preparedTools,
      options: params.options,
    },
    params.signal,
  )
}

export async function* queryModelWithStreaming(params: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: ModelQueryOptions
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void,
  void
> {
  const { messages, systemPrompt, tools, signal, options } = params
  return yield* withStreamingVCR(messages, async function* () {
    yield* executeModelQuery({ messages, systemPrompt, tools, signal, options })
  })
}

export async function queryModelWithoutStreaming(params: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: ModelQueryOptions
}): Promise<AssistantMessage> {
  let assistantMessage: AssistantMessage | undefined
  for await (const message of queryModelWithStreaming(params)) {
    if (message.type === 'assistant') {
      assistantMessage = message as AssistantMessage
    }
  }
  if (assistantMessage) return assistantMessage
  if (params.signal.aborted) throw new APIUserAbortError()
  throw new Error('No assistant message found')
}
