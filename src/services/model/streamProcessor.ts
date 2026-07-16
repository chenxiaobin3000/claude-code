import type {
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { EMPTY_USAGE, type NonNullableUsage } from '@ant/model-provider'
import { randomUUID } from 'node:crypto'
import type { Tools } from '../../Tool.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import {
  createAssistantAPIErrorMessage,
  normalizeContentFromAPI,
} from '../../utils/messages.js'
import { mergeUsage } from './usage.js'

export type ModelStreamOutput =
  | StreamEvent
  | AssistantMessage
  | SystemAPIErrorMessage

export type ModelStreamSummary = {
  messages: AssistantMessage[]
  usage: NonNullableUsage
  stopReason: string | null
  ttftMs: number
  firstTokenReceived: boolean
}

function assembleAssistantOutputs(params: {
  partialMessage: BetaMessage | null
  contentBlocks: Record<number, Record<string, unknown>>
  tools: Tools
  agentId?: AgentId
  usage: NonNullableUsage
  stopReason: string | null
  maxOutputTokens: number
}): (AssistantMessage | SystemAPIErrorMessage)[] {
  const blocks = Object.keys(params.contentBlocks)
    .sort((left, right) => Number(left) - Number(right))
    .map(key => params.contentBlocks[Number(key)])
    .filter(Boolean)
  const outputs: (AssistantMessage | SystemAPIErrorMessage)[] = []

  if (blocks.length > 0 && params.partialMessage) {
    outputs.push({
      message: {
        ...params.partialMessage,
        content: normalizeContentFromAPI(
          blocks as unknown as BetaMessage['content'],
          params.tools,
          params.agentId,
        ),
        usage: params.usage,
        stop_reason: params.stopReason,
        stop_sequence: null,
      } as AssistantMessage['message'],
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    })
  }

  if (params.stopReason === 'max_tokens') {
    outputs.push(
      createAssistantAPIErrorMessage({
        content:
          `Output truncated: response exceeded the ${params.maxOutputTokens} token limit. ` +
          'Set OPENAI_MAX_TOKENS or CLAUDE_CODE_MAX_OUTPUT_TOKENS to override.',
        apiError: 'max_output_tokens',
        error: 'max_output_tokens',
      }),
    )
  }

  return outputs
}

/** Consume provider-neutral compatibility events and assemble application messages. */
export async function* processModelStream(params: {
  events: AsyncIterable<BetaRawMessageStreamEvent>
  tools: Tools
  agentId?: AgentId
  maxOutputTokens: number
  startedAt: number
  onFirstToken?: (ttftMs: number) => void
}): AsyncGenerator<ModelStreamOutput, ModelStreamSummary, void> {
  const contentBlocks: Record<number, Record<string, unknown>> = {}
  const messages: AssistantMessage[] = []
  let partialMessage: BetaMessage | null = null
  let stopReason: string | null = null
  let usage: NonNullableUsage = { ...EMPTY_USAGE }
  let ttftMs = 0
  let firstTokenReceived = false

  for await (const event of params.events) {
    switch (event.type) {
      case 'message_start':
        partialMessage = event.message
        ttftMs = Date.now() - params.startedAt
        if (!firstTokenReceived) {
          firstTokenReceived = true
          params.onFirstToken?.(ttftMs)
        }
        usage = mergeUsage(usage, event.message.usage as BetaMessageDeltaUsage)
        break
      case 'content_block_start': {
        const block = event.content_block
        if (block.type === 'tool_use') {
          contentBlocks[event.index] = { ...block, input: '' }
        } else if (block.type === 'text') {
          contentBlocks[event.index] = { ...block, text: '' }
        } else if (block.type === 'thinking') {
          contentBlocks[event.index] = {
            ...block,
            thinking: '',
            signature: '',
          }
        } else {
          contentBlocks[event.index] = { ...block }
        }
        break
      }
      case 'content_block_delta': {
        const block = contentBlocks[event.index]
        if (!block) break
        const delta = event.delta
        if (delta.type === 'text_delta') {
          block.text = `${(block.text as string | undefined) ?? ''}${delta.text}`
        } else if (delta.type === 'input_json_delta') {
          block.input = `${(block.input as string | undefined) ?? ''}${delta.partial_json}`
        } else if (delta.type === 'thinking_delta') {
          block.thinking = `${(block.thinking as string | undefined) ?? ''}${delta.thinking}`
        } else if (delta.type === 'signature_delta') {
          block.signature = delta.signature
        }
        break
      }
      case 'message_delta':
        usage = mergeUsage(usage, event.usage)
        if (event.delta.stop_reason != null) {
          stopReason = event.delta.stop_reason
        }
        break
      case 'message_stop':
        if (partialMessage) {
          for (const output of assembleAssistantOutputs({
            partialMessage,
            contentBlocks,
            tools: params.tools,
            agentId: params.agentId,
            usage,
            stopReason,
            maxOutputTokens: params.maxOutputTokens,
          })) {
            if (output.type === 'assistant') messages.push(output)
            yield output
          }
          partialMessage = null
        }
        break
    }

    yield {
      type: 'stream_event',
      event,
      ...(event.type === 'message_start' ? { ttftMs } : undefined),
    } as StreamEvent
  }

  if (partialMessage) {
    for (const output of assembleAssistantOutputs({
      partialMessage,
      contentBlocks,
      tools: params.tools,
      agentId: params.agentId,
      usage,
      stopReason,
      maxOutputTokens: params.maxOutputTokens,
    })) {
      if (output.type === 'assistant') messages.push(output)
      yield output
    }
  }

  return {
    messages,
    usage,
    stopReason,
    ttftMs,
    firstTokenReceived,
  }
}
