#!/usr/bin/env bun

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assert } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const verifySource = await readFile(join(root, 'scripts', 'verify.ts'), 'utf8')
const requiredValidations = [
  'openai-proxy-plugin-boundary.ts',
  'openai-proxy-gateway.ts',
  'openai-proxy-auth.ts',
  'openai-proxy-model.ts',
  'openai-proxy-lifecycle.ts',
  'openai-proxy-upstream-proxy.ts',
  'openai-proxy-upstream-boundary.ts',
  'openai-proxy-regression-boundary.ts',
  'provider-boundary.ts',
  'model-profiles.ts',
  'openai-client.ts',
  'tool-permissions.ts',
  'windows-sandbox.ts',
]
for (const validation of requiredValidations) {
  assert(
    verifySource.includes(`scripts/validation/${validation}`),
    `Full verification must retain ${validation}`,
  )
}

const rootSources = await Promise.all(
  (await readdir(join(root, 'src'), { recursive: true }))
    .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
    .map(file => readFile(join(root, 'src', file), 'utf8')),
)
const combinedRootSources = rootSources.join('\n')
assert(
  !combinedRootSources.includes('plugins/openai-proxy'),
  'Optional Plugin must not alter the root provider path',
)
assert(
  !combinedRootSources.includes('openai-proxy-host'),
  'Optional Host must not be linked into the root runtime',
)

const distributionValidation = await readFile(
  join(root, 'scripts', 'validation', 'openai-proxy-distribution.ts'),
  'utf8',
)
for (const lifecycleEvidence of ['--version', 'mcp', 'EOF', 'dist']) {
  assert(
    distributionValidation.includes(lifecycleEvidence),
    `Windows distribution validation must retain ${lifecycleEvidence} evidence`,
  )
}

console.log('[openai-proxy-regression-boundary] PASS')
