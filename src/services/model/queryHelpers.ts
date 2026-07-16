import type { BetaJSONOutputFormat } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import { createUserMessage } from '../../utils/messages.js'
import { getSmallFastModel } from '../../utils/model/model.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
import { withVCR } from '../vcr.js'
import { queryModelWithoutStreaming } from './query.js'
import type { ModelQueryOptions } from './types.js'

type SmallModelOptions = Omit<
  ModelQueryOptions,
  'model' | 'getToolPermissionContext'
>

/** Query the configured small/fast model through the OpenAI-compatible path. */
export async function queryHaiku(params: {
  systemPrompt?: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: SmallModelOptions
}): Promise<AssistantMessage> {
  const systemPrompt = params.systemPrompt ?? asSystemPrompt([])
  const result = await withVCR(
    [
      createUserMessage({
        content: systemPrompt.map(text => ({ type: 'text', text })),
      }),
      createUserMessage({ content: params.userPrompt }),
    ],
    async () => {
      const message = await queryModelWithoutStreaming({
        messages: [createUserMessage({ content: params.userPrompt })],
        systemPrompt,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: params.signal,
        options: {
          ...params.options,
          model: getSmallFastModel(),
          enablePromptCaching: params.options.enablePromptCaching ?? false,
          outputFormat: params.outputFormat,
          async getToolPermissionContext() {
            return getEmptyToolPermissionContext()
          },
        },
      })
      return [message]
    },
  )
  return result[0] as AssistantMessage
}

type QueryWithModelOptions = Omit<ModelQueryOptions, 'getToolPermissionContext'>

export async function queryWithModel(params: {
  systemPrompt?: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: QueryWithModelOptions
}): Promise<AssistantMessage> {
  const systemPrompt = params.systemPrompt ?? asSystemPrompt([])
  const result = await withVCR(
    [
      createUserMessage({
        content: systemPrompt.map(text => ({ type: 'text', text })),
      }),
      createUserMessage({ content: params.userPrompt }),
    ],
    async () => {
      const message = await queryModelWithoutStreaming({
        messages: [createUserMessage({ content: params.userPrompt })],
        systemPrompt,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: params.signal,
        options: {
          ...params.options,
          enablePromptCaching: params.options.enablePromptCaching ?? false,
          outputFormat: params.outputFormat,
          async getToolPermissionContext() {
            return getEmptyToolPermissionContext()
          },
        },
      })
      return [message]
    },
  )
  return result[0] as AssistantMessage
}
