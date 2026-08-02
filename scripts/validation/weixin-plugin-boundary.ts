#!/usr/bin/env bun

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import {
  extractMcpServersFromPlugins,
  loadPluginMcpServers,
} from '../../src/utils/plugins/mcpPluginIntegration.js'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { isChannelAllowlisted } from '../../src/services/mcp/channelAllowlist.js'

const root = resolve(import.meta.dir, '../..')
const pluginRoot = join(root, 'plugins', 'weixin')
const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')
const sourceHostArgument = '$' + '{CLAUDE_PLUGIN_ROOT}/host/entry.ts'

for (const path of [
  manifestPath,
  join(pluginRoot, 'README.md'),
  join(pluginRoot, 'host', 'entry.ts'),
  join(pluginRoot, 'src', 'server.ts'),
  join(pluginRoot, 'src', 'login.ts'),
  join(pluginRoot, 'src', 'monitor.ts'),
]) {
  await access(path)
}

const manifest = PluginManifestSchema().parse(
  JSON.parse(await readFile(manifestPath, 'utf8')),
)
if (manifest.name !== 'weixin') {
  throw new Error(`[weixin-plugin-boundary] unexpected plugin name: ${manifest.name}`)
}
const mcpSpec = manifest.mcpServers
if (
  !mcpSpec ||
  typeof mcpSpec === 'string' ||
  Array.isArray(mcpSpec) ||
  !('weixin' in mcpSpec)
) {
  throw new Error('[weixin-plugin-boundary] standard weixin MCP server is missing')
}
const declaredServer = mcpSpec.weixin
if (
  declaredServer.type !== 'stdio' ||
  declaredServer.command !== 'bun' ||
  !declaredServer.args.includes(sourceHostArgument) ||
  declaredServer.args.at(-1) !== 'mcp'
) {
  throw new Error('[weixin-plugin-boundary] source MCP entry is not the local Plugin Host')
}

const loaded = await createPluginFromPath(pluginRoot, 'weixin@local', true, 'weixin')
const errors = [...loaded.errors]
const rawServers = await loadPluginMcpServers(loaded.plugin, errors)
const pluginCache = await mkdtemp(join(tmpdir(), 'weixin-plugin-cache-'))
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginCache
const scopedServers = await extractMcpServersFromPlugins(
  [loaded.plugin],
  errors,
).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(pluginCache, { recursive: true, force: true })
})
const scoped = scopedServers['plugin:weixin:weixin']
if (
  errors.length > 0 ||
  Object.keys(rawServers ?? {}).join(',') !== 'weixin' ||
  scoped?.type !== 'stdio' ||
  resolve(scoped.args?.[0] ?? '') !== resolve(pluginRoot, 'host', 'entry.ts')
) {
  throw new Error(`[weixin-plugin-boundary] standard Plugin lifecycle failed: ${JSON.stringify(errors)}`)
}

if (!isChannelAllowlisted('weixin@local') || isChannelAllowlisted('weixin@inline')) {
  throw new Error('[weixin-plugin-boundary] packaged/development Channel trust boundary changed')
}

for (const removed of [
  'packages/weixin/package.json',
  'src/plugins/bundled/weixin.ts',
]) {
  try {
    await access(join(root, removed))
    throw new Error(`[weixin-plugin-boundary] removed main-tree entry restored: ${removed}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[weixin-plugin-boundary]')) throw error
  }
}

const forbiddenByFile: Record<string, string[]> = {
  'src/entrypoints/cli.tsx': ['cli_weixin_path', '@claude-code-best/weixin'],
  'package.json': ['"@claude-code-best/weixin": "workspace:*"'],
  'tsconfig.json': ['packages/weixin/src'],
}
for (const [file, markers] of Object.entries(forbiddenByFile)) {
  const source = await readFile(join(root, file), 'utf8')
  for (const marker of markers) {
    if (source.includes(marker)) {
      throw new Error(`[weixin-plugin-boundary] ${file} retains ${JSON.stringify(marker)}`)
    }
  }
}

console.log('[weixin-plugin-boundary] PASS')
