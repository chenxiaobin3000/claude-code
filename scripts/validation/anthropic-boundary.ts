import { access, readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function fail(message: string): never {
  throw new Error(`[anthropic-boundary] ${message}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(root, path))
    return true
  } catch {
    return false
  }
}

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
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

const removedPaths = [
  'src/utils/auth.ts',
  'src/utils/authFileDescriptor.ts',
  'src/daemon/workerRegistry.ts',
  'src/utils/remoteTriggerAudit.ts',
  'src/services/mcp/claudeai.ts',
  'src/services/mcp/officialRegistry.ts',
  'packages/@ant/claude-for-chrome-mcp/src/bridgeClient.ts',
  'packages/workflow-engine/examples/research-report/README.md',
]
for (const path of removedPaths) {
  if (await exists(path)) fail(`removed cloud path was restored: ${path}`)
}

const forbiddenPatterns = [
  /api\.anthropic\.com/i,
  /console\.anthropic\.com/i,
  /claudeusercontent\.com/i,
  /claude\.ai\/api/i,
  /ANTHROPIC_API_KEY/,
  /ANTHROPIC_AUTH_TOKEN/,
  /ANTHROPIC_BASE_URL/,
  /CLAUDE_CODE_OAUTH/,
  /getClaudeAIOAuthTokens/,
  /getAnthropicApiKey/,
  /getOauthAccountInfo/,
  /claudeai-proxy/,
]
for (const path of [...(await sourceFiles('src')), ...(await sourceFiles('packages'))]) {
  const text = await source(path)
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) fail(`${path} contains forbidden cloud boundary ${pattern}`)
  }
}

const providers = await source('src/utils/model/providers.ts')
if (!/getAPIProvider\(\): APIProvider \{\s*return 'openai'\s*\}/s.test(providers)) {
  fail('runtime provider must remain OpenAI-compatible')
}

const modelQuery = await source('src/services/model/query.ts')
if (!/yield\* queryModelOpenAI\(request, signal\)/.test(modelQuery)) {
  fail('model dispatcher must delegate to the OpenAI implementation')
}

const rcsAuth = await source('src/utils/sessionIngressAuth.ts')
if (!rcsAuth.includes('CLAUDE_CODE_RCS_AUTH_TOKEN')) {
  fail('self-hosted RCS must use an explicit operator-provided token')
}
for (const pattern of [
  /sessionKey=/,
  /X-Organization-Uuid/,
  /FILE_DESCRIPTOR/,
  /SESSION_ACCESS_TOKEN/,
]) {
  if (pattern.test(rcsAuth)) fail(`self-hosted RCS auth contains ${pattern}`)
}

for (const dir of [
  'packages/remote-control-server',
  'packages/acp-link',
  'src/services/acp',
]) {
  for (const path of await sourceFiles(dir)) {
    const text = await source(path)
    for (const pattern of [
      /api\.anthropic\.com/i,
      /claude\.ai/i,
      /claudeusercontent\.com/i,
      /CLAUDE_CODE_OAUTH/,
      /ANTHROPIC_AUTH_TOKEN/,
      /ANTHROPIC_API_KEY/,
    ]) {
      if (pattern.test(text)) fail(`${path} violates self-host boundary ${pattern}`)
    }
  }
}

console.log('[anthropic-boundary] PASS')
