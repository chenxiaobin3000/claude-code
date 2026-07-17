export type ModelReasoningProfile =
  | { type: 'none' }
  | { type: 'deepseek'; enabledByDefault: boolean }

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
  promptCache: ModelPromptCacheProfile
  pricing: ModelPricing | null
}

/**
 * The only model capability source of truth.
 *
 * Keys are case-sensitive model IDs from models.json. Do not add aliases,
 * substring matching, endpoint probing, or an unknown-model fallback here.
 */
export const MODEL_PROFILES = {
  'Qwen3.5-9B-Q6_K': {
    contextWindowTokens: 65_536,
    defaultOutputTokens: 4_096,
    maxOutputTokens: 4_096,
    reasoning: { type: 'none' },
    promptCache: { type: 'none' },
    pricing: {
      currency: 'USD',
      perTokens: 1_000_000,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  },
  'deepseek-v4-flash': {
    contextWindowTokens: 1_000_000,
    defaultOutputTokens: 4_096,
    maxOutputTokens: 4_096,
    reasoning: { type: 'deepseek', enabledByDefault: true },
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
  const profile = findModelProfile(model)
  if (!profile) {
    throw new Error(
      `Model profile is not registered for ${JSON.stringify(model)}. Add an exact entry to src/utils/model/modelProfiles.ts.`,
    )
  }
  return profile
}
