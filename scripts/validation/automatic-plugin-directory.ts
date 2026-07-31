#!/usr/bin/env bun

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  AUTOMATIC_PLUGINS_DIRECTORY_NAME,
  getAutomaticPluginDirectory,
  resolveAutomaticPluginDirectory,
} from '../../src/utils/plugins/automaticPluginDirectory.js'
import {
  discoverAutomaticPluginDirectories,
  isPathInsideDirectory,
} from '../../src/utils/plugins/automaticPluginDiscovery.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

assertEqual(
  AUTOMATIC_PLUGINS_DIRECTORY_NAME,
  'plugins',
  'automatic plugin directory name',
)
assertEqual(
  resolveAutomaticPluginDirectory(resolve('portable', 'claude.exe')),
  resolve('portable', 'plugins'),
  'automatic plugins must be beside the executable',
)
assertEqual(
  getAutomaticPluginDirectory(),
  undefined,
  'source/Bun execution must keep explicit --plugin-dir behavior',
)

const fixtureRoot = await mkdtemp(join(tmpdir(), 'automatic-plugins-'))
try {
  assertDeepEqual(
    await discoverAutomaticPluginDirectories(join(fixtureRoot, 'missing')),
    { candidates: [], errors: [] },
    'missing automatic plugin directory',
  )

  const pluginsRoot = join(fixtureRoot, 'plugins')
  await mkdir(pluginsRoot)
  await writeFile(join(pluginsRoot, 'ordinary-file.txt'), 'ignored')
  await mkdir(join(pluginsRoot, 'no-manifest'))
  await mkdir(join(pluginsRoot, 'nested', 'too-deep', '.claude-plugin'), {
    recursive: true,
  })
  await writeFile(
    join(pluginsRoot, 'nested', 'too-deep', '.claude-plugin', 'plugin.json'),
    '{}',
  )

  for (const name of ['z-plugin', 'a-plugin']) {
    await mkdir(join(pluginsRoot, name, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(pluginsRoot, name, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name }),
    )
  }

  const discovered = await discoverAutomaticPluginDirectories(pluginsRoot)
  assertDeepEqual(
    discovered.candidates.map(candidate => candidate.directoryName),
    ['a-plugin', 'z-plugin'],
    'only direct plugin children in stable order',
  )
  assertDeepEqual(discovered.errors, [], 'valid direct children have no errors')

  await rm(join(pluginsRoot, 'a-plugin'), { recursive: true })
  await mkdir(join(pluginsRoot, 'b-plugin', '.claude-plugin'), {
    recursive: true,
  })
  await writeFile(
    join(pluginsRoot, 'b-plugin', '.claude-plugin', 'plugin.json'),
    '{"name":"b-plugin"}',
  )
  const rescanned = await discoverAutomaticPluginDirectories(pluginsRoot)
  assertDeepEqual(
    rescanned.candidates.map(candidate => candidate.directoryName),
    ['b-plugin', 'z-plugin'],
    'rescan observes removed and added direct plugin directories',
  )

  assert(
    isPathInsideDirectory(pluginsRoot, join(pluginsRoot, 'direct-child')),
    'direct child containment',
  )
  assert(
    !isPathInsideDirectory(pluginsRoot, pluginsRoot),
    'root must not be treated as a plugin',
  )
  assert(
    !isPathInsideDirectory(pluginsRoot, resolve(pluginsRoot, '..', 'escape')),
    'path escape containment',
  )
  assert(
    isPathInsideDirectory(pluginsRoot, join(pluginsRoot, '..named-plugin')),
    'a contained name beginning with two dots is not a path escape',
  )

  const outsidePlugin = join(fixtureRoot, 'outside-plugin')
  await mkdir(join(outsidePlugin, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(outsidePlugin, '.claude-plugin', 'plugin.json'),
    '{"name":"outside"}',
  )
  const linkedPlugin = join(pluginsRoot, 'linked-plugin')
  let linkCreated = false
  try {
    await symlink(
      outsidePlugin,
      linkedPlugin,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    linkCreated = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EACCES') throw error
    console.log(
      '[automatic-plugin-directory] SKIP link fixture: platform denied link creation',
    )
  }
  if (linkCreated) {
    const withLink = await discoverAutomaticPluginDirectories(pluginsRoot)
    assert(
      withLink.errors.some(
        error =>
          error.path === linkedPlugin &&
          error.error.includes('symbolic link or Junction'),
      ),
      'linked direct child must fail closed',
    )
    assert(
      !withLink.candidates.some(
        candidate => candidate.directoryName === 'linked-plugin',
      ),
      'linked direct child must not be discovered',
    )
  }
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

console.log('[automatic-plugin-directory] PASS')
