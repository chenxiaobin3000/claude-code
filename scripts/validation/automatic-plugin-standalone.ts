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
  'chrome',
)
const weixinPluginPath = join(distributionRoot, 'plugins', 'weixin')
const wxworkPluginPath = join(distributionRoot, 'plugins', 'wxwork')
const qqPluginPath = join(distributionRoot, 'plugins', 'qq')
const hiddenPluginPath = join(
  distributionRoot,
  `.chrome-validation-hidden-${process.pid}`,
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
await access(wxworkPluginPath)
await access(qqPluginPath)

const automatic = listPlugins()
assert(
  !automatic.some(plugin => plugin.name === 'claudeinchrome'),
  'standalone must not expose the legacy claudeinchrome Plugin identity',
)
const automaticChrome = automatic.find(
  plugin => plugin.name === 'chrome',
)
assert(automaticChrome, 'standalone must automatically discover chrome')
assertEqual(
  automaticChrome.source,
  'chrome@local',
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
const automaticWxwork = automatic.find(plugin => plugin.name === 'wxwork')
assert(automaticWxwork, 'standalone must automatically discover wxwork')
assertEqual(automaticWxwork.source, 'wxwork@local', 'wxwork automatic source')
assertEqual(
  resolve(automaticWxwork.path),
  resolve(wxworkPluginPath),
  'wxwork automatic plugin path',
)
const automaticQq = automatic.find(plugin => plugin.name === 'qq')
assert(automaticQq, 'standalone must automatically discover qq')
assertEqual(automaticQq.source, 'qq@local', 'qq automatic source')
assertEqual(resolve(automaticQq.path), resolve(qqPluginPath), 'qq automatic plugin path')
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
  plugin => plugin.name === 'chrome',
)
assert(explicitChrome, 'explicit --plugin-dir must remain available')
assertEqual(
  explicitChrome.source,
  'chrome@inline',
  'explicit plugin overrides automatic plugin',
)

let moved = false
try {
  await rename(pluginPath, hiddenPluginPath)
  moved = true
  const withoutAutomaticPlugin = listPlugins()
  assert(
    !withoutAutomaticPlugin.some(
      plugin => plugin.name === 'chrome',
    ),
    'removing the automatic plugin directory must remove its MCP and Skill entry point',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'weixin'),
    'removing chrome must not remove the independent weixin plugin',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'wxwork'),
    'removing chrome must not remove the independent wxwork plugin',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'qq'),
    'removing chrome must not remove the independent qq plugin',
  )
} finally {
  if (moved) await rename(hiddenPluginPath, pluginPath)
}

console.log('[automatic-plugin-standalone] PASS')
