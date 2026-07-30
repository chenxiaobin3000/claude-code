#!/usr/bin/env bun

import { join, resolve } from 'node:path'
import type { LoadedPlugin } from '../../src/types/plugin.js'
import { getPluginErrorMessage } from '../../src/types/plugin.js'
import { verifyAndDemote } from '../../src/utils/plugins/dependencyResolver.js'
import {
  EXTENSION_API_VERSION,
  LEGACY_EXTENSION_API_RANGE,
  negotiateExtensionApiVersion,
} from '../../src/utils/plugins/extensionApiVersion.js'
import {
  PluginManifestSchema,
  type PluginDependencyRef,
} from '../../src/utils/plugins/schemas.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')

function plugin(
  name: string,
  apiVersion?: string,
  dependencies: PluginDependencyRef[] = [],
): LoadedPlugin {
  return {
    name,
    source: `${name}@local`,
    repository: `${name}@local`,
    path: join(root, '.validation', name),
    enabled: true,
    manifest: PluginManifestSchema().parse({
      name,
      version: '1.0.0',
      ...(apiVersion ? { apiVersion } : {}),
      dependencies,
    }),
  }
}

assertEqual(EXTENSION_API_VERSION, '1.0.0', 'extension API baseline')
const legacy = negotiateExtensionApiVersion(undefined)
assert(legacy.compatible, 'manifest without apiVersion remains compatible')
assertEqual(
  legacy.requiredRange,
  LEGACY_EXTENSION_API_RANGE,
  'legacy manifest uses the v1 contract',
)
assert(
  negotiateExtensionApiVersion('^1.0.0').compatible,
  'same-major API range is compatible',
)
assert(
  !negotiateExtensionApiVersion('^2.0.0').compatible,
  'future major API range is incompatible',
)
assert(
  !PluginManifestSchema().safeParse({
    name: 'invalid-api-range',
    apiVersion: 'not semver',
  }).success,
  'invalid API range is rejected by the manifest schema',
)

const result = verifyAndDemote([
  plugin('legacy'),
  plugin('compatible', '>=1 <2'),
  plugin('future', '^2.0.0'),
  plugin('dependent', '^1.0.0', [{ name: 'future' }]),
])
assert(!result.demoted.has('legacy@local'), 'legacy plugin remains enabled')
assert(
  !result.demoted.has('compatible@local'),
  'compatible plugin remains enabled',
)
assert(result.demoted.has('future@local'), 'incompatible plugin is demoted')
assert(
  result.demoted.has('dependent@local'),
  'API demotion propagates to plugin dependents',
)
const apiError = result.errors.find(
  error => error.type === 'extension-api-version-unsupported',
)
assert(apiError !== undefined, 'API mismatch has a typed diagnostic')
assert(
  getPluginErrorMessage(apiError).includes(EXTENSION_API_VERSION),
  'API mismatch diagnostic includes the runtime version',
)

console.log('[extension-api-compat] PASS')

