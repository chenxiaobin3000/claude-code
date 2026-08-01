#!/usr/bin/env bun

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import {
  extractMcpServersFromPlugins,
  loadPluginMcpServers,
} from '../../src/utils/plugins/mcpPluginIntegration.js'

const root = resolve(import.meta.dir, '../..')
const pluginRoot = join(root, 'dist', 'plugins', 'claudeinchrome')
const hostFilename =
  process.platform === 'win32'
    ? 'claudeinchrome-host.exe'
    : 'claudeinchrome-host'
const hostPath = join(pluginRoot, hostFilename)
const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')

for (const path of [
  hostPath,
  manifestPath,
  join(pluginRoot, 'README.md'),
  join(pluginRoot, 'chrome-extension', 'manifest.json'),
  join(pluginRoot, 'skills', 'claude-in-chrome', 'SKILL.md'),
]) {
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
  !('claude-in-chrome' in mcpSpec)
) {
  throw new Error(
    '[claudeinchrome-distribution] distributable MCP declaration is missing',
  )
}
const server = mcpSpec['claude-in-chrome']
if (
  server.type !== 'stdio' ||
  server.command !== `\${CLAUDE_PLUGIN_ROOT}/${hostFilename}` ||
  JSON.stringify(server.args) !== JSON.stringify(['mcp'])
) {
  throw new Error(
    '[claudeinchrome-distribution] distributable MCP still depends on a source runtime',
  )
}

const loaded = await createPluginFromPath(
  pluginRoot,
  'claudeinchrome@distribution',
  true,
  'claudeinchrome',
)
const errors = [...loaded.errors]
const rawServers = await loadPluginMcpServers(loaded.plugin, errors)
const pluginCache = await mkdtemp(
  join(tmpdir(), 'claudeinchrome-distribution-cache-'),
)
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginCache
const scopedServers = await extractMcpServersFromPlugins(
  [loaded.plugin],
  errors,
).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(pluginCache, { recursive: true, force: true })
})
const scoped = scopedServers['plugin:claudeinchrome:claude-in-chrome']
if (
  errors.length > 0 ||
  Object.keys(rawServers ?? {}).join(',') !== 'claude-in-chrome' ||
  scoped?.type !== 'stdio' ||
  resolve(scoped.command) !== resolve(hostPath)
) {
  throw new Error(
    `[claudeinchrome-distribution] standard Plugin lifecycle failed: ${JSON.stringify(errors)}`,
  )
}

console.log('[claudeinchrome-distribution] PASS')
