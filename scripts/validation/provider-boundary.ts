import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(join(root, path), 'utf8')

function requirePattern(path: string, text: string, pattern: RegExp): void {
  if (!pattern.test(text)) {
    throw new Error(`[provider-boundary] ${path} is missing ${pattern}`)
  }
}

function rejectPattern(path: string, text: string, pattern: RegExp): void {
  if (pattern.test(text)) {
    throw new Error(`[provider-boundary] ${path} contains forbidden ${pattern}`)
  }
}

const claudePath = 'src/services/api/claude.ts'
const claude = await source(claudePath)
for (const forbidden of [
  /getAPIProvider\s*\(/,
  /queryModelOpenAI/,
  /from ['"]openai['"]/,
  /services\/api\/openai/,
  /getAnthropicClient/,
  /anthropic\.beta\.messages/,
  /executeNonStreamingRequest/,
  /withRetry/,
  /CACHE_EDITING_BETA_HEADER/,
  /TASK_BUDGETS_BETA_HEADER/,
  /\bfunction\b/,
]) {
  rejectPattern(claudePath, claude, forbidden)
}
requirePattern(claudePath, claude, /from ['"]\.\.\/model\/query\.js['"]/)
requirePattern(claudePath, claude, /from ['"]\.\.\/model\/queryHelpers\.js['"]/)
if (claude.length > 1_500) {
  throw new Error('[provider-boundary] claude.ts must remain a thin facade')
}

const queryPath = 'src/services/model/query.ts'
const query = await source(queryPath)
requirePattern(queryPath, query, /prepareTools\s*\(/)
requirePattern(queryPath, query, /prepareMessages\s*\(/)
requirePattern(queryPath, query, /stripExcessMediaItems\s*\(/)
requirePattern(queryPath, query, /queryPreparedModel\s*\(/)
for (const forbidden of [
  /getAnthropicClient/,
  /anthropic\.beta\.messages/,
  /getAPIProvider\s*\(/,
  /firstParty/,
]) {
  rejectPattern(queryPath, query, forbidden)
}

const openaiPath = 'src/services/api/openai/index.ts'
const openai = await source(openaiPath)
for (const forbidden of [
  /from ['"].*api\/claude/,
  /normalizeMessagesForAPI\s*\(/,
  /toolToAPISchema\s*\(/,
  /getOpenAIClient\s*\(/,
  /adaptOpenAIStreamToAnthropic\s*\(/,
]) {
  rejectPattern(openaiPath, openai, forbidden)
}
requirePattern(openaiPath, openai, /openAIProvider\.createStream\s*\(/)
requirePattern(openaiPath, openai, /processModelStream\s*\(/)

const providerPath = 'src/services/model/providers/openaiProvider.ts'
const provider = await source(providerPath)
for (const required of [
  /id:\s*['"]openai['"]/,
  /getOpenAIClient\s*\(/,
  /anthropicMessagesToOpenAI\s*\(/,
  /anthropicToolsToOpenAI\s*\(/,
  /adaptOpenAIStreamToAnthropic\s*\(/,
]) {
  requirePattern(providerPath, provider, required)
}

const preparePath = 'src/services/model/prepareRequest.ts'
const prepare = await source(preparePath)
requirePattern(preparePath, prepare, /normalizeMessagesForAPI\s*\(/)
requirePattern(preparePath, prepare, /toolToAPISchema\s*\(/)

const streamPath = 'src/services/model/streamProcessor.ts'
const stream = await source(streamPath)
requirePattern(streamPath, stream, /processModelStream/)
requirePattern(streamPath, stream, /mergeUsage\s*\(/)

const usagePath = 'src/services/model/usage.ts'
const usage = await source(usagePath)
requirePattern(usagePath, usage, /export function mergeUsage\s*\(/)
requirePattern(usagePath, usage, /export function accumulateUsage\s*\(/)

console.log('[provider-boundary] PASS')
