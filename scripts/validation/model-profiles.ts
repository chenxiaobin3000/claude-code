#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  buildOpenAIRequestBody,
  buildOpenAIRequestBodyForProfile,
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
} from '../../src/services/api/openai/requestBody.js'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from '../../src/utils/context.js'
import {
  DEFAULT_MODEL_PROFILE,
  MODEL_PROFILES,
  findModelProfile,
  getDefaultModelProfileWarning,
  getModelProfile,
  usesDefaultModelProfile,
  type ModelProfile,
} from '../../src/utils/model/modelProfiles.js'
import { calculateUSDCost } from '../../src/utils/modelCost.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(resolve(root, path), 'utf8')

assertDeepEqual(
  Object.keys(MODEL_PROFILES),
  ['Qwen3.5-9B-Q6_K', 'deepseek-v4-flash'],
  'registered model IDs',
)

for (const [model, profile] of Object.entries(MODEL_PROFILES)) {
  assert(
    Number.isInteger(profile.contextWindowTokens) &&
      profile.contextWindowTokens > 0,
    `${model} context window`,
  )
  assert(
    Number.isInteger(profile.defaultOutputTokens) &&
      profile.defaultOutputTokens > 0,
    `${model} default output`,
  )
  assert(
    profile.defaultOutputTokens <= profile.maxOutputTokens &&
      profile.maxOutputTokens < profile.contextWindowTokens,
    `${model} output limits`,
  )
  if (profile.pricing) {
    for (const value of [
      profile.pricing.input,
      profile.pricing.output,
      profile.pricing.cacheRead,
      profile.pricing.cacheWrite,
    ]) {
      assert(
        value === null || value >= 0,
        `${model} pricing must be non-negative`,
      )
    }
  }
}

assertEqual(
  findModelProfile('qwen3.5-9b-q6_k'),
  undefined,
  'model profile matching must be case-sensitive',
)
assertEqual(
  usesDefaultModelProfile('gemma-new-model'),
  true,
  'unknown model default marker',
)
assertDeepEqual(
  getModelProfile('gemma-new-model'),
  DEFAULT_MODEL_PROFILE,
  'unknown model fallback profile',
)
assert(
  getDefaultModelProfileWarning('gemma-new-model')?.includes(
    'using the default Qwen profile',
  ),
  'unknown model warning',
)
assertEqual(
  getDefaultModelProfileWarning('Qwen3.5-9B-Q6_K'),
  undefined,
  'dedicated profile warning',
)
assertEqual(
  getContextWindowForModel('gemma-new-model'),
  65_536,
  'unknown model default context',
)
assertDeepEqual(
  getModelMaxOutputTokens('gemma-new-model'),
  { default: 4_096, upperLimit: 4_096 },
  'unknown model default output limits',
)

assertEqual(
  getContextWindowForModel('Qwen3.5-9B-Q6_K'),
  65_536,
  'Qwen context window',
)
assertEqual(
  getContextWindowForModel('deepseek-v4-flash'),
  1_000_000,
  'DeepSeek context window',
)
assertDeepEqual(
  getModelMaxOutputTokens('Qwen3.5-9B-Q6_K'),
  { default: 4_096, upperLimit: 4_096 },
  'Qwen output limits',
)
assertEqual(
  resolveOpenAIMaxTokens('Qwen3.5-9B-Q6_K', 2_048),
  2_048,
  'lower operational output cap',
)
assertEqual(
  resolveOpenAIMaxTokens('Qwen3.5-9B-Q6_K', 8_192),
  4_096,
  'profile output cap',
)

const baseRequest = {
  messages: [{ role: 'user' as const, content: 'fixture' }],
  tools: [],
  toolChoice: undefined,
  maxTokens: 4_096,
}
const qwenRequest = buildOpenAIRequestBody({
  ...baseRequest,
  model: 'Qwen3.5-9B-Q6_K',
}) as Record<string, unknown>
assertEqual(qwenRequest.thinking, undefined, 'Qwen reasoning fields')
assertEqual(qwenRequest.max_tokens, 4_096, 'Qwen output token field')
assertEqual(
  qwenRequest.max_completion_tokens,
  undefined,
  'Qwen must not send OpenAI reasoning output field',
)

