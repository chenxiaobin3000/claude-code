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
const plugin = join(root, 'plugins', 'qq')
const pkg = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string>; qqCompatibility?: Record<string, string> }
const manifest = PluginManifestSchema().parse(JSON.parse(await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')))
assertEqual(pkg.name, '@claude-code/qq-plugin', 'QQ package identity')
assertEqual(manifest.name, 'qq', 'QQ Plugin identity')
await access(join(plugin, 'host', 'entry.ts'))
for (const dependency of ['@tencent-connect/openclaw-qqbot', '@tencent-connect/qqbot-connector', '@tencent-connect/qqbot-nodejs']) assert(!pkg.dependencies?.[dependency], `${dependency} must remain audit-only`)
for (const key of ['upstreamPlugin', 'upstreamPluginCommit', 'upstreamConnector', 'upstreamSdk', 'upstreamSdkGitHead', 'auditedAt']) assert(pkg.qqCompatibility?.[key], `QQ compatibility metadata must include ${key}`)
const source = await Promise.all((await readdir(join(plugin, 'src'))).filter(file => file.endsWith('.ts')).map(file => readFile(join(plugin, 'src', file), 'utf8')))
assert(!source.join('\n').includes('@tencent-connect/'), 'QQ runtime source must not import official packages')
const loaded = await createPluginFromPath(plugin, 'qq@local', true, 'qq')
const errors = [...loaded.errors]
const raw = await loadPluginMcpServers(loaded.plugin, errors)
const cache = await mkdtemp(join(tmpdir(), 'qq-plugin-cache-'))
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = cache
const scoped = await extractMcpServersFromPlugins([loaded.plugin], errors).finally(async () => { delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR; await rm(cache, { recursive: true, force: true }) })
assertEqual(errors.length, 0, 'QQ Plugin lifecycle errors')
assertEqual(Object.keys(raw ?? {}).join(','), 'qq', 'QQ raw MCP identity')
assertEqual(scoped['plugin:qq:qq']?.type, 'stdio', 'QQ scoped MCP transport')
assert(isChannelAllowlisted('qq@local') && !isChannelAllowlisted('qq@inline'), 'QQ packaged/development trust boundary')
console.log('[qq-plugin-boundary] PASS')
