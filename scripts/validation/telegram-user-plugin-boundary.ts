#!/usr/bin/env bun
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isChannelAllowlisted } from '../../src/services/mcp/channelAllowlist.js'
import { extractMcpServersFromPlugins, loadPluginMcpServers } from '../../src/utils/plugins/mcpPluginIntegration.js'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { assert, assertEqual } from './assertions.js'
const root = resolve(import.meta.dir, '..', '..'); const plugin = join(root, 'plugins', 'telegram-user')
const pkg = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string>; telegramUserCompatibility?: Record<string, string> }
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const manifest = PluginManifestSchema().parse(JSON.parse(await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')))
assertEqual(pkg.name, '@claude-code/telegram-user-plugin', 'package identity'); assertEqual(pkg.dependencies?.telegram, '2.26.22', 'GramJS exact runtime version'); assert(!rootPackage.dependencies?.telegram && !rootPackage.devDependencies?.telegram, 'GramJS excluded from root dependencies'); assertEqual(manifest.name, 'telegram-user', 'Plugin identity'); await access(join(plugin, 'host', 'entry.ts'))
for (const key of ['gramjs', 'gramjsCommit', 'mtprotoDocumentation', 'authorizationDocumentation', 'auditedAt']) assert(pkg.telegramUserCompatibility?.[key], `compatibility metadata includes ${key}`)
const rootSources = await Promise.all((await readdir(join(root, 'src'), { recursive: true })).filter(file => file.endsWith('.ts') || file.endsWith('.tsx')).map(file => readFile(join(root, 'src', file), 'utf8'))); assert(!rootSources.join('\n').includes("from 'telegram'"), 'GramJS excluded from root CLI source')
const pluginSources = await Promise.all((await readdir(join(plugin, 'src'))).filter(file => file.endsWith('.ts')).map(file => readFile(join(plugin, 'src', file), 'utf8'))); const combined = pluginSources.join('\n')
for (const forbidden of ['grammy', 'Telethon', 'child_process', 'contacts.ImportContacts', 'channels.JoinChannel', 'messages.DeleteMessages']) assert(!combined.includes(forbidden), `runtime excludes ${forbidden}`)
const loaded = await createPluginFromPath(plugin, 'telegram-user@local', true, 'telegram-user'); const errors = [...loaded.errors]; const raw = await loadPluginMcpServers(loaded.plugin, errors); const cache = await mkdtemp(join(tmpdir(), 'telegram-user-cache-')); process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = cache
const scoped = await extractMcpServersFromPlugins([loaded.plugin], errors).finally(async () => { delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR; await rm(cache, { recursive: true, force: true }) })
assertEqual(errors.length, 0, 'Plugin lifecycle errors'); assertEqual(Object.keys(raw ?? {}).sort().join(','), 'telegram-user-control', 'raw MCP identities'); assertEqual(scoped['plugin:telegram-user:telegram-user-control']?.type, 'stdio', 'scoped control MCP transport'); assert(!scoped['plugin:telegram-user:telegram-user'], 'realtime Channel MCP is absent'); assert(!isChannelAllowlisted('telegram-user@local'), 'history-only plugin is not a trusted Channel')
console.log('[telegram-user-plugin-boundary] PASS')
