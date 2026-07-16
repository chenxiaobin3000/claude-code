import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getAPIProvider } from '../../src/utils/model/providers.js'

const root = resolve(import.meta.dir, '../..')

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

function fail(message: string): never {
  throw new Error(`[vertex-boundary] ${message}`)
}

const forbidden = [
  /@anthropic-ai\/vertex-sdk/,
  /google-auth-library/,
  /AnthropicVertex/,
  /ANTHROPIC_VERTEX_/,
  /VERTEX_REGION_CLAUDE_/,
  /CLAUDE_CODE_SKIP_VERTEX_AUTH/,
  /CLOUD_ML_REGION/,
  /gcpAuthRefresh/,
  /getVertexRegionForModel/,
  /getDefaultVertexRegion/,
  /refreshGcpCredentialsIfNeeded/,
  /clearGcpCredentialsCache/,
]

const runtimeBoundaryFiles = [
  'src/services/api/client.ts',
  'src/services/api/withRetry.ts',
  'src/services/tokenEstimation.ts',
  'src/constants/betas.ts',
  'src/utils/betas.ts',
  'src/utils/auth.ts',
  'src/utils/envUtils.ts',
  'src/utils/managedEnvConstants.ts',
  'src/utils/settings/types.ts',
  'src/utils/status.tsx',
  'src/components/TrustDialog/utils.ts',
  'src/components/TrustDialog/TrustDialog.tsx',
  'package.json',
  'bun.lock',
]

for (const path of runtimeBoundaryFiles) {
  const text = await source(path)
  for (const pattern of forbidden) {
    if (pattern.test(text)) fail(`${path} contains ${pattern}`)
  }
}

const providers = await source('src/utils/model/providers.ts')
if (/['"]vertex['"]/.test(providers)) {
  fail('APIProvider must not expose Vertex')
}
const configs = await source('src/utils/model/configs.ts')
if (/\bvertex\s*:/.test(configs)) {
  fail('built-in model configuration must not contain Vertex model IDs')
}
const sdkSchemas = await source('src/entrypoints/sdk/coreSchemas.ts')
if (/\.enum\([^\n]*['"]vertex['"]/.test(sdkSchemas)) {
  fail('SDK provider schema must not expose Vertex')
}
if (getAPIProvider() !== 'openai') {
  fail('runtime provider must remain OpenAI-compatible')
}

console.log('[vertex-boundary] PASS')
