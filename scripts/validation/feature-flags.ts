#!/usr/bin/env bun

import { readdir, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  DEFAULT_BUILD_FEATURES,
  FEATURE_POLICY,
  resolveBuildFeatures,
} from '../feature-policy.js'
import { assert, assertDeepEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const acceptanceTargets = new Set([
  'cli-startup',
  'message-conversion',
  'model-diagnostics',
  'model-request',
  'model-usage',
  'sdk-compat',
  'session-transcript',
  'shell-parsers',
  'tool-call',
  'workspace-smoke',
])

function expectFailure(run: () => unknown, expected: string): void {
  try {
    run()
  } catch (error) {
    assert(error instanceof Error, `${expected}: expected an Error`)
    assert(
      error.message.includes(expected),
      `expected error containing ${JSON.stringify(expected)}, got ${JSON.stringify(error.message)}`,
    )
    return
  }
  throw new Error(`expected failure containing ${JSON.stringify(expected)}`)
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (
      entry.isFile() &&
      ['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))
    )
      files.push(path)
  }
  return files
}

const defaults = new Set(DEFAULT_BUILD_FEATURES)
for (const [name, definition] of Object.entries(FEATURE_POLICY)) {
  for (const relation of [
    ...(definition.requires ?? []),
    ...(definition.conflicts ?? []),
  ]) {
    assert(
      FEATURE_POLICY[relation],
      `${name} references unknown feature ${relation}`,
    )
  }

  if (definition.tier === 'stable' && definition.default) {
    assert(defaults.has(name), `${name} must be in the default feature set`)
    assert(
      definition.acceptance && definition.acceptance.length > 0,
      `default stable feature ${name} requires acceptance coverage`,
    )
    for (const target of definition.acceptance ?? []) {
      assert(
        acceptanceTargets.has(target),
        `${name} references unknown acceptance target ${target}`,
      )
    }
  } else {
    assert(!defaults.has(name), `${name} must not be enabled by default`)
  }
}

for (const name of defaults) {
  assert(
    FEATURE_POLICY[name]?.tier === 'stable',
    `default feature ${name} must be stable`,
  )
}

const referenced = new Set<string>()
const featureCall = /\bfeature\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/g
for (const directory of ['src', 'packages']) {
  for (const path of await sourceFiles(resolve(root, directory))) {
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(featureCall)) referenced.add(match[1]!)
  }
}
for (const name of referenced) {
  assert(FEATURE_POLICY[name], `source references unclassified feature ${name}`)
}

assertDeepEqual(
  resolveBuildFeatures({ FEATURE_AUTO_THEME: '1' }),
  [...DEFAULT_BUILD_FEATURES, 'AUTO_THEME'],
  'stable opt-in',
)
assert(
  !resolveBuildFeatures({ FEATURE_POOR: '0' }).includes('POOR'),
  'stable defaults must support explicit opt-out',
)
expectFailure(
  () => resolveBuildFeatures({ FEATURE_UNKNOWN: '0' }),
  'Unknown feature flag',
)
expectFailure(
  () => resolveBuildFeatures({ FEATURE_TORCH: 'true' }),
  'must be 0 or 1',
)
expectFailure(
  () => resolveBuildFeatures({ FEATURE_TORCH: '1' }),
  'ALLOW_EXPERIMENTAL_FEATURES=1',
)
assert(
  resolveBuildFeatures({
    ALLOW_EXPERIMENTAL_FEATURES: '1',
    FEATURE_TORCH: '1',
  }).includes('TORCH'),
  'authorized experimental feature must be enabled',
)
expectFailure(
  () => resolveBuildFeatures({ FEATURE_UDS_INBOX: '1' }),
  'ALLOW_INTERNAL_FEATURES=1',
)
expectFailure(
  () =>
    resolveBuildFeatures({
      ALLOW_INTERNAL_FEATURES: '1',
      FEATURE_LAN_PIPES: '1',
    }),
  'LAN_PIPES requires feature UDS_INBOX',
)
const internalFeatures = resolveBuildFeatures({
  ALLOW_INTERNAL_FEATURES: '1',
  FEATURE_LAN_PIPES: '1',
  FEATURE_UDS_INBOX: '1',
})
assert(
  internalFeatures.includes('LAN_PIPES') &&
    internalFeatures.includes('UDS_INBOX'),
  'authorized internal dependency pair must be enabled',
)
expectFailure(
  () =>
    resolveBuildFeatures({
      ALLOW_EXPERIMENTAL_FEATURES: '1',
      FEATURE_EXTRACT_MEMORIES: '1',
    }),
  'POOR conflicts with feature EXTRACT_MEMORIES',
)
assert(
  resolveBuildFeatures({
    ALLOW_EXPERIMENTAL_FEATURES: '1',
    FEATURE_EXTRACT_MEMORIES: '1',
    FEATURE_POOR: '0',
  }).includes('EXTRACT_MEMORIES'),
  'conflicting default can be explicitly disabled',
)

console.log(
  `[feature-flags] PASS (${defaults.size} stable defaults, ${referenced.size} source flags classified)`,
)
