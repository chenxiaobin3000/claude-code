#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
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
  createEffectiveModelProfile,
  getModelProfile,
  isCompleteModelCapabilityProfile,
  setEffectiveModelProfiles,
  type ModelProfile,
} from '../../src/utils/model/modelProfiles.js'
import { calculateUSDCost } from '../../src/utils/modelCost.js'
import { isThinkingEnabledByModelDefault } from '../../src/utils/thinking.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(resolve(root, path), 'utf8')

const completeExternalCapabilityProfile = {
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
}
assertEqual(
  isCompleteModelCapabilityProfile(completeExternalCapabilityProfile),
  true,
  'complete external capability profile without pricing',
)
assertEqual(
  isCompleteModelCapabilityProfile({ contextWindowTokens: 32_768 }),
  false,
  'partial external capability profile',
)

const qwenProfile = createEffectiveModelProfile(
  'Qwen3.5-9B-Q6_K',
  completeExternalCapabilityProfile,
)
const deepseekProfile = createEffectiveModelProfile('deepseek-v4-flash', {
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
  promptCache: { type: 'providerManaged', reportsCachedTokens: true },
  pricing: {
    currency: 'USD',
    perTokens: 1_000_000,
    input: 1,
    output: 2,
    cacheRead: null,
    cacheWrite: null,
  },
})
const installFixtureProfiles = () =>
  setEffectiveModelProfiles(
    new Map([
      ['Qwen3.5-9B-Q6_K', qwenProfile],
      ['deepseek-v4-flash', deepseekProfile],
    ]),
  )
installFixtureProfiles()

try {
  getModelProfile('gemma-new-model')
  throw new Error('model without a loaded profile was accepted')
} catch (error) {
  assert(
    error instanceof Error &&
      error.message.includes('no loaded capability profile'),
    'missing loaded profile must fail clearly',
  )
}

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
const deepseekWithoutThinking = createEffectiveModelProfile(
  'deepseek-v4-flash',
  {
    ...deepseekProfile,
    reasoning: { type: 'deepseek', enabledByDefault: false },
  },
)
assertDeepEqual(
  deepseekWithoutThinking.reasoning,
  { type: 'deepseek', enabledByDefault: false },
  'DeepSeek partial reasoning override',
)
assertEqual(
  isThinkingEnabledByModelDefault('deepseek-v4-flash'),
  true,
  'DeepSeek built-in profile enables thinking by default',
)
setEffectiveModelProfiles(
  new Map([['deepseek-v4-flash', deepseekWithoutThinking]]),
)
assertEqual(
  isThinkingEnabledByModelDefault('deepseek-v4-flash'),
  false,
  'DeepSeek effective profile disables the interactive default thinking state',
)
installFixtureProfiles()
assertDeepEqual(
  (
    buildOpenAIRequestBodyForProfile(
      { ...baseRequest, model: 'deepseek-v4-flash' },
      deepseekWithoutThinking,
    ) as Record<string, unknown>
  ).thinking,
  { type: 'disabled' },
  'DeepSeek profile override explicitly disables provider-default thinking',
)
assertEqual(
  createEffectiveModelProfile('deepseek-v4-flash', {
    ...deepseekProfile,
    pricing: null,
  }).pricing,
  null,
  'explicit null clears nullable pricing',
)
for (const invalidProfile of [
  { maxOutputTokens: 65_536 },
  { chatCompletions: { outputTokenField: 'wrong' } },
  { chatCompletions: { toolChoice: 'wrong' } },
  { pricing: { input: -1 } },
]) {
  try {
    createEffectiveModelProfile('fixture-model', invalidProfile)
  } catch {
    continue
  }
  throw new Error('invalid profile override was accepted')
}

const registryDir = await mkdtemp(join(tmpdir(), 'claude-profile-validation-'))
let clearRegistryCache: (() => void) | undefined
try {
  await writeFile(
    join(registryDir, 'models.json'),
    JSON.stringify({
      defaultModel: 'deepseek-v4-flash',
      models: [
        {
          model: 'deepseek-v4-flash',
          baseUrl: 'https://api.deepseek.com/v1',
          profile: deepseekWithoutThinking,
        },
      ],
    }),
  )
  process.env.CLAUDE_CONFIG_DIR = registryDir
  const registryModule = await import('../../src/utils/model/modelRegistry.js')
  clearRegistryCache = registryModule.clearModelRegistryCache
  registryModule.clearModelRegistryCache()
  const target = registryModule.resolveModelTarget()
  assertEqual(target.model, 'deepseek-v4-flash', 'registry selected DeepSeek')
  assertDeepEqual(
    getModelProfile(target.model).reasoning,
    { type: 'deepseek', enabledByDefault: false },
    'registry installs the effective profile for all consumers',
  )
} finally {
  delete process.env.CLAUDE_CONFIG_DIR
  clearRegistryCache?.()
  await rm(registryDir, { recursive: true, force: true })
}
installFixtureProfiles()
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
assertDeepEqual(
  deepseekDisabled.thinking,
  { type: 'disabled' },
  'disabled DeepSeek reasoning',
)

const openAIReasoningProfile: ModelProfile = {
  ...qwenProfile,
  reasoning: {
    type: 'openai',
    defaultEffort: 'medium',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
  },
  chatCompletions: {
    outputTokenField: 'max_completion_tokens',
    toolChoice: 'openai_standard',
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

const namedToolChoice = {
  type: 'function' as const,
  function: { name: 'Fixture' },
}
for (const [label, profile, shouldThrow] of [
  ['Qwen named tool choice', getModelProfile('Qwen3.5-9B-Q6_K'), true],
  ['OpenAI named tool choice', openAIReasoningProfile, false],
] as const) {
  try {
    const request = buildOpenAIRequestBodyForProfile(
      {
        ...baseRequest,
        model: 'fixture-tool-choice',
        endpoint: 'http://127.0.0.1:8080/v1',
        querySource: 'validation',
        tools: [
          {
            type: 'function',
            function: { name: 'Fixture', parameters: { type: 'object' } },
          },
        ],
        toolChoice: namedToolChoice,
      },
      profile,
    ) as Record<string, unknown>
    if (shouldThrow) throw new Error(`${label} unexpectedly succeeded`)
    assertDeepEqual(
      request.tool_choice,
      namedToolChoice,
      `${label} is preserved`,
    )
  } catch (error) {
    if (!shouldThrow) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (
      !message.includes('only supports string tool_choice') ||
      !message.includes('127.0.0.1:8080')
    ) {
      throw new Error(`${label} returned an unclear error: ${message}`)
    }
  }
}
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
    isCompleteModelCapabilityProfile((entry as { profile?: unknown }).profile),
    `example model ${entry.model} needs a complete profile`,
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
const queryEngine = await source('src/QueryEngine.ts')
assert(
  queryEngine.includes('shouldEnableThinkingByDefault(initialMainLoopModel)'),
  'QueryEngine fallback must honor the selected model Profile default',
)
const context = await source('src/utils/context.ts')
for (const forbidden of ['getModelCapability', 'getCanonicalName']) {
  assert(!context.includes(forbidden), `context contains ${forbidden}`)
}
const registry = await source('src/utils/model/modelRegistry.ts')
assert(
  !registry.includes('getDefaultModelProfileWarning'),
  'registry must not contain default-profile fallback warnings',
)

console.log('[model-profiles] PASS')
