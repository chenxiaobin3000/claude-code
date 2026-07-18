import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dir, '../..')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const sdkVersion = '0.81.0'

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

function fail(message: string): never {
  throw new Error(`[sdk-compat-boundary] ${message}`)
}

async function sourceFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  async function visit(absolute: string): Promise<void> {
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (sourceExtensions.has(extname(entry.name))) {
        result.push(relative(root, path).replaceAll('\\', '/'))
      }
    }
  }
  await visit(join(root, dir))
  return result
}

const packageJson = JSON.parse(await source('package.json')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const rootSdkVersion =
  packageJson.dependencies?.['@anthropic-ai/sdk'] ??
  packageJson.devDependencies?.['@anthropic-ai/sdk']
if (rootSdkVersion !== sdkVersion) {
  fail(
    `root @anthropic-ai/sdk must be pinned to ${sdkVersion}, received ${rootSdkVersion ?? 'missing'}`,
  )
}

for (const path of [
  'packages/@ant/model-provider/package.json',
  'packages/workflow-engine/package.json',
]) {
  const manifest = JSON.parse(await source(path)) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const version =
    manifest.dependencies?.['@anthropic-ai/sdk'] ??
    manifest.devDependencies?.['@anthropic-ai/sdk']
  if (version !== sdkVersion) {
    fail(`${path} must pin @anthropic-ai/sdk to ${sdkVersion}, received ${version ?? 'missing'}`)
  }
}

// The SDK is a local protocol/type compatibility dependency, not a model
// client. Most imports must be type-only. Only the explicit error-class
// allowlist is retained for local cancellation, normalization, and retry.
const allowedRuntimeImports = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIError',
  'APIUserAbortError',
])
const unexpectedRuntimeImports: string[] = []
for (const path of [...(await sourceFiles('src')), ...(await sourceFiles('packages'))]) {
  const text = await source(path)
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('@anthropic-ai/sdk')
    ) {
      continue
    }
    const clause = statement.importClause
    if (!clause) fail(`${path} contains a side-effect SDK import`)
    if (clause.isTypeOnly) continue
    const runtimeNames: string[] = []
    if (clause.name) runtimeNames.push(`default:${clause.name.text}`)
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        runtimeNames.push(`namespace:${clause.namedBindings.name.text}`)
      } else {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) {
            runtimeNames.push(element.propertyName?.text ?? element.name.text)
          }
        }
      }
    }
    for (const name of runtimeNames) {
      if (!allowedRuntimeImports.has(name)) {
        unexpectedRuntimeImports.push(`${path}:${name}`)
      }
    }
  }
  for (const pattern of [
    /require\s*\(\s*['"]@anthropic-ai\/sdk/,
    /await\s+import\s*\(\s*['"]@anthropic-ai\/sdk/,
    /new\s+Anthropic\s*\(/,
  ]) {
    if (pattern.test(text)) fail(`${path} restores an Anthropic SDK client path: ${pattern}`)
  }
}
if (unexpectedRuntimeImports.length > 0) {
  fail(`non-whitelisted SDK runtime values: ${unexpectedRuntimeImports.join(', ')}`)
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
  'src/utils/messagesRuntime.ts': /@anthropic-ai\/sdk/,
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
