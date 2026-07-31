#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadedPlugin } from '../../src/types/plugin.js'
import {
  isAutomaticPluginDiscoveryEnabled,
  loadDirectoryPluginTier,
  selectPluginsByPriority,
} from '../../src/utils/plugins/pluginLoader.js'
import { getPluginSourceLabel } from '../../src/utils/plugins/pluginIdentifier.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = await mkdtemp(join(tmpdir(), 'automatic-plugin-loading-'))

async function pluginDirectory(
  directory: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const path = join(root, directory)
  await mkdir(join(path, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(path, '.claude-plugin', 'plugin.json'),
    JSON.stringify(manifest),
  )
  return path
}

function builtin(name: string): LoadedPlugin {
  return {
    name,
    path: 'builtin',
    source: `${name}@builtin`,
    repository: `${name}@builtin`,
    enabled: true,
    isBuiltin: true,
    manifest: { name },
  }
}

try {
  const previousSimple = process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_SIMPLE
  assert(
    isAutomaticPluginDiscoveryEnabled(),
    'ordinary startup enables automatic discovery',
  )
  process.env.CLAUDE_CODE_SIMPLE = '1'
  assert(
    !isAutomaticPluginDiscoveryEnabled(),
    '--bare/SIMPLE disables automatic discovery',
  )
  if (previousSimple === undefined) delete process.env.CLAUDE_CODE_SIMPLE
  else process.env.CLAUDE_CODE_SIMPLE = previousSimple

  assertEqual(
    getPluginSourceLabel('browser@local'),
    'automatic: browser@local',
    'automatic plugin source label',
  )
  assertEqual(
    getPluginSourceLabel('browser@inline'),
    'explicit --plugin-dir: browser@inline',
    'explicit plugin source label',
  )

  const inlinePath = await pluginDirectory('inline-browser', {
    name: 'browser',
    version: '2.0.0',
  })
  const automaticPath = await pluginDirectory('automatic-browser', {
    name: 'browser',
    version: '1.0.0',
  })
  const automaticOtherPath = await pluginDirectory('automatic-other', {
    name: 'other',
    version: '1.0.0',
  })

  const inline = await loadDirectoryPluginTier(
    [
      {
        path: inlinePath,
        fallbackName: 'inline-browser',
        sourceLabel: 'inline[0]',
      },
    ],
    'inline',
  )
  const automatic = await loadDirectoryPluginTier(
    [
      {
        path: automaticPath,
        fallbackName: 'automatic-browser',
        sourceLabel: 'browser@local',
      },
      {
        path: automaticOtherPath,
        fallbackName: 'automatic-other',
        sourceLabel: 'other@local',
      },
    ],
    'local',
  )
  const selected = selectPluginsByPriority(inline, automatic, {
    enabled: [builtin('browser'), builtin('other'), builtin('builtin-only')],
    disabled: [],
  })
  assertDeepEqual(
    selected.plugins.map(plugin => plugin.source),
    ['browser@inline', 'other@local', 'builtin-only@builtin'],
    'explicit, automatic, and builtin priority',
  )

  const duplicateOne = await pluginDirectory('duplicate-one', { name: 'dup' })
  const duplicateTwo = await pluginDirectory('duplicate-two', { name: 'dup' })
  const duplicateTier = await loadDirectoryPluginTier(
    [
      {
        path: duplicateOne,
        fallbackName: 'duplicate-one',
        sourceLabel: 'duplicate-one@local',
      },
      {
        path: duplicateTwo,
        fallbackName: 'duplicate-two',
        sourceLabel: 'duplicate-two@local',
      },
    ],
    'local',
  )
  assertEqual(duplicateTier.plugins.length, 0, 'same-tier duplicates disabled')
  assert(duplicateTier.claimedNames.has('dup'), 'duplicate name remains claimed')
  assert(
    duplicateTier.errors.some(
      error =>
        error.type === 'generic-error' &&
        error.error.includes('Duplicate local plugin name'),
    ),
    'same-tier duplicate diagnostic',
  )

  const brokenExplicitPath = await pluginDirectory('broken-explicit', {
    name: 'reserved',
    commands: 7,
  })
  const automaticReservedPath = await pluginDirectory('automatic-reserved', {
    name: 'reserved',
  })
  const brokenExplicit = await loadDirectoryPluginTier(
    [
      {
        path: brokenExplicitPath,
        fallbackName: 'broken-explicit',
        sourceLabel: 'inline[0]',
      },
    ],
    'inline',
  )
  const automaticReserved = await loadDirectoryPluginTier(
    [
      {
        path: automaticReservedPath,
        fallbackName: 'automatic-reserved',
        sourceLabel: 'reserved@local',
      },
    ],
    'local',
  )
  assertEqual(
    brokenExplicit.plugins.length,
    0,
    'invalid explicit plugin does not load',
  )
  assert(
    brokenExplicit.claimedNames.has('reserved'),
    'invalid explicit manifest still reserves its declared name',
  )
  const noFallback = selectPluginsByPriority(
    brokenExplicit,
    automaticReserved,
    { enabled: [builtin('reserved')], disabled: [] },
  )
  assertEqual(
    noFallback.plugins.length,
    0,
    'failed high-priority plugin cannot fall back to a lower priority',
  )

  const brokenAutomaticPath = await pluginDirectory('broken-automatic', {
    name: 'automatic-reserved',
    commands: 7,
  })
  const emptyInline = await loadDirectoryPluginTier([], 'inline')
  const brokenAutomatic = await loadDirectoryPluginTier(
    [
      {
        path: brokenAutomaticPath,
        fallbackName: 'broken-automatic',
        sourceLabel: 'automatic-reserved@local',
      },
    ],
    'local',
  )
  const noBuiltinFallback = selectPluginsByPriority(
    emptyInline,
    brokenAutomatic,
    { enabled: [builtin('automatic-reserved')], disabled: [] },
  )
  assertEqual(
    noBuiltinFallback.plugins.length,
    0,
    'failed automatic plugin cannot fall back to a builtin',
  )

  const refreshSource = await readFile(
    join(import.meta.dir, '../../src/utils/plugins/refresh.ts'),
    'utf8',
  )
  assert(
    refreshSource.includes('clearAllCaches()') &&
      refreshSource.includes('await loadAllPlugins()'),
    '/reload-plugins clears caches before rescanning plugins',
  )
  const automaticPathSource = await readFile(
    join(
      import.meta.dir,
      '../../src/utils/plugins/automaticPluginDirectory.ts',
    ),
    'utf8',
  )
  assert(
    automaticPathSource.includes('process.execPath') &&
      !automaticPathSource.includes('process.cwd()'),
    'standalone child discovery follows its executable rather than cwd',
  )
  const spawnSource = await readFile(
    join(import.meta.dir, '../../src/utils/swarm/spawnUtils.ts'),
    'utf8',
  )
  assert(
    spawnSource.includes("flags.push('--plugin-dir', pluginDir)"),
    'explicit plugin directories remain propagated to child processes',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('[automatic-plugin-loading] PASS')
