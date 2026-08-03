#!/usr/bin/env bun

import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isChannelAllowlisted } from '../../src/services/mcp/channelAllowlist.js'
import { extractMcpServersFromPlugins, loadPluginMcpServers } from '../../src/utils/plugins/mcpPluginIntegration.js'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const plugin = join(root, 'plugins', 'wxwork')
const pkg = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')) as {
  name: string
  wxworkCompatibility?: Record<string, string>
  dependencies?: Record<string, string>
}
const manifest = PluginManifestSchema().parse(JSON.parse(
  await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'),
))

assertEqual(pkg.name, '@claude-code/wxwork-plugin', 'wxwork package identity')
assertEqual(manifest.name, 'wxwork', 'wxwork Plugin identity')
assert(manifest.mcpServers?.wxwork, 'wxwork manifest must expose the wxwork MCP server')
await access(join(plugin, 'host', 'entry.ts'))
const loaded = await createPluginFromPath(plugin, 'wxwork@local', true, 'wxwork')
const errors = [...loaded.errors]
const rawServers = await loadPluginMcpServers(loaded.plugin, errors)
const pluginCache = await mkdtemp(join(tmpdir(), 'wxwork-plugin-cache-'))
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginCache
const scopedServers = await extractMcpServersFromPlugins([loaded.plugin], errors).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(pluginCache, { recursive: true, force: true })
})
const scoped = scopedServers['plugin:wxwork:wxwork']
assertEqual(errors.length, 0, 'standard Plugin lifecycle errors')
assertEqual(Object.keys(rawServers ?? {}).join(','), 'wxwork', 'raw MCP server identity')
assertEqual(scoped?.type, 'stdio', 'scoped MCP transport')
assertEqual(resolve(scoped?.args?.[0] ?? ''), resolve(plugin, 'host', 'entry.ts'), 'scoped MCP Host entry')
assert(isChannelAllowlisted('wxwork@local'), 'packaged wxwork Channel must be trusted')
assert(!isChannelAllowlisted('wxwork@inline'), 'development wxwork Channel must require explicit opt-in')
for (const dependency of [
  '@wecom/wecom-openclaw-cli',
  '@wecom/wecom-openclaw-plugin',
  '@wecom/aibot-node-sdk',
]) {
  assert(!pkg.dependencies?.[dependency], `${dependency} must remain audit-only`)
}
for (const key of [
  'upstreamCli',
  'upstreamPlugin',
  'upstreamPluginCommit',
  'upstreamSdk',
  'upstreamSdkCommit',
  'auditedAt',
]) {
  assert(pkg.wxworkCompatibility?.[key], `compatibility metadata must record ${key}`)
}

const sourceFiles = (await readdir(join(plugin, 'src'))).filter(file => file.endsWith('.ts'))
const source = await Promise.all(sourceFiles.map(file => readFile(join(plugin, 'src', file), 'utf8')))
assert(!source.join('\n').includes('openclaw'), 'wxwork runtime source must not import or embed OpenClaw')

console.log('[wxwork-plugin-boundary] PASS')
