#!/usr/bin/env bun

import { access, rename } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'

type ListedPlugin = {
  name: string
  source: string
  path: string
  enabled: boolean
}

const exe = resolve(
  process.argv[2] ??
    join(
      import.meta.dir,
      '..',
      '..',
      'dist',
      process.platform === 'win32' ? 'claude.exe' : 'claude',
    ),
)
const distributionRoot = dirname(exe)
const pluginPath = join(
  distributionRoot,
  'plugins',
  'claudeinchrome',
)
const weixinPluginPath = join(distributionRoot, 'plugins', 'weixin')
const hiddenPluginPath = join(
  distributionRoot,
  `.claudeinchrome-validation-hidden-${process.pid}`,
)

function listPlugins(prefixArgs: string[] = []): ListedPlugin[] {
  const result = spawnSync(
    exe,
    [...prefixArgs, 'plugin', 'list', '--json'],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env },
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `standalone plugin list failed (${result.status}): ${result.stderr || result.stdout}`,
    )
  }
  return JSON.parse(result.stdout) as ListedPlugin[]
}

await access(exe)
await access(pluginPath)
await access(weixinPluginPath)

const automatic = listPlugins()
const automaticChrome = automatic.find(
  plugin => plugin.name === 'claudeinchrome',
)
assert(automaticChrome, 'standalone must automatically discover claudeinchrome')
assertEqual(
  automaticChrome.source,
  'claudeinchrome@local',
  'standalone automatic source',
)
const automaticWeixin = automatic.find(plugin => plugin.name === 'weixin')
assert(automaticWeixin, 'standalone must automatically discover weixin')
assertEqual(automaticWeixin.source, 'weixin@local', 'weixin automatic source')
assertEqual(
  resolve(automaticWeixin.path),
  resolve(weixinPluginPath),
  'weixin automatic plugin path',
)
assertEqual(
  resolve(automaticChrome.path),
  resolve(pluginPath),
  'standalone automatic plugin path',
)

const bare = listPlugins(['--bare'])
assert(
  !bare.some(plugin => plugin.source.endsWith('@local')),
  '--bare must disable automatic plugin discovery',
)

const explicit = listPlugins(['--plugin-dir', pluginPath])
const explicitChrome = explicit.find(
  plugin => plugin.name === 'claudeinchrome',
)
assert(explicitChrome, 'explicit --plugin-dir must remain available')
assertEqual(
  explicitChrome.source,
  'claudeinchrome@inline',
  'explicit plugin overrides automatic plugin',
)

let moved = false
try {
  await rename(pluginPath, hiddenPluginPath)
  moved = true
  const withoutAutomaticPlugin = listPlugins()
  assert(
    !withoutAutomaticPlugin.some(
      plugin => plugin.name === 'claudeinchrome',
    ),
    'removing the automatic plugin directory must remove its MCP and Skill entry point',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'weixin'),
    'removing claudeinchrome must not remove the independent weixin plugin',
  )
} finally {
  if (moved) await rename(hiddenPluginPath, pluginPath)
}

console.log('[automatic-plugin-standalone] PASS')
