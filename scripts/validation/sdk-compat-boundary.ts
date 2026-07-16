import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

function fail(message: string): never {
  throw new Error(`[sdk-compat-boundary] ${message}`)
}

const packageJson = JSON.parse(await source('package.json')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const sdkVersion =
  packageJson.dependencies?.['@anthropic-ai/sdk'] ??
  packageJson.devDependencies?.['@anthropic-ai/sdk']
if (!sdkVersion) {
  fail(
    '@anthropic-ai/sdk must remain available for internal compatibility types',
  )
}

const requiredExports: Record<string, RegExp[]> = {
  'packages/@ant/model-provider/src/shared/openaiConvertMessages.ts': [
    /export function anthropicMessagesToOpenAI\s*\(/,
  ],
  'packages/@ant/model-provider/src/shared/openaiConvertTools.ts': [
    /export function anthropicToolsToOpenAI\s*\(/,
    /export function anthropicToolChoiceToOpenAI\s*\(/,
  ],
  'packages/@ant/model-provider/src/shared/openaiStreamAdapter.ts': [
    /export async function\* adaptOpenAIStreamToAnthropic\s*\(/,
    /BetaRawMessageStreamEvent/,
  ],
  'packages/@ant/model-provider/src/types/usage.ts': [
    /export type NonNullableUsage/,
    /export const EMPTY_USAGE/,
    /cache_creation_input_tokens/,
    /cache_read_input_tokens/,
  ],
}

for (const [path, patterns] of Object.entries(requiredExports)) {
  const text = await source(path)
  for (const pattern of patterns) {
    if (!pattern.test(text)) fail(`${path} is missing ${pattern}`)
  }
}

const packageEntry = await source('packages/@ant/model-provider/src/index.ts')
for (const exportedName of [
  'anthropicMessagesToOpenAI',
  'anthropicToolsToOpenAI',
  'anthropicToolChoiceToOpenAI',
  'adaptOpenAIStreamToAnthropic',
]) {
  if (!packageEntry.includes(exportedName)) {
    fail(`model-provider package must export ${exportedName}`)
  }
}

const openaiMain = await source('src/services/api/openai/index.ts')
for (const call of [
  /openAIProvider\.createStream\s*\(/,
  /processModelStream\s*\(/,
]) {
  if (!call.test(openaiMain)) fail(`OpenAI main path is missing ${call}`)
}

const openaiProvider = await source(
  'src/services/model/providers/openaiProvider.ts',
)
for (const call of [
  /anthropicMessagesToOpenAI\s*\(/,
  /anthropicToolsToOpenAI\s*\(/,
  /adaptOpenAIStreamToAnthropic\s*\(/,
]) {
  if (!call.test(openaiProvider)) fail(`OpenAI provider is missing ${call}`)
}

const sideQuery = await source('src/utils/sideQuery.ts')
for (const call of [
  /anthropicToolsToOpenAI\s*\(/,
  /anthropicToolChoiceToOpenAI\s*\(/,
]) {
  if (!call.test(sideQuery)) fail(`side query path is missing ${call}`)
}

const representativeConsumers: Record<string, RegExp> = {
  'src/utils/messages.ts': /@anthropic-ai\/sdk/,
  'src/Tool.ts': /@anthropic-ai\/sdk/,
  'src/services/tools/StreamingToolExecutor.ts': /@anthropic-ai\/sdk/,
  'src/services/mcp/client.ts': /@anthropic-ai\/sdk/,
  'src/services/compact/compact.ts': /@anthropic-ai\/sdk/,
}
for (const [path, pattern] of Object.entries(representativeConsumers)) {
  if (!pattern.test(await source(path))) {
    fail(`${path} no longer exposes its SDK compatibility boundary`)
  }
}

const legacyClient = await source('src/services/api/client.ts')
if (/new\s+Anthropic\s*\(/.test(legacyClient)) {
  fail('SDK compatibility must not restore the Anthropic model client')
}
if (
  !legacyClient.includes('Anthropic first-party model access has been removed')
) {
  fail('legacy Anthropic client boundary must remain fail-closed')
}

console.log('[sdk-compat-boundary] PASS')
