import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getAPIProvider } from '../../src/utils/model/providers.js'

const root = resolve(import.meta.dir, '../..')

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

function fail(message: string): never {
  throw new Error(`[foundry-boundary] ${message}`)
}

const forbidden = [
  /@anthropic-ai\/foundry-sdk/i,
  /@azure\/identity/,
  /AnthropicFoundry/,
  /DefaultAzureCredential/,
  /getBearerTokenProvider/,
  /cognitiveservices\.azure\.com\/\.default/,
  /ANTHROPIC_FOUNDRY_BASE_URL/,
  /ANTHROPIC_FOUNDRY_RESOURCE/,
  /CLAUDE_CODE_SKIP_FOUNDRY_AUTH/,
]

const runtimeBoundaryFiles = [
  'src/services/api/client.ts',
  'src/utils/betas.ts',
  'src/utils/thinking.ts',
  'src/utils/managedEnvConstants.ts',
  'src/utils/model/configs.ts',
  'src/utils/model/deprecation.ts',
  'src/utils/model/model.ts',
  'src/utils/model/providers.ts',
  'src/utils/status.tsx',
  'src/services/langfuse/tracing.ts',
  'src/entrypoints/sdk/coreSchemas.ts',
  'src/cli/print.ts',
  'package.json',
  'bun.lock',
]

for (const path of runtimeBoundaryFiles) {
  const text = await source(path)
  for (const pattern of forbidden) {
    if (pattern.test(text)) fail(`${path} contains ${pattern}`)
  }
  if (/['"]foundry['"]/i.test(text)) {
    fail(`${path} exposes the removed provider name`)
  }
}

const subprocessEnv = await source('src/utils/subprocessEnv.ts')
const legacySecretMatches = subprocessEnv.match(/ANTHROPIC_FOUNDRY_API_KEY/g)
if (legacySecretMatches?.length !== 1) {
  fail('legacy Foundry API key must appear exactly once in subprocess secret filtering')
}

if (getAPIProvider() !== 'openai') {
  fail('runtime provider must remain OpenAI-compatible')
}

console.log('[foundry-boundary] PASS')
