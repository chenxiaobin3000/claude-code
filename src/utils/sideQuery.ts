import type Anthropic from '@anthropic-ai/sdk'
import type { ChatCompletion } from 'openai/resources/chat/completions/completions.mjs'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages.js'
import {
  getLastApiCompletionTimestamp,
  getSessionId,
  setLastApiCompletionTimestamp,
} from '../bootstrap/state.js'
import { STRUCTURED_OUTPUTS_BETA_HEADER } from '../constants/betas.js'
import type { QuerySource } from '../constants/querySource.js'
import {
  getAttributionHeader,
  getCLISyspromptPrefix,
} from '../constants/system.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/metadata.js'
import { getAPIMetadata } from '../services/model/metadata.js'
import { getAnthropicClient } from '../services/api/client.js'
import { getModelBetas, modelSupportsStructuredOutputs } from './betas.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { getAPIProvider } from './model/providers.js'
import { normalizeModelStringForAPI } from './model/model.js'
import { resolveModelTarget } from './model/modelRegistry.js'
import { getOpenAIClient } from '../services/api/openai/client.js'
import {
  buildOpenAINonStreamingRequestBody,
  resolveOpenAIMaxTokens,
} from '../services/api/openai/requestBody.js'
import {
  assertOpenAIChatCompletionResponse,
  createOpenAIRequestError,
} from '../services/api/openai/errorClassification.js'
import { collectSensitiveStrings } from './logRedaction.js'
import {
  anthropicMessagesToOpenAI,
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} from '@ant/model-provider'
import type { SystemPrompt } from './systemPromptType.js'

type MessageParam = Anthropic.MessageParam
type TextBlockParam = Anthropic.TextBlockParam
type Tool = Anthropic.Tool
type ToolChoice = Anthropic.ToolChoice
type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaJSONOutputFormat = Anthropic.Beta.Messages.BetaJSONOutputFormat
type BetaThinkingConfigParam = Anthropic.Beta.Messages.BetaThinkingConfigParam

export type SideQueryOptions = {
  /** Model to use for the query */
  model: string
  /**
   * System prompt - string or array of text blocks (will be prefixed with CLI attribution).
   *
   * The attribution header is always placed in its own TextBlockParam block to ensure
   * server-side parsing correctly extracts the cc_entrypoint value without including
   * system prompt content.
   */
  system?: string | TextBlockParam[]
  /** Messages to send (supports cache_control on content blocks) */
  messages: MessageParam[]
  /** Optional tools (supports both standard Tool[] and BetaToolUnion[] for custom tool types) */
  tools?: Tool[] | BetaToolUnion[]
  /** Optional tool choice (use { type: 'tool', name: 'x' } for forced output) */
  tool_choice?: ToolChoice
  /** Optional JSON output format for structured responses */
  output_format?: BetaJSONOutputFormat
  /** Max tokens (default: 1024) */
  max_tokens?: number
  /** Max retries (default: 2) */
  maxRetries?: number
  /** Abort signal */
  signal?: AbortSignal
  /** Skip CLI system prompt prefix (keeps attribution header for OAuth). For internal classifiers that provide their own prompt. */
  skipSystemPromptPrefix?: boolean
  /** Temperature override */
  temperature?: number
  /** Thinking budget (enables thinking), or `false` to send `{ type: 'disabled' }`. */
  thinking?: number | false
  /** Stop sequences — generation stops when any of these strings is emitted */
  stop_sequences?: string[]
  /** Attributes this call in tengu_api_success for COGS joining against reporting.sampling_calls. */
  querySource: QuerySource
  /** Marks an optional/best-effort query whose failure is handled by its caller. */
  optional?: boolean
}

/**
 * Extract system prompt text from the `system` option.
 */
function extractSystemText(system?: string | TextBlockParam[]): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system
    .filter((b): b is { type: 'text'; text: string } => 'text' in b && !!b.text)
    .map(b => b.text)
    .join('\n\n')
}

/**
 * Convert Anthropic MessageParam[] to a list of {role, content} objects
 * suitable for OpenAI-compatible chat.completions APIs.
 */
function messageParamsToOpenAIRoleContent(
  messages: MessageParam[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const result: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter(
                (b): b is { type: 'text'; text: string } => b.type === 'text',
              )
              .map(b => b.text)
              .join('\n')
          : ''
    if (text) {
      result.push({ role: m.role as 'user' | 'assistant', content: text })
    }
  }
  return result
}

