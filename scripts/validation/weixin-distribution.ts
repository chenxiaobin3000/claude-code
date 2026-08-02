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

const root = resolve(import.meta.dir, '../..')
const pluginRoot = join(root, 'dist', 'plugins', 'weixin')
const hostFilename = process.platform === 'win32' ? 'weixin-host.exe' : 'weixin-host'
const hostPath = join(pluginRoot, hostFilename)
const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')

for (const path of [hostPath, manifestPath, join(pluginRoot, 'README.md')]) {
  await access(path)
}

const manifest = PluginManifestSchema().parse(
  JSON.parse(await readFile(manifestPath, 'utf8')),
)
const mcpSpec = manifest.mcpServers
if (
  !mcpSpec ||
  typeof mcpSpec === 'string' ||
  Array.isArray(mcpSpec) ||
  !('weixin' in mcpSpec)
) {
  throw new Error('[weixin-distribution] distributable MCP declaration is missing')
}
const server = mcpSpec.weixin
if (
  server.type !== 'stdio' ||
  server.command !== `\${CLAUDE_PLUGIN_ROOT}/${hostFilename}` ||
  JSON.stringify(server.args) !== JSON.stringify(['mcp'])
) {
  throw new Error('[weixin-distribution] distributable MCP depends on a source runtime')
}

const loaded = await createPluginFromPath(pluginRoot, 'weixin@distribution', true, 'weixin')
const errors = [...loaded.errors]
const rawServers = await loadPluginMcpServers(loaded.plugin, errors)
const pluginCache = await mkdtemp(join(tmpdir(), 'weixin-distribution-cache-'))
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
  resolve(scoped.command) !== resolve(hostPath)
) {
  throw new Error(`[weixin-distribution] Plugin lifecycle failed: ${JSON.stringify(errors)}`)
}

console.log('[weixin-distribution] PASS')
