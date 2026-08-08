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
const pluginPath = join(distributionRoot, 'plugins', 'chrome')
const weixinPluginPath = join(distributionRoot, 'plugins', 'weixin')
const wxworkPluginPath = join(distributionRoot, 'plugins', 'wxwork')
const qqPluginPath = join(distributionRoot, 'plugins', 'qq')
const telegramPluginPath = join(distributionRoot, 'plugins', 'telegram')
const telegramUserPluginPath = join(
  distributionRoot,
  'plugins',
  'telegram-user',
)
const xPluginPath = join(distributionRoot, 'plugins', 'x')
const openAIProxyPluginPath = join(
  distributionRoot,
  'plugins',
  'openai-proxy',
)
const hiddenPluginPath = join(
  distributionRoot,
  `.chrome-validation-hidden-${process.pid}`,
)

function listPlugins(prefixArgs: string[] = []): ListedPlugin[] {
  const result = spawnSync(exe, [...prefixArgs, 'plugin', 'list', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env },
  })
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
await access(telegramPluginPath)
await access(telegramUserPluginPath)
await access(xPluginPath)
await access(openAIProxyPluginPath)

const automatic = listPlugins()
assert(
  !automatic.some(plugin => plugin.name === 'claudeinchrome'),
  'standalone must not expose the legacy claudeinchrome Plugin identity',
)
const automaticChrome = automatic.find(plugin => plugin.name === 'chrome')
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
assertEqual(
  resolve(automaticQq.path),
  resolve(qqPluginPath),
  'qq automatic plugin path',
)
const automaticTelegram = automatic.find(plugin => plugin.name === 'telegram')
assert(automaticTelegram, 'standalone must automatically discover telegram')
assertEqual(
  automaticTelegram.source,
  'telegram@local',
  'telegram automatic source',
)
assertEqual(
  resolve(automaticTelegram.path),
  resolve(telegramPluginPath),
  'telegram automatic plugin path',
)
const automaticTelegramUser = automatic.find(
  plugin => plugin.name === 'telegram-user',
)
assert(
  automaticTelegramUser,
  'standalone must automatically discover telegram-user',
)
assertEqual(
  automaticTelegramUser.source,
  'telegram-user@local',
  'telegram-user automatic source',
)
assertEqual(
  resolve(automaticTelegramUser.path),
  resolve(telegramUserPluginPath),
  'telegram-user automatic plugin path',
)
const automaticX = automatic.find(plugin => plugin.name === 'x')
assert(automaticX, 'standalone must automatically discover x')
assertEqual(automaticX.source, 'x@local', 'x automatic source')
assertEqual(
  resolve(automaticX.path),
  resolve(xPluginPath),
  'x automatic plugin path',
)
const automaticOpenAIProxy = automatic.find(
  plugin => plugin.name === 'openai-proxy',
)
assert(
  automaticOpenAIProxy,
  'standalone must automatically discover openai-proxy',
)
assertEqual(
  automaticOpenAIProxy.source,
  'openai-proxy@local',
  'openai-proxy automatic source',
)
assertEqual(
  resolve(automaticOpenAIProxy.path),
  resolve(openAIProxyPluginPath),
  'openai-proxy automatic plugin path',
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
const explicitChrome = explicit.find(plugin => plugin.name === 'chrome')
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
    !withoutAutomaticPlugin.some(plugin => plugin.name === 'chrome'),
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
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'telegram'),
    'removing chrome must not remove the independent telegram plugin',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'telegram-user'),
    'removing chrome must not remove the independent telegram-user plugin',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'x'),
    'removing chrome must not remove the independent x plugin',
  )
  assert(
    withoutAutomaticPlugin.some(plugin => plugin.name === 'openai-proxy'),
    'removing chrome must not remove the independent openai-proxy plugin',
  )
} finally {
  if (moved) await rename(hiddenPluginPath, pluginPath)
}

console.log('[automatic-plugin-standalone] PASS')