/**
 * Lightweight API wrapper for "side queries" outside the main conversation loop.
 *
 * Use this instead of direct client.beta.messages.create() calls to ensure
 * proper OAuth token validation with fingerprint attribution headers.
 *
 * This handles:
 * - Fingerprint computation for OAuth validation
 * - Attribution header injection
 * - CLI system prompt prefix
 * - Proper betas for the model
 * - API metadata
 * - Model string normalization (strips [1m] suffix for API)
 * - Third-party provider routing (OpenAI-compatible)
 *
 * @example
 * // Permission explainer
 * await sideQuery({ querySource: 'permission_explainer', model, system: SYSTEM_PROMPT, messages, tools, tool_choice })
 *
 * @example
 * // Session search
 * await sideQuery({ querySource: 'session_search', model, system: SEARCH_PROMPT, messages })
 *
 * @example
 * // Model validation
 * await sideQuery({ querySource: 'model_validation', model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] })
 */
export async function sideQuery(opts: SideQueryOptions): Promise<BetaMessage> {
  const {
    model,
    system,
    messages,
    tools,
    tool_choice,
    output_format,
    max_tokens = 1024,
    maxRetries = 2,
    signal,
    skipSystemPromptPrefix,
    temperature,
    thinking,
    stop_sequences,
  } = opts

  const provider = getAPIProvider()
  if (provider === 'openai') {
    return sideQueryViaOpenAICompatible(opts)
  }

  const client = await getAnthropicClient({
    maxRetries,
    model,
    source: 'side_query',
  })
  const betas = [...getModelBetas(model)]
  // Add structured-outputs beta if using output_format and provider supports it
  if (
    output_format &&
    modelSupportsStructuredOutputs(model) &&
    !betas.includes(STRUCTURED_OUTPUTS_BETA_HEADER)
  ) {
    betas.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }

  const attributionHeader = getAttributionHeader()

  // Build system as array to keep attribution header in its own block
  // (prevents server-side parsing from including system content in cc_entrypoint)
  const systemBlocks: TextBlockParam[] = [
    attributionHeader ? { type: 'text', text: attributionHeader } : null,
    // Skip CLI system prompt prefix for internal classifiers that provide their own prompt
    ...(skipSystemPromptPrefix
      ? []
      : [
          {
            type: 'text' as const,
            text: getCLISyspromptPrefix({
              isNonInteractive: false,
              hasAppendSystemPrompt: false,
            }),
          },
        ]),
    ...(Array.isArray(system)
      ? system
      : system
        ? [{ type: 'text' as const, text: system }]
        : []),
  ].filter((block): block is TextBlockParam => block !== null)

  let thinkingConfig: BetaThinkingConfigParam | undefined
  if (thinking === false) {
    thinkingConfig = { type: 'disabled' }
  } else if (thinking !== undefined) {
    thinkingConfig = {
      type: 'enabled',
      budget_tokens: Math.min(thinking, max_tokens - 1),
    }
  }

  const normalizedModel = normalizeModelStringForAPI(model)
  const start = Date.now()
  const response: BetaMessage = await client.beta.messages.create(
      {
        model: normalizedModel,
        max_tokens,
        system: systemBlocks,
        messages,
        ...(tools && { tools }),
        ...(tool_choice && { tool_choice }),
        ...(output_format && { output_config: { format: output_format } }),
        ...(temperature !== undefined && { temperature }),
        ...(stop_sequences && { stop_sequences }),
        ...(thinkingConfig && { thinking: thinkingConfig }),
        ...(betas.length > 0 && { betas }),
        metadata: getAPIMetadata(),
      },
      { signal },
    )

  const requestId =
    (response as { _request_id?: string | null })._request_id ?? undefined
  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  logEvent('tengu_api_success', {
    requestId:
      requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      opts.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      normalizedModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs:
      lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  return response
}

/**
 * OpenAI-compatible side query.
 * Both use the OpenAI SDK with different base URLs.
 *
 * Converts Anthropic-format params to OpenAI Chat Completions, sends a
 * non-streaming request, and wraps the response back into a BetaMessage
 * shape so callers remain provider-agnostic.
 *
 * Supports tools and tool_choice for structured output (e.g. yoloClassifier,
 * permissionExplainer).
 */
async function sideQueryViaOpenAICompatible(
  opts: SideQueryOptions,
): Promise<BetaMessage> {
  const {
    model,
    system,
    messages,
    tools,
    tool_choice,
    max_tokens = 1024,
    temperature,
    thinking,
    signal,
  } = opts

  const normalizedModel = normalizeModelStringForAPI(model)

  const target = resolveModelTarget(normalizedModel)
  const openaiModel = target.model
  const client = getOpenAIClient({
    target,
    maxRetries: opts.maxRetries ?? 2,
  })

  // Build system prompt text
  const systemText = extractSystemText(system)

  // Build OpenAI messages: system first, then user/assistant
  const openaiMessages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }> = []
  if (systemText) {
    openaiMessages.push({ role: 'system', content: systemText })
  }
  openaiMessages.push(...messageParamsToOpenAIRoleContent(messages))

  // Convert tools and tool_choice if provided
  const openaiTools =
    tools && tools.length > 0
      ? anthropicToolsToOpenAI(tools as BetaToolUnion[])
      : undefined
  const openaiToolChoice = tool_choice
    ? anthropicToolChoiceToOpenAI(tool_choice)
    : undefined

  const start = Date.now()

  const requestParams = buildOpenAINonStreamingRequestBody({
    model: openaiModel,
    messages: openaiMessages,
    tools: openaiTools ?? [],
    toolChoice: openaiToolChoice,
    thinkingConfig:
      thinking === false
        ? { type: 'disabled' }
        : thinking !== undefined
          ? { type: 'enabled', budgetTokens: thinking }
          : undefined,
    maxTokens: resolveOpenAIMaxTokens(openaiModel, max_tokens),
    temperatureOverride: temperature,
  })

  const sensitiveValues = [
    target.apiKey,
    ...collectSensitiveStrings(openaiMessages),
  ]
  let response: ChatCompletion
  try {
    response = await client.chat.completions.create(
      requestParams,
      { signal },
    )
  } catch (error) {
    throw createOpenAIRequestError(error, {
      endpoint: target.baseUrl,
      phase: 'request',
      secrets: sensitiveValues,
    })
  }
  try {
    assertOpenAIChatCompletionResponse(response)
  } catch (error) {
    throw createOpenAIRequestError(error, {
      endpoint: target.baseUrl,
      phase: 'response',
      secrets: sensitiveValues,
    })
  }

  const choice = response.choices[0]
  const message = choice?.message

  // Build content blocks for BetaMessage
  const contentBlocks: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  > = []

  if (message?.content) {
    contentBlocks.push({ type: 'text', text: message.content })
  }
  if (message?.refusal) {
    contentBlocks.push({ type: 'text', text: message.refusal })
  }

  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      // ChatCompletionMessageToolCall is a union — only function-type has .function
      if (tc.type === 'function' && 'function' in tc) {
        const fn = (tc as { function: { name: string; arguments: string } })
          .function
        let input: unknown
        try {
          input = JSON.parse(fn.arguments || '{}')
        } catch (error) {
          throw createOpenAIRequestError(
            new Error(
              `invalid_chat_completion_response: tool ${JSON.stringify(fn.name)} returned invalid JSON arguments`,
              { cause: error },
            ),
            {
              endpoint: target.baseUrl,
              phase: 'response',
              secrets: sensitiveValues,
            },
          )
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id ?? `toolu_${Date.now()}`,
          name: fn.name,
          input,
        })
      } else {
        throw createOpenAIRequestError(
          new Error(
            'invalid_chat_completion_response: endpoint returned an unsupported custom tool call',
          ),
          {
            endpoint: target.baseUrl,
            phase: 'response',
            secrets: sensitiveValues,
          },
        )
      }
    }
  }

  const usageDetails = response.usage as
    | {
        prompt_tokens_details?: {
          cached_tokens?: number
          cache_write_tokens?: number
        }
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    | undefined
  const rawInputTokens = response.usage?.prompt_tokens ?? 0
  const cachedInputTokens =
    usageDetails?.prompt_tokens_details?.cached_tokens ?? 0

  const now = Date.now()
  const requestId = response.id
  const lastCompletion = getLastApiCompletionTimestamp()
  logEvent('tengu_api_success', {
    requestId:
      requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      opts.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      openaiModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    cachedInputTokens,
    uncachedInputTokens: Math.max(0, rawInputTokens - cachedInputTokens),
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs:
      lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  const stopReason =
    choice?.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice?.finish_reason === 'length'
        ? 'max_tokens'
        : 'end_turn'

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    content: contentBlocks as BetaMessage['content'],
    model: openaiModel,
    stop_reason: stopReason as BetaMessage['stop_reason'],
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, rawInputTokens - cachedInputTokens),
      output_tokens: response.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: cachedInputTokens,
      cache_creation_input_tokens: 0,
      raw_input_tokens: rawInputTokens,
      total_tokens: response.usage?.total_tokens ?? 0,
      reasoning_output_tokens:
        usageDetails?.completion_tokens_details?.reasoning_tokens ?? 0,
      cache_write_input_tokens:
        usageDetails?.prompt_tokens_details?.cache_write_tokens ?? 0,
      usage_complete: response.usage !== undefined,
    },
  } as unknown as BetaMessage
}
