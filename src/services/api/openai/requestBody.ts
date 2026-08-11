import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions/completions.mjs'
import type { EffortValue } from '../../../utils/effort.js'
import {
  getModelProfile,
  type ModelProfile,
  type OpenAIReasoningEffort,
} from '../../../utils/model/modelProfiles.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'

export type OpenAICompatibleRequestExtension = {
  thinking?: { type: 'enabled' | 'disabled' }
}

type CommonRequestParams = {
  model: string
  messages: ChatCompletionMessageParam[]
  tools: ChatCompletionTool[]
  toolChoice?: ChatCompletionToolChoiceOption
  endpoint?: string
  querySource?: string
  thinkingConfig?: ThinkingConfig
  effortValue?: EffortValue
  maxTokens: number
  temperatureOverride?: number
}

function resolveReasoningEffort(
  profile: ModelProfile,
  thinkingConfig?: ThinkingConfig,
  effortValue?: EffortValue,
): OpenAIReasoningEffort | undefined {
  if (profile.reasoning.type !== 'openai') return undefined
  if (thinkingConfig?.type === 'disabled') {
    return profile.reasoning.supportedEfforts.includes('none')
      ? 'none'
      : undefined
  }

  const requested =
    typeof effortValue === 'string'
      ? effortValue
      : typeof effortValue === 'number'
        ? 'high'
        : profile.reasoning.defaultEffort
  if (!profile.reasoning.supportedEfforts.includes(requested)) {
    throw new Error(
      `Reasoning effort ${JSON.stringify(requested)} is not supported by the configured model profile`,
    )
  }
  return requested
}

export function isOpenAIThinkingEnabled(
  model: string,
  thinkingConfig?: ThinkingConfig,
  effortValue?: EffortValue,
): boolean {
  const profile = getModelProfile(model)
  if (profile.reasoning.type === 'none') return false
  if (thinkingConfig?.type === 'disabled') return false
  if (profile.reasoning.type === 'deepseek') {
    return thinkingConfig !== undefined
      ? true
      : profile.reasoning.enabledByDefault
  }
  return resolveReasoningEffort(profile, thinkingConfig, effortValue) !== 'none'
}

export function resolveOpenAIMaxTokens(
  model: string,
  maxOutputTokensOverride?: number,
): number {
  const profile = getModelProfile(model)
  const requested =
    maxOutputTokensOverride ??
    (process.env.OPENAI_MAX_TOKENS
      ? parseInt(process.env.OPENAI_MAX_TOKENS, 10) || undefined
      : undefined) ??
    (process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
      ? parseInt(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, 10) || undefined
      : undefined) ??
    profile.defaultOutputTokens

  if (!Number.isInteger(requested) || requested <= 0) {
    throw new Error(`Invalid max output token limit for model ${model}`)
  }
  return Math.min(requested, profile.maxOutputTokens)
}

function buildCommonRequestBody(
  params: CommonRequestParams,
  profile: ModelProfile = getModelProfile(params.model),
): Record<string, unknown> {
  let toolChoice = params.toolChoice
  if (
    toolChoice !== undefined &&
    typeof toolChoice !== 'string' &&
    profile.chatCompletions.toolChoice === 'strings_only'
  ) {
    const requestedName =
      toolChoice.type === 'function' &&
      typeof toolChoice.function?.name === 'string'
        ? toolChoice.function.name
        : undefined
    const onlyTool = params.tools.length === 1 ? params.tools[0] : undefined
    if (
      requestedName !== undefined &&
      onlyTool?.type === 'function' &&
      onlyTool.function.name === requestedName
    ) {
      // With one matching candidate, OpenAI's string "required" has the same
      // observable result as selecting that function by name. This keeps
      // strings-only llama.cpp endpoints strict without guessing by model ID.
      toolChoice = 'required'
    } else {
      let endpoint = 'the configured endpoint'
      if (params.endpoint) {
        try {
          const url = new URL(params.endpoint)
          endpoint = url.origin
        } catch {
          // The registry validates endpoints separately; never expose a raw URL here.
        }
      }
      const source = params.querySource ? ` for ${params.querySource}` : ''
      throw new Error(
        `OpenAI compatibility error: model ${params.model} at ${endpoint} only supports string tool_choice values; a named-tool object was required${source}, but the active tool set was not exactly one matching function. Use an endpoint with OpenAI-standard tool_choice support, or explicitly set profile.chatCompletions.toolChoice to "openai_standard" only after confirming that support.`,
      )
    }
  }
  const reasoningEffort = resolveReasoningEffort(
    profile,
    params.thinkingConfig,
    params.effortValue,
  )
  const thinkingEnabled =
    profile.reasoning.type === 'none'
      ? false
      : params.thinkingConfig?.type === 'disabled'
        ? false
        : profile.reasoning.type === 'deepseek'
          ? (params.thinkingConfig !== undefined ||
            profile.reasoning.enabledByDefault)
          : reasoningEffort !== 'none'

  if (
    thinkingEnabled &&
    params.temperatureOverride !== undefined &&
    profile.chatCompletions.temperature === 'unsupported_with_reasoning'
  ) {
    throw new Error(
      `Temperature cannot be combined with reasoning for model ${params.model}`,
    )
  }

  return {
    model: params.model,
    messages: params.messages,
    [profile.chatCompletions.outputTokenField]: params.maxTokens,
    ...(params.tools.length > 0 && {
      tools: params.tools,
      ...(toolChoice !== undefined && {
        tool_choice: toolChoice,
      }),
      parallel_tool_calls: profile.chatCompletions.parallelToolCalls,
    }),
    ...(profile.reasoning.type === 'deepseek' && {
      thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
    }),
    ...(profile.reasoning.type === 'openai' &&
      reasoningEffort !== undefined && {
        reasoning_effort: reasoningEffort,
      }),
    ...(params.temperatureOverride !== undefined && {
      temperature: params.temperatureOverride,
    }),
  }
}

export function buildOpenAIRequestBody(
  params: CommonRequestParams,
): ChatCompletionCreateParamsStreaming & OpenAICompatibleRequestExtension {
  return {
    ...buildCommonRequestBody(params),
    stream: true,
    stream_options: { include_usage: true },
  } as ChatCompletionCreateParamsStreaming & OpenAICompatibleRequestExtension
}

export function buildOpenAINonStreamingRequestBody(
  params: CommonRequestParams,
): ChatCompletionCreateParamsNonStreaming & OpenAICompatibleRequestExtension {
  return buildCommonRequestBody(params) as unknown as ChatCompletionCreateParamsNonStreaming &
    OpenAICompatibleRequestExtension
}

/** Validation-only entry point for exercising an unregistered exact profile. */
export function buildOpenAIRequestBodyForProfile(
  params: CommonRequestParams,
  profile: ModelProfile,
): Record<string, unknown> {
  return {
    ...buildCommonRequestBody(params, profile),
    stream: true,
    stream_options: { include_usage: true },
  }
}
