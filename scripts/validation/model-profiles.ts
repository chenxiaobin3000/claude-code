#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  buildOpenAIRequestBody,
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
} from '../../src/services/api/openai/requestBody.js'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from '../../src/utils/context.js'
import {
  MODEL_PROFILES,
  findModelProfile,
  getModelProfile,
} from '../../src/utils/model/modelProfiles.js'
import { calculateUSDCost } from '../../src/utils/modelCost.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(resolve(root, path), 'utf8')

function expectFailure(run: () => unknown, expected: string): void {
  try {
    run()
  } catch (error) {
    assert(error instanceof Error, `${expected}: expected an Error`)
    assert(
      error.message.includes(expected),
      `expected ${JSON.stringify(expected)} in ${JSON.stringify(error.message)}`,
    )
    return
  }
  throw new Error(`expected failure containing ${JSON.stringify(expected)}`)
}

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
expectFailure(
  () => getModelProfile('unknown-model'),
  'Model profile is not registered',
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
  messages: [{ role: 'user', content: 'fixture' }],
  tools: [],
  toolChoice: undefined,
  maxTokens: 4_096,
}
const qwenRequest = buildOpenAIRequestBody({
  ...baseRequest,
  model: 'Qwen3.5-9B-Q6_K',
  enableThinking: isOpenAIThinkingEnabled('Qwen3.5-9B-Q6_K'),
}) as Record<string, unknown>
assertEqual(qwenRequest.thinking, undefined, 'Qwen reasoning fields')

const deepseekRequest = buildOpenAIRequestBody({
  ...baseRequest,
  model: 'deepseek-v4-flash',
  enableThinking: isOpenAIThinkingEnabled('deepseek-v4-flash'),
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

console.log('[model-profiles] PASS')
