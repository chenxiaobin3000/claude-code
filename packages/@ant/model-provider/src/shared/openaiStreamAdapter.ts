import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import { randomUUID } from 'crypto'

function invalidStream(message: string): Error {
  return Object.assign(
    new Error(`invalid_chat_completion_response: ${message}`),
    { code: 'invalid_chat_completion_response' },
  )
}

/**
 * Adapt an OpenAI streaming response into Anthropic BetaRawMessageStreamEvent.
 *
 * Mapping:
 *   First chunk              → message_start
 *   delta.reasoning_content  → content_block_start(thinking) + thinking_delta + content_block_stop
 *   delta.content            → content_block_start(text) + text_delta + content_block_stop
 *   delta.tool_calls         → content_block_start(tool_use) + input_json_delta + content_block_stop
 *   finish_reason            → message_delta(stop_reason) + message_stop
 *
 * Usage field mapping (OpenAI → Anthropic):
 *   prompt_tokens - cached_tokens             → input_tokens (non-cached input only)
 *   completion_tokens                         → output_tokens
 *   prompt_tokens_details.cached_tokens       → cache_read_input_tokens
 *   (no OpenAI equivalent)                    → cache_creation_input_tokens (always 0)
 *
 *   All four fields are emitted in the post-loop message_delta (not message_start)
 *   so that trailing usage chunks (sent after finish_reason by some
 *   OpenAI-compatible endpoints) are fully captured before the final counts are reported.
 *
 * Thinking support:
 *   DeepSeek and compatible providers send `delta.reasoning_content` for chain-of-thought.
 *   This is mapped to Anthropic's `thinking` content blocks:
 *     content_block_start: { type: 'thinking', thinking: '', signature: '' }
 *     content_block_delta: { type: 'thinking_delta', thinking: '...' }
 *
 * Prompt caching:
 *   OpenAI reports cached tokens in usage.prompt_tokens_details.cached_tokens.
 *   This is mapped to Anthropic's cache_read_input_tokens.
 */
