#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { generateSettingsJSONSchema } from '../../src/utils/settings/schemaOutput.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string): Promise<string> =>
  readFile(join(root, path), 'utf8')

const requiredDocumentation: Record<string, readonly string[]> = {
  'README.md': [
    '### 网络能力边界',
    'scripts/feature-policy.ts',
    'ENVIRONMENT_VARIABLES.md',
    'Windows standalone EXE',
  ],
  'FEATURE_FLAGS.md': [
    '不连接远程 Feature Flag 服务',
    'CLAUDE_LOCAL_FEATURE_OVERRIDES',
  ],
  'ENVIRONMENT_VARIABLES.md': [
    'CLAUDE_CODE_VERIFY_MODEL',
    'CLAUDE_CODE_RCS_AUTH_TOKEN',
    'MCP_CLIENT_SECRET',
  ],
  'DEPENDENCY_AUDIT.md': [
    'scripts/check-exe-integrity.ts',
    'MCP OAuth',
  ],
}

for (const [path, markers] of Object.entries(requiredDocumentation)) {
  await access(join(root, path))
  const text = await source(path)
  for (const marker of markers) {
    if (!text.includes(marker)) {
      throw new Error(`[product-surface-boundary] ${path} is missing ${marker}`)
    }
  }
}

const schema = generateSettingsJSONSchema()
for (const marker of [
  'forceLoginMethod',
  'forceLoginOrgUUID',
  'feedbackSurveyRate',
  'Anthropic server-side search',
  'json.schemastore.org/claude-code-settings.json',
]) {
  if (schema.includes(marker)) {
    throw new Error(
      `[product-surface-boundary] generated settings schema contains ${marker}`,
    )
  }
}

const statusCommand = await source('src/commands/status/index.ts')
if (/account|logged.?in|subscription/i.test(statusCommand)) {
  throw new Error('[product-surface-boundary] /status still advertises an account')
}

const searchFactory = await source(
  'packages/builtin-tools/src/tools/WebSearchTool/adapters/index.ts',
)
if (/ApiSearchAdapter|['"]api['"]/.test(searchFactory)) {
  throw new Error(
    '[product-surface-boundary] removed hosted search adapter is still exposed',
  )
}

try {
  await access(
    join(
      root,
      'packages/builtin-tools/src/tools/WebSearchTool/adapters/apiAdapter.ts',
    ),
  )
  throw new Error(
    '[product-surface-boundary] hosted search adapter implementation was restored',
  )
} catch (error) {
  if (
    error instanceof Error &&
    error.message.startsWith('[product-surface-boundary]')
  ) {
    throw error
  }
}

const policy = await source('scripts/feature-policy.ts')
for (const marker of [
  'COWORKER_TYPE_TELEMETRY',
  'MEMORY_SHAPE_TELEMETRY',
  'ENHANCED_TELEMETRY_BETA',
  'PERFETTO_TRACING',
]) {
  if (policy.includes(marker)) {
    throw new Error(`[product-surface-boundary] Feature Policy contains ${marker}`)
  }
}

console.log('[product-surface-boundary] PASS')