const deepseekRequest = buildOpenAIRequestBody({
  ...baseRequest,
  model: 'deepseek-v4-flash',
}) as Record<string, unknown>
assertDeepEqual(
  deepseekRequest.thinking,
  { type: 'enabled' },
  'DeepSeek reasoning fields',
)
assertEqual(
  deepseekRequest.enable_thinking,
  undefined,
  'unsupported reasoning field',
)
assertEqual(
  deepseekRequest.chat_template_kwargs,
  undefined,
  'unsupported chat template field',
)
const deepseekDisabled = buildOpenAIRequestBody({
  ...baseRequest,
  model: 'deepseek-v4-flash',
  thinkingConfig: { type: 'disabled' },
}) as Record<string, unknown>
assertEqual(
  deepseekDisabled.thinking,
  undefined,
  'disabled DeepSeek reasoning',
)

const openAIReasoningProfile: ModelProfile = {
  ...DEFAULT_MODEL_PROFILE,
  reasoning: {
    type: 'openai',
    defaultEffort: 'medium',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
  },
  chatCompletions: {
    outputTokenField: 'max_completion_tokens',
    parallelToolCalls: true,
    strictToolSchemas: false,
    temperature: 'unsupported_with_reasoning',
  },
}
const openAIReasoningRequest = buildOpenAIRequestBodyForProfile(
  {
    ...baseRequest,
    model: 'fixture-openai-reasoning',
    tools: [
      {
        type: 'function',
        function: {
          name: 'Fixture',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
    toolChoice: 'required',
    effortValue: 'high',
  },
  openAIReasoningProfile,
)
assertEqual(
  openAIReasoningRequest.max_completion_tokens,
  4_096,
  'OpenAI reasoning output token field',
)
assertEqual(
  openAIReasoningRequest.max_tokens,
  undefined,
  'OpenAI reasoning deprecated output field',
)
assertEqual(
  openAIReasoningRequest.reasoning_effort,
  'high',
  'OpenAI reasoning effort',
)
assertEqual(
  openAIReasoningRequest.parallel_tool_calls,
  true,
  'explicit parallel tool policy',
)
assertEqual(
  openAIReasoningProfile.chatCompletions.strictToolSchemas,
  false,
  'strict tool schema policy',
)

for (const [label, build] of [
  [
    'reasoning temperature conflict',
    () =>
      buildOpenAIRequestBodyForProfile(
        {
          ...baseRequest,
          model: 'fixture-openai-reasoning',
          temperatureOverride: 0,
        },
        openAIReasoningProfile,
      ),
  ],
  [
    'unsupported reasoning effort',
    () =>
      buildOpenAIRequestBodyForProfile(
        {
          ...baseRequest,
          model: 'fixture-openai-reasoning',
          effortValue: 'xhigh',
        },
        openAIReasoningProfile,
      ),
  ],
] as const) {
  try {
    build()
  } catch {
    continue
  }
  throw new Error(`${label} was accepted`)
}

const usage = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
} as BetaUsage
assertEqual(
  calculateUSDCost('deepseek-v4-flash', usage),
  3,
  'DeepSeek input/output price',
)
assertEqual(calculateUSDCost('Qwen3.5-9B-Q6_K', usage), 0, 'local model price')
assertDeepEqual(
  getModelProfile('deepseek-v4-flash').promptCache,
  { type: 'providerManaged', reportsCachedTokens: true },
  'DeepSeek prompt cache mode',
)
assertEqual(
  getModelProfile('deepseek-v4-flash').pricing?.cacheRead,
  null,
  'unverified cache price must remain unknown',
)

const example = JSON.parse(await source('models.example.json')) as {
  defaultModel: string
  models: Array<{ model: string }>
}
for (const entry of example.models) {
  assert(
    findModelProfile(entry.model),
    `example model ${entry.model} needs a profile`,
  )
}
assert(
  example.models.some(entry => entry.model === example.defaultModel),
  'example default model must exist',
)

assert(
  !existsSync(resolve(root, 'src/utils/model/modelCapabilities.ts')),
  'dynamic model capability module must stay removed',
)
const deferredServices = await source(
  'src/cli/initialization/deferredServices.ts',
)
assert(
  !deferredServices.includes('refreshModelCapabilities'),
  'startup must not probe model capabilities',
)
const requestBody = await source('src/services/api/openai/requestBody.ts')
for (const forbidden of ["includes('deepseek')", "includes('mimo')"]) {
  assert(!requestBody.includes(forbidden), `request body contains ${forbidden}`)
}
const context = await source('src/utils/context.ts')
for (const forbidden of ['getModelCapability', 'getCanonicalName']) {
  assert(!context.includes(forbidden), `context contains ${forbidden}`)
}
const registry = await source('src/utils/model/modelRegistry.ts')
assert(
  registry.includes('getDefaultModelProfileWarning'),
  'registry must warn when the default profile is used',
)

console.log('[model-profiles] PASS')
