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
const pluginRoot = join(root, 'dist', 'plugins', 'chrome')
const hostFilename =
  process.platform === 'win32'
    ? 'chrome-host.exe'
    : 'chrome-host'
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

try {
  await access(join(root, 'dist', 'plugins', 'claudeinchrome'))
  throw new Error(
    '[chrome-distribution] legacy Plugin distribution still exists',
  )
} catch (error) {
  if (
    error instanceof Error &&
    error.message.startsWith('[chrome-distribution]')
  ) {
    throw error
  }
}

const manifest = PluginManifestSchema().parse(
  JSON.parse(await readFile(manifestPath, 'utf8')),
)
const mcpSpec = manifest.mcpServers
if (
  !mcpSpec ||
  typeof mcpSpec === 'string' ||
  Array.isArray(mcpSpec) ||
  !('claude-in-chrome' in mcpSpec) ||
  !('chrome-dom' in mcpSpec)
) {
  throw new Error(
    '[chrome-distribution] distributable MCP declaration is missing',
  )
}
const domServer = mcpSpec['chrome-dom']
if (
  domServer.type !== 'stdio' ||
  domServer.command !== `\${CLAUDE_PLUGIN_ROOT}/${hostFilename}` ||
  JSON.stringify(domServer.args) !== JSON.stringify(['dom-mcp'])
) {
  throw new Error(
    '[chrome-distribution] distributable DOM MCP still depends on a source runtime',
  )
}
const server = mcpSpec['claude-in-chrome']
if (
  server.type !== 'stdio' ||
  server.command !== `\${CLAUDE_PLUGIN_ROOT}/${hostFilename}` ||
  JSON.stringify(server.args) !== JSON.stringify(['mcp'])
) {
  throw new Error(
    '[chrome-distribution] distributable MCP still depends on a source runtime',
  )
}

const loaded = await createPluginFromPath(
  pluginRoot,
  'chrome@distribution',
  true,
  'chrome',
)
const errors = [...loaded.errors]
const rawServers = await loadPluginMcpServers(loaded.plugin, errors)
const pluginCache = await mkdtemp(
  join(tmpdir(), 'chrome-distribution-cache-'),
)
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginCache
const scopedServers = await extractMcpServersFromPlugins(
  [loaded.plugin],
  errors,
).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(pluginCache, { recursive: true, force: true })
})
const scoped = scopedServers['plugin:chrome:claude-in-chrome']
const scopedDom = scopedServers['plugin:chrome:chrome-dom']
if (
  errors.length > 0 ||
  Object.keys(rawServers ?? {}).join(',') !== 'claude-in-chrome,chrome-dom' ||
  scoped?.type !== 'stdio' ||
  resolve(scoped.command) !== resolve(hostPath) ||
  scopedDom?.type !== 'stdio' ||
  resolve(scopedDom.command) !== resolve(hostPath) ||
  scopedDom.args?.at(-1) !== 'dom-mcp'
) {
  throw new Error(
    `[chrome-distribution] standard Plugin lifecycle failed: ${JSON.stringify(errors)}`,
  )
}

console.log('[chrome-distribution] PASS')
