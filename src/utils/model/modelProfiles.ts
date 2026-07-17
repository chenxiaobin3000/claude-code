export type ModelReasoningProfile =
  | { type: 'none' }
  | { type: 'deepseek'; enabledByDefault: boolean }
  | {
      type: 'openai'
      defaultEffort: OpenAIReasoningEffort
      supportedEfforts: readonly OpenAIReasoningEffort[]
    }

export type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type ModelChatCompletionsProfile = {
  outputTokenField: 'max_tokens' | 'max_completion_tokens'
  parallelToolCalls: boolean
  strictToolSchemas: boolean
  temperature: 'supported' | 'unsupported_with_reasoning'
}

export type ModelPromptCacheProfile =
  | { type: 'none' }
  | { type: 'providerManaged'; reportsCachedTokens: boolean }

export type ModelPricing = {
  currency: 'USD'
  perTokens: 1_000_000
  input: number
  output: number
  cacheRead: number | null
  cacheWrite: number | null
}

export type ModelProfile = {
  contextWindowTokens: number
  defaultOutputTokens: number
  maxOutputTokens: number
  reasoning: ModelReasoningProfile
  chatCompletions: ModelChatCompletionsProfile
  promptCache: ModelPromptCacheProfile
  pricing: ModelPricing | null
}

/**
 * The only model capability source of truth.
 *
 * Keys are case-sensitive model IDs from models.json. Do not add aliases,
 * substring matching, or endpoint probing here.
 */
export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  contextWindowTokens: 65_536,
  defaultOutputTokens: 4_096,
  maxOutputTokens: 4_096,
  reasoning: { type: 'none' },
  chatCompletions: {
    outputTokenField: 'max_tokens',
    parallelToolCalls: false,
    strictToolSchemas: false,
    temperature: 'supported',
  },
  promptCache: { type: 'none' },
  pricing: {
    currency: 'USD',
    perTokens: 1_000_000,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
}

export const MODEL_PROFILES = {
  'Qwen3.5-9B-Q6_K': {
    ...DEFAULT_MODEL_PROFILE,
    reasoning: { type: 'none' },
    chatCompletions: { ...DEFAULT_MODEL_PROFILE.chatCompletions },
    promptCache: { type: 'none' },
    pricing: { ...DEFAULT_MODEL_PROFILE.pricing! },
  },
  'deepseek-v4-flash': {
    contextWindowTokens: 1_000_000,
    defaultOutputTokens: 4_096,
    maxOutputTokens: 4_096,
    reasoning: { type: 'deepseek', enabledByDefault: true },
    chatCompletions: {
      outputTokenField: 'max_tokens',
      parallelToolCalls: false,
      strictToolSchemas: false,
      temperature: 'unsupported_with_reasoning',
    },
    promptCache: {
      type: 'providerManaged',
      reportsCachedTokens: true,
    },
    pricing: {
      currency: 'USD',
      perTokens: 1_000_000,
      input: 1,
      output: 2,
      // The repository has no verified cache price for this deployment ID.
      cacheRead: null,
      cacheWrite: null,
    },
  },
} as const satisfies Record<string, ModelProfile>

export type RegisteredModelId = keyof typeof MODEL_PROFILES

export function findModelProfile(model: string): ModelProfile | undefined {
  return (MODEL_PROFILES as Record<string, ModelProfile>)[model]
}

export function getModelProfile(model: string): ModelProfile {
  return findModelProfile(model) ?? DEFAULT_MODEL_PROFILE
}

export function usesDefaultModelProfile(model: string): boolean {
  return findModelProfile(model) === undefined
}

export function getDefaultModelProfileWarning(
  model: string,
): string | undefined {
  if (!usesDefaultModelProfile(model)) return undefined
  return `Warning: model ${JSON.stringify(model)} has no dedicated capability profile; using the default Qwen profile (65,536 context tokens, 4,096 maximum output tokens, no reasoning or prompt cache, zero local pricing). Add a dedicated entry to src/utils/model/modelProfiles.ts for accurate behavior.`
}