export async function* adaptOpenAIStreamToAnthropic(
  stream: AsyncIterable<ChatCompletionChunk>,
  model: string,
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`

  let started = false
  let currentContentIndex = -1

  // Track tool_use blocks: tool_calls index → { contentIndex, id, name, arguments }
  const toolBlocks = new Map<
    number,
    { contentIndex: number; id: string; name: string; arguments: string }
  >()

  // Track thinking block state
  let thinkingBlockOpen = false

  // Track text block state
  let textBlockOpen = false

  // Track usage — all four Anthropic fields, populated from OpenAI usage fields:
  // rawInputTokens tracks the raw prompt_tokens (OpenAI total, including cached).
  // inputTokens is the derived Anthropic value (non-cached only = rawInputTokens - cachedReadTokens).
  let rawInputTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cachedReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  let totalTokens = 0
  let usageComplete = false

  // Track all open content block indices (for cleanup)
  const openBlockIndices = new Set<number>()

  // Deferred finish state
  let pendingFinishReason: string | null = null
  let pendingHasToolCalls = false

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta

    // Extract usage from any chunk that carries it.
    if (chunk.usage) {
      usageComplete = true
      rawInputTokens = chunk.usage.prompt_tokens ?? rawInputTokens
      const usageDetails = chunk.usage as unknown as {
        prompt_tokens_details?: {
          cached_tokens?: number
          cache_write_tokens?: number
        }
        completion_tokens_details?: { reasoning_tokens?: number }
      }
      const rawCached =
        usageDetails.prompt_tokens_details?.cached_tokens ?? cachedReadTokens
      // Anthropic's input_tokens = non-cached input only. OpenAI's prompt_tokens
      // includes cached tokens, so subtract. Clamp to 0 in case cached > total
      // due to a streaming race.
      inputTokens = Math.max(0, rawInputTokens - rawCached)
      outputTokens = chunk.usage.completion_tokens ?? outputTokens
      cachedReadTokens = rawCached
      cacheWriteTokens =
        usageDetails.prompt_tokens_details?.cache_write_tokens ??
        cacheWriteTokens
      reasoningTokens =
        usageDetails.completion_tokens_details?.reasoning_tokens ??
        reasoningTokens
      totalTokens = chunk.usage.total_tokens ?? totalTokens
    }

    // Emit message_start on first chunk
    if (!started) {
      started = true

      yield {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: inputTokens,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cachedReadTokens,
          },
        },
      } as unknown as BetaRawMessageStreamEvent
    }

    // Skip chunks that carry only usage data (no delta content)
    if (!delta) continue

    if (
      (delta as unknown as { function_call?: unknown }).function_call != null
    ) {
      throw invalidStream(
        'legacy delta.function_call is unsupported; endpoint must emit delta.tool_calls',
      )
    }

    // Handle reasoning_content → Anthropic thinking block.
    // Empty string is a valid signal: DeepSeek v4 thinking mode sometimes
    // returns reasoning_content: "" when the model answers directly. The
    // empty thinking block must round-trip back to the API in subsequent
    // requests, otherwise DeepSeek rejects with 400.
    const reasoningContent = (delta as any).reasoning_content
    if (reasoningContent != null) {
      if (!thinkingBlockOpen) {
        currentContentIndex++
        thinkingBlockOpen = true
        openBlockIndices.add(currentContentIndex)

        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: {
            type: 'thinking',
            thinking: '',
            signature: '',
          },
        } as BetaRawMessageStreamEvent
      }

      if (reasoningContent !== '') {
        yield {
          type: 'content_block_delta',
          index: currentContentIndex,
          delta: {
            type: 'thinking_delta',
            thinking: reasoningContent,
          },
        } as BetaRawMessageStreamEvent
      }
    }

    // Preserve both normal content and refusal text. The internal protocol has
    // no separate refusal block, so refusal is surfaced as assistant text.
    const textFragments = [
      delta.content,
      (delta as unknown as { refusal?: string | null }).refusal,
    ].filter((value): value is string => value != null && value !== '')
    for (const textFragment of textFragments) {
      if (!textBlockOpen) {
        // Close thinking block if still open
        if (thinkingBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          openBlockIndices.delete(currentContentIndex)
          thinkingBlockOpen = false
        }

        currentContentIndex++
        textBlockOpen = true
        openBlockIndices.add(currentContentIndex)

        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: {
            type: 'text',
            text: '',
          },
        } as BetaRawMessageStreamEvent
      }

      yield {
        type: 'content_block_delta',
        index: currentContentIndex,
        delta: {
          type: 'text_delta',
          text: textFragment,
        },
      } as BetaRawMessageStreamEvent
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index

        if (!toolBlocks.has(tcIndex)) {
          // Close thinking block if open
          if (thinkingBlockOpen) {
            yield {
              type: 'content_block_stop',
              index: currentContentIndex,
            } as BetaRawMessageStreamEvent
            openBlockIndices.delete(currentContentIndex)
            thinkingBlockOpen = false
          }

          // Close text block if open
          if (textBlockOpen) {
            yield {
              type: 'content_block_stop',
              index: currentContentIndex,
            } as BetaRawMessageStreamEvent
            openBlockIndices.delete(currentContentIndex)
            textBlockOpen = false
          }

          // Start new tool_use block
          currentContentIndex++
          const toolId =
            tc.id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`
          const toolName = tc.function?.name || ''
          if (!toolName) {
            throw invalidStream(
              `tool call at index ${tcIndex} started without a function name`,
            )
          }

          toolBlocks.set(tcIndex, {
            contentIndex: currentContentIndex,
            id: toolId,
            name: toolName,
            arguments: '',
          })
          openBlockIndices.add(currentContentIndex)

          yield {
            type: 'content_block_start',
            index: currentContentIndex,
            content_block: {
              type: 'tool_use',
              id: toolId,
              name: toolName,
              input: {},
            },
          } as BetaRawMessageStreamEvent
        }

        // Stream argument fragments
        const argFragment = tc.function?.arguments
        if (argFragment) {
          toolBlocks.get(tcIndex)!.arguments += argFragment
          yield {
            type: 'content_block_delta',
            index: toolBlocks.get(tcIndex)!.contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: argFragment,
            },
          } as BetaRawMessageStreamEvent
        }
      }
    }

    // Handle finish
    if (choice?.finish_reason) {
      if (thinkingBlockOpen) {
        yield {
          type: 'content_block_stop',
          index: currentContentIndex,
        } as BetaRawMessageStreamEvent
        openBlockIndices.delete(currentContentIndex)
        thinkingBlockOpen = false
      }

      if (textBlockOpen) {
        yield {
          type: 'content_block_stop',
          index: currentContentIndex,
        } as BetaRawMessageStreamEvent
        openBlockIndices.delete(currentContentIndex)
        textBlockOpen = false
      }

      for (const [, block] of toolBlocks) {
        if (openBlockIndices.has(block.contentIndex)) {
          yield {
            type: 'content_block_stop',
            index: block.contentIndex,
          } as BetaRawMessageStreamEvent
          openBlockIndices.delete(block.contentIndex)
        }
      }

      pendingFinishReason = choice.finish_reason
      pendingHasToolCalls = toolBlocks.size > 0
    }
  }

  // Safety: close any remaining open blocks
  for (const idx of openBlockIndices) {
    yield {
      type: 'content_block_stop',
      index: idx,
    } as unknown as BetaRawMessageStreamEvent
  }

  if (pendingFinishReason === null) {
    throw invalidStream('stream ended without a non-null finish_reason')
  }

  // Emit message_delta + message_stop
  if (pendingFinishReason !== null) {
    const stopReason =
      pendingFinishReason === 'length'
        ? 'max_tokens'
        : pendingHasToolCalls
          ? 'tool_use'
          : mapFinishReason(pendingFinishReason)

    yield {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cachedReadTokens,
        cache_creation_input_tokens: 0,
        raw_input_tokens: rawInputTokens,
        total_tokens: totalTokens,
        reasoning_output_tokens: reasoningTokens,
        cache_write_input_tokens: cacheWriteTokens,
        usage_complete: usageComplete,
      },
    } as unknown as BetaRawMessageStreamEvent

    yield {
      type: 'message_stop',
    } as BetaRawMessageStreamEvent
  }
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}
