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

const effectiveProfiles = new Map<string, ModelProfile>()

export function getModelProfile(model: string): ModelProfile {
  const profile = effectiveProfiles.get(model)
  if (!profile) {
    throw new Error(
      `model ${JSON.stringify(model)} has no loaded capability profile`,
    )
  }
  return profile
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
    if (!keys.includes(key))
      profileError(model, `${path}.${key}`, 'is not supported')
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
  value: unknown,
): ModelProfile {
  if (!isRecord(value)) profileError(model, '', 'must be an object')
  const override = value
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

  for (const key of [
    'contextWindowTokens',
    'defaultOutputTokens',
    'maxOutputTokens',
    'reasoning',
    'chatCompletions',
    'promptCache',
  ]) {
    if (!Object.hasOwn(override, key)) profileError(model, key, 'is required')
  }

  if (!isRecord(override.reasoning))
    profileError(model, 'reasoning', 'must be an object')
  assertKnownKeys(
    override.reasoning,
    ['type', 'enabledByDefault', 'defaultEffort', 'supportedEfforts'],
    model,
    'reasoning',
  )
  let reasoning: ModelReasoningProfile
  if (override.reasoning.type === 'none') reasoning = { type: 'none' }
  else if (
    override.reasoning.type === 'deepseek' &&
    typeof override.reasoning.enabledByDefault === 'boolean'
  ) {
    reasoning = {
      type: 'deepseek',
      enabledByDefault: override.reasoning.enabledByDefault,
    }
  } else if (
    override.reasoning.type === 'openai' &&
    typeof override.reasoning.defaultEffort === 'string' &&
    Array.isArray(override.reasoning.supportedEfforts) &&
    override.reasoning.supportedEfforts.every(value =>
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
        String(value),
      ),
    ) &&
    ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
      override.reasoning.defaultEffort,
    )
  ) {
    reasoning = {
      type: 'openai',
      defaultEffort: override.reasoning.defaultEffort as OpenAIReasoningEffort,
      supportedEfforts: override.reasoning
        .supportedEfforts as OpenAIReasoningEffort[],
    }
  } else
    profileError(model, 'reasoning', 'has an invalid type or required fields')

  if (!isRecord(override.chatCompletions))
    profileError(model, 'chatCompletions', 'must be an object')
  assertKnownKeys(
    override.chatCompletions,
    [
      'outputTokenField',
      'toolChoice',
      'parallelToolCalls',
      'strictToolSchemas',
      'temperature',
    ],
    model,
    'chatCompletions',
  )
  for (const key of [
    'outputTokenField',
    'toolChoice',
    'parallelToolCalls',
    'strictToolSchemas',
    'temperature',
  ]) {
    if (!Object.hasOwn(override.chatCompletions, key))
      profileError(model, `chatCompletions.${key}`, 'is required')
  }
  const chatCompletions = {
    ...override.chatCompletions,
  } as ModelChatCompletionsProfile
  if (typeof chatCompletions.parallelToolCalls !== 'boolean')
    profileError(
      model,
      'chatCompletions.parallelToolCalls',
      'must be a boolean',
    )
  if (typeof chatCompletions.strictToolSchemas !== 'boolean')
    profileError(
      model,
      'chatCompletions.strictToolSchemas',
      'must be a boolean',
    )

  if (!isRecord(override.promptCache))
    profileError(model, 'promptCache', 'must be an object')
  assertKnownKeys(
    override.promptCache,
    ['type', 'reportsCachedTokens'],
    model,
    'promptCache',
  )
  let promptCache: ModelPromptCacheProfile
  if (override.promptCache.type === 'none') promptCache = { type: 'none' }
  else if (
    override.promptCache.type === 'providerManaged' &&
    typeof override.promptCache.reportsCachedTokens === 'boolean'
  ) {
    promptCache = {
      type: 'providerManaged',
      reportsCachedTokens: override.promptCache.reportsCachedTokens,
    }
  } else
    profileError(model, 'promptCache', 'has an invalid type or required fields')

  let pricing: ModelPricing | null = null
  if (override.pricing !== undefined) {
    if (override.pricing === null) pricing = null
    else {
      if (!isRecord(override.pricing))
        profileError(model, 'pricing', 'must be an object or null')
      assertKnownKeys(
        override.pricing,
        ['currency', 'perTokens', 'input', 'output', 'cacheRead', 'cacheWrite'],
        model,
        'pricing',
      )
      for (const key of [
        'currency',
        'perTokens',
        'input',
        'output',
        'cacheRead',
        'cacheWrite',
      ]) {
        if (!Object.hasOwn(override.pricing, key))
          profileError(model, `pricing.${key}`, 'is required')
      }
      pricing = { ...override.pricing } as ModelPricing
    }
  }

  const profile: ModelProfile = {
    contextWindowTokens: positiveInteger(
      override.contextWindowTokens,
      model,
      'contextWindowTokens',
    ),
    defaultOutputTokens: positiveInteger(
      override.defaultOutputTokens,
      model,
      'defaultOutputTokens',
    ),
    maxOutputTokens: positiveInteger(
      override.maxOutputTokens,
      model,
      'maxOutputTokens',
    ),
    reasoning,
    chatCompletions,
    promptCache,
    pricing,
  }
  if (
    profile.defaultOutputTokens > profile.maxOutputTokens ||
    profile.maxOutputTokens >= profile.contextWindowTokens
  )
    profileError(
      model,
      'tokens',
      'must satisfy defaultOutputTokens <= maxOutputTokens < contextWindowTokens',
    )
  if (
    !['max_tokens', 'max_completion_tokens'].includes(
      profile.chatCompletions.outputTokenField,
    )
  )
    profileError(model, 'chatCompletions.outputTokenField', 'is invalid')
  if (
    !['strings_only', 'openai_standard'].includes(
      profile.chatCompletions.toolChoice,
    )
  )
    profileError(model, 'chatCompletions.toolChoice', 'is invalid')
  if (
    !['supported', 'unsupported_with_reasoning'].includes(
      profile.chatCompletions.temperature,
    )
  )
    profileError(model, 'chatCompletions.temperature', 'is invalid')
  if (profile.pricing) {
    if (
      profile.pricing.currency !== 'USD' ||
      profile.pricing.perTokens !== 1_000_000
    )
      profileError(model, 'pricing', 'must use USD per 1,000,000 tokens')
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const)
      profile.pricing[key] = nonNegativeNumberOrNull(
        profile.pricing[key],
        model,
        `pricing.${key}`,
      ) as never
  }
  return freezeProfile(profile)
}

export function setEffectiveModelProfiles(
  profiles: ReadonlyMap<string, ModelProfile>,
): void {
  effectiveProfiles.clear()
  for (const [model, profile] of profiles) effectiveProfiles.set(model, profile)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key)
}

/**
 * Returns whether an external profile explicitly defines every behavioral
 * capability. Pricing is metadata and is intentionally optional.
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
