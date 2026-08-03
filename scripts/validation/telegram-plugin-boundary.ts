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
const plugin = join(root, 'plugins', 'telegram')
const pkg = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string>; telegramCompatibility?: Record<string, string> }
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const manifest = PluginManifestSchema().parse(JSON.parse(await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')))
assertEqual(pkg.name, '@claude-code/telegram-plugin', 'Telegram package identity')
assertEqual(pkg.dependencies?.grammy, '1.45.1', 'grammY exact runtime version')
assert(!rootPackage.dependencies?.grammy && !rootPackage.devDependencies?.grammy, 'grammY must not enter root dependencies')
assertEqual(manifest.name, 'telegram', 'Telegram Plugin identity')
await access(join(plugin, 'host', 'entry.ts'))
for (const key of ['botApi', 'documentation', 'grammy', 'grammyCommit', 'auditedAt']) assert(pkg.telegramCompatibility?.[key], `Telegram compatibility metadata must include ${key}`)
const source = await Promise.all((await readdir(join(root, 'src'), { recursive: true })).filter(file => file.endsWith('.ts')).map(file => readFile(join(root, 'src', file), 'utf8')))
assert(!source.join('\n').includes("from 'grammy'"), 'grammY must not enter root CLI source')
const pluginSource = await Promise.all((await readdir(join(plugin, 'src'))).filter(file => file.endsWith('.ts')).map(file => readFile(join(plugin, 'src', file), 'utf8')))
const combined = pluginSource.join('\n')
for (const forbidden of ['@grammyjs/runner', 'auto-retry', 'webhookCallback']) assert(!combined.includes(forbidden), `Telegram runtime must not contain ${forbidden}`)
const loaded = await createPluginFromPath(plugin, 'telegram@local', true, 'telegram')
const errors = [...loaded.errors]
const raw = await loadPluginMcpServers(loaded.plugin, errors)
const cache = await mkdtemp(join(tmpdir(), 'telegram-plugin-cache-'))
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = cache
const scoped = await extractMcpServersFromPlugins([loaded.plugin], errors).finally(async () => { delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR; await rm(cache, { recursive: true, force: true }) })
assertEqual(errors.length, 0, 'Telegram Plugin lifecycle errors')
assertEqual(Object.keys(raw ?? {}).join(','), 'telegram', 'Telegram raw MCP identity')
assertEqual(scoped['plugin:telegram:telegram']?.type, 'stdio', 'Telegram scoped MCP transport')
assert(isChannelAllowlisted('telegram@local') && !isChannelAllowlisted('telegram@inline'), 'Telegram packaged/development trust boundary')
console.log('[telegram-plugin-boundary] PASS')
