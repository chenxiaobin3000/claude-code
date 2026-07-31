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
  toolChoice: 'strings_only' | 'openai_standard'
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

export type ModelProfileOverride = Partial<
  Omit<ModelProfile, 'reasoning' | 'chatCompletions' | 'promptCache' | 'pricing'>
> & {
  reasoning?: Partial<ModelReasoningProfile>
  chatCompletions?: Partial<ModelChatCompletionsProfile>
  promptCache?: Partial<ModelPromptCacheProfile>
  pricing?: Partial<ModelPricing> | null
}

const effectiveProfiles = new Map<string, ModelProfile>()

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
    toolChoice: 'strings_only',
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
      toolChoice: 'openai_standard',
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
  return effectiveProfiles.get(model) ?? findModelProfile(model) ?? DEFAULT_MODEL_PROFILE
}

function profileError(model: string, path: string, message: string): never {
  throw new Error(`model ${JSON.stringify(model)} profile.${path}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertKnownKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  model: string,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) profileError(model, `${path}.${key}`, 'is not supported')
  }
}

function positiveInteger(value: unknown, model: string, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    profileError(model, path, 'must be a positive integer')
  }
  return value as number
}

function nonNegativeNumberOrNull(
  value: unknown,
  model: string,
  path: string,
): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    profileError(model, path, 'must be a non-negative number or null')
  }
  return value
}

function freezeProfile(profile: ModelProfile): ModelProfile {
  return Object.freeze({
    ...profile,
    reasoning: Object.freeze({ ...profile.reasoning }),
    chatCompletions: Object.freeze({ ...profile.chatCompletions }),
    promptCache: Object.freeze({ ...profile.promptCache }),
    pricing: profile.pricing && Object.freeze({ ...profile.pricing }),
  })
}

/** Builds a validated, immutable per-model profile without endpoint probing. */
export function createEffectiveModelProfile(
  model: string,
  override: unknown,
): ModelProfile {
  const base = findModelProfile(model) ?? DEFAULT_MODEL_PROFILE
  if (override === undefined) return freezeProfile(base)
  if (!isRecord(override)) profileError(model, '', 'must be an object')
  assertKnownKeys(
    override,
    [
      'contextWindowTokens',
      'defaultOutputTokens',
      'maxOutputTokens',
      'reasoning',
      'chatCompletions',
      'promptCache',
      'pricing',
    ],
    model,
    '',
  )

  let reasoning: ModelReasoningProfile = base.reasoning
  if (override.reasoning !== undefined) {
    if (!isRecord(override.reasoning)) profileError(model, 'reasoning', 'must be an object')
    assertKnownKeys(override.reasoning, ['type', 'enabledByDefault', 'defaultEffort', 'supportedEfforts'], model, 'reasoning')
    const merged = { ...base.reasoning, ...override.reasoning } as Record<string, unknown>
    if (merged.type === 'none') reasoning = { type: 'none' }
    else if (merged.type === 'deepseek' && typeof merged.enabledByDefault === 'boolean') reasoning = { type: 'deepseek', enabledByDefault: merged.enabledByDefault }
    else if (
      merged.type === 'openai' &&
      typeof merged.defaultEffort === 'string' &&
      Array.isArray(merged.supportedEfforts) &&
      merged.supportedEfforts.every(value =>
        ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
          String(value),
        ),
      ) &&
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
        merged.defaultEffort,
      )
    ) {
      reasoning = { type: 'openai', defaultEffort: merged.defaultEffort as OpenAIReasoningEffort, supportedEfforts: merged.supportedEfforts as OpenAIReasoningEffort[] }
    } else profileError(model, 'reasoning', 'has an invalid type or required fields')
  }

  let chatCompletions = base.chatCompletions
  if (override.chatCompletions !== undefined) {
    if (!isRecord(override.chatCompletions)) profileError(model, 'chatCompletions', 'must be an object')
    assertKnownKeys(override.chatCompletions, ['outputTokenField', 'toolChoice', 'parallelToolCalls', 'strictToolSchemas', 'temperature'], model, 'chatCompletions')
    chatCompletions = { ...base.chatCompletions, ...override.chatCompletions }
  }
  let promptCache = base.promptCache
  if (override.promptCache !== undefined) {
    if (!isRecord(override.promptCache)) profileError(model, 'promptCache', 'must be an object')
    assertKnownKeys(override.promptCache, ['type', 'reportsCachedTokens'], model, 'promptCache')
    const merged = { ...base.promptCache, ...override.promptCache } as Record<string, unknown>
    if (merged.type === 'none') promptCache = { type: 'none' }
    else if (merged.type === 'providerManaged' && typeof merged.reportsCachedTokens === 'boolean') promptCache = { type: 'providerManaged', reportsCachedTokens: merged.reportsCachedTokens }
    else profileError(model, 'promptCache', 'has an invalid type or required fields')
  }
  let pricing = base.pricing
  if (override.pricing !== undefined) {
    if (override.pricing === null) pricing = null
    else {
      if (!isRecord(override.pricing)) profileError(model, 'pricing', 'must be an object or null')
      assertKnownKeys(override.pricing, ['currency', 'perTokens', 'input', 'output', 'cacheRead', 'cacheWrite'], model, 'pricing')
      if (!pricing) profileError(model, 'pricing', 'cannot partially override a profile without pricing')
      pricing = { ...pricing, ...override.pricing } as ModelPricing
    }
  }

  const profile: ModelProfile = {
    contextWindowTokens: override.contextWindowTokens === undefined ? base.contextWindowTokens : positiveInteger(override.contextWindowTokens, model, 'contextWindowTokens'),
    defaultOutputTokens: override.defaultOutputTokens === undefined ? base.defaultOutputTokens : positiveInteger(override.defaultOutputTokens, model, 'defaultOutputTokens'),
    maxOutputTokens: override.maxOutputTokens === undefined ? base.maxOutputTokens : positiveInteger(override.maxOutputTokens, model, 'maxOutputTokens'),
    reasoning,
    chatCompletions,
    promptCache,
    pricing,
  }
  if (profile.defaultOutputTokens > profile.maxOutputTokens || profile.maxOutputTokens >= profile.contextWindowTokens) profileError(model, 'tokens', 'must satisfy defaultOutputTokens <= maxOutputTokens < contextWindowTokens')
  if (!['max_tokens', 'max_completion_tokens'].includes(profile.chatCompletions.outputTokenField)) profileError(model, 'chatCompletions.outputTokenField', 'is invalid')
  if (!['strings_only', 'openai_standard'].includes(profile.chatCompletions.toolChoice)) profileError(model, 'chatCompletions.toolChoice', 'is invalid')
  if (!['supported', 'unsupported_with_reasoning'].includes(profile.chatCompletions.temperature)) profileError(model, 'chatCompletions.temperature', 'is invalid')
  if (profile.pricing) {
    if (profile.pricing.currency !== 'USD' || profile.pricing.perTokens !== 1_000_000) profileError(model, 'pricing', 'must use USD per 1,000,000 tokens')
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) profile.pricing[key] = nonNegativeNumberOrNull(profile.pricing[key], model, `pricing.${key}`) as never
  }
  return freezeProfile(profile)
}

export function setEffectiveModelProfiles(
  profiles: ReadonlyMap<string, ModelProfile>,
): void {
  effectiveProfiles.clear()
  for (const [model, profile] of profiles) effectiveProfiles.set(model, profile)
}

export function usesDefaultModelProfile(model: string): boolean {
  return findModelProfile(model) === undefined
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key)
}

/**
 * Returns whether an external profile explicitly defines every behavioral
 * capability. Pricing is metadata and is intentionally optional.
 *
 * The override has already been validated by createEffectiveModelProfile when
 * this is used while loading models.json, so this function only determines
 * whether any capability still inherits from the default profile.
 */
export function isCompleteModelCapabilityProfile(override: unknown): boolean {
  if (!isRecord(override)) return false
  if (
    !hasOwn(override, 'contextWindowTokens') ||
    !hasOwn(override, 'defaultOutputTokens') ||
    !hasOwn(override, 'maxOutputTokens') ||
    !isRecord(override.reasoning) ||
    !isRecord(override.chatCompletions) ||
    !isRecord(override.promptCache)
  ) {
    return false
  }

  const reasoning = override.reasoning
  const reasoningComplete =
    reasoning.type === 'none' ||
    (reasoning.type === 'deepseek' && hasOwn(reasoning, 'enabledByDefault')) ||
    (reasoning.type === 'openai' &&
      hasOwn(reasoning, 'defaultEffort') &&
      hasOwn(reasoning, 'supportedEfforts'))
  if (!reasoningComplete) return false

  const chatCompletions = override.chatCompletions
  if (
    !hasOwn(chatCompletions, 'outputTokenField') ||
    !hasOwn(chatCompletions, 'toolChoice') ||
    !hasOwn(chatCompletions, 'parallelToolCalls') ||
    !hasOwn(chatCompletions, 'strictToolSchemas') ||
    !hasOwn(chatCompletions, 'temperature')
  ) {
    return false
  }

  const promptCache = override.promptCache
  return (
    promptCache.type === 'none' ||
    (promptCache.type === 'providerManaged' &&
      hasOwn(promptCache, 'reportsCachedTokens'))
  )
}

export function getDefaultModelProfileWarning(
  model: string,
  override?: unknown,
): string | undefined {
  if (
    !usesDefaultModelProfile(model) ||
    isCompleteModelCapabilityProfile(override)
  ) {
    return undefined
  }
  return `Warning: model ${JSON.stringify(model)} has no dedicated capability profile; using the default Qwen profile (65,536 context tokens, 4,096 maximum output tokens, no reasoning or prompt cache, zero local pricing). Add a dedicated entry to src/utils/model/modelProfiles.ts for accurate behavior.`
}
