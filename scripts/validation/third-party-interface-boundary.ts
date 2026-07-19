#!/usr/bin/env bun

import { access, readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'])

function fail(message: string): never {
  throw new Error(`[third-party-interface-boundary] ${message}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(root, path))
    return true
  } catch {
    return false
  }
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
  'src/services/api/openai/chatgptAuth.ts',
  'src/services/api/openai/responsesAdapter.ts',
  'src/utils/model/chatgptModels.ts',
  'src/utils/chinaLlmProviders.ts',
  'src/services/mcp/officialRegistry.ts',
  'src/commands/subscribe-pr.ts',
  'packages/builtin-tools/src/tools/SubscribePRTool/SubscribePRTool.ts',
  'src/components/messages/UserGitHubWebhookMessage.tsx',
]
for (const path of removedPaths) {
  if (await exists(path)) fail(`removed interface path was restored: ${path}`)
}

const forbiddenMarkers = [
  'auth.openai.com',
  'chatgpt.com/backend-api/codex/responses',
  'openai-chatgpt-auth.json',
  'ChatGPT-Account-Id',
  'OPENAI_AUTH_MODE',
  'createChatGPTResponsesStream',
  'CHINA_LLM_PROVIDERS',
  'findChinaProviderById',
  'KAIROS_GITHUB_WEBHOOKS',
  'github-webhook-activity',
  'pr-subscriptions.json',
  'SubscribePRTool',
  'registry.modelcontextprotocol.io',
]
for (const dir of ['src', 'packages', 'scripts']) {
  for (const path of await sourceFiles(dir)) {
    if (
      path === 'scripts/validation/third-party-interface-boundary.ts' ||
      path === 'scripts/check-bundle-integrity.ts'
    ) {
      continue
    }
    const text = await readFile(join(root, path), 'utf8')
    for (const marker of forbiddenMarkers) {
      if (text.includes(marker)) fail(`${path} contains removed interface marker ${marker}`)
    }
  }
}

// Preserve the generic user-configured MCP resource prefetch path. It is not
// the removed Anthropic registry prefetch implementation.
const mcpClient = await readFile(join(root, 'src/services/mcp/client.ts'), 'utf8')
if (!mcpClient.includes('prefetchAllMcpResources')) {
  fail('generic configured-MCP resource prefetch was removed by mistake')
}

// The supported model transport remains OpenAI-compatible Chat Completions.
const openaiProvider = await readFile(
  join(root, 'src/services/model/providers/openaiProvider.ts'),
  'utf8',
)
for (const required of [
  'anthropicMessagesToOpenAI',
  'anthropicToolsToOpenAI',
  'adaptOpenAIStreamToAnthropic',
]) {
  if (!openaiProvider.includes(required)) {
    fail(`OpenAI-compatible provider lost required adapter ${required}`)
  }
}

const openaiClient = await readFile(
  join(root, 'src/services/api/openai/client.ts'),
  'utf8',
)
for (const required of ['/chat/completions', 'parseChatCompletionSSE']) {
  if (!openaiClient.includes(required)) {
    fail(`lightweight Chat Completions client lost ${required}`)
  }
}
for (const forbidden of ["import OpenAI from 'openai'", 'new OpenAI(']) {
  if (openaiClient.includes(forbidden)) {
    fail(`runtime OpenAI SDK client was restored: ${forbidden}`)
  }
}

console.log('[third-party-interface-boundary] PASS')
