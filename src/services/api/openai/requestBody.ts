/**
 * Pure utility functions for building OpenAI request bodies and detecting
 * thinking mode. Extracted from index.ts so tests can import them without
 * triggering heavy module side-effects (OpenAI client, stream adapter, etc.).
 */
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.mjs'
import { getModelProfile } from '../../../utils/model/modelProfiles.js'

/**
 * Detect whether thinking mode should be enabled for this model.
 *
 * This is an exact model-profile lookup. Environment overrides and model-name
 * inference are intentionally not supported.
 */
export function isOpenAIThinkingEnabled(model: string): boolean {
  const reasoning = getModelProfile(model).reasoning
  return reasoning.type !== 'none' && reasoning.enabledByDefault
}

/**
 * Resolve max output tokens for the OpenAI-compatible path.
 *
 * Override priority:
 * Overrides may lower the static model default, but can never expand the
 * hardcoded model capability.
 */
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

/**
 * Build the request body for OpenAI chat.completions.create().
 * Extracted for testability — the thinking mode params are injected here.
 *
 * Reasoning fields are selected only from the exact static model profile.
 */
export function buildOpenAIRequestBody(params: {
  model: string
  messages: any[]
  tools: any[]
  toolChoice: any
  enableThinking: boolean
  maxTokens: number
  temperatureOverride?: number
}): ChatCompletionCreateParamsStreaming & {
  thinking?: { type: string }
} {
  const {
    model,
    messages,
    tools,
    toolChoice,
    enableThinking,
    maxTokens,
    temperatureOverride,
  } = params
  const reasoning = getModelProfile(model).reasoning
  return {
    model,
    messages,
    max_tokens: maxTokens,
    ...(tools.length > 0 && {
      tools,
      ...(toolChoice && { tool_choice: toolChoice }),
    }),
    stream: true,
    stream_options: { include_usage: true },
    ...(enableThinking &&
      reasoning.type === 'deepseek' && {
        thinking: { type: 'enabled' },
      }),
    ...(!enableThinking &&
      temperatureOverride !== undefined && {
        temperature: temperatureOverride,
      }),
  }
}
