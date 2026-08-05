#!/usr/bin/env bun
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  extractMcpServersFromPlugins,
  loadPluginMcpServers,
} from '../../src/utils/plugins/mcpPluginIntegration.js'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const plugin = join(root, 'plugins', 'x')
const pkg = JSON.parse(
  await readFile(join(plugin, 'package.json'), 'utf8'),
) as {
  name: string
  dependencies?: Record<string, string>
  xCompatibility?: Record<string, string>
}
const rootPackage = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const manifest = PluginManifestSchema().parse(
  JSON.parse(
    await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'),
  ),
)
assertEqual(pkg.name, '@claude-code/x-plugin', 'package identity')
assert(
  !pkg.dependencies?.['@xdevplatform/xdk'] &&
    !rootPackage.dependencies?.['@xdevplatform/xdk'] &&
    !rootPackage.devDependencies?.['@xdevplatform/xdk'],
  'XDK excluded from production dependencies after transport probe failure',
)
assertEqual(manifest.name, 'x', 'Plugin identity')
await access(join(plugin, 'host', 'entry.ts'))
for (const key of [
  'xdk',
  'xdkCommit',
  'apiDocumentation',
  'authenticationDocumentation',
  'rateLimitDocumentation',
  'auditedAt',
])
  assert(pkg.xCompatibility?.[key], `compatibility metadata includes ${key}`)

const rootSources = await Promise.all(
  (await readdir(join(root, 'src'), { recursive: true }))
    .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
    .map(file => readFile(join(root, 'src', file), 'utf8')),
)
assert(
  !rootSources.join('\n').includes('@xdevplatform/xdk'),
  'XDK excluded from root CLI source',
)
const pluginSources = await Promise.all(
  (await readdir(join(plugin, 'src')))
    .filter(file => file.endsWith('.ts'))
    .map(file => readFile(join(plugin, 'src', file), 'utf8')),
)
const combined = pluginSources.join('\n')
for (const tool of [
  'x_get_post',
  'x_get_thread',
  'x_get_user',
  'x_get_user_posts',
  'x_search_recent',
  'x_get_mentions',
])
  assert(combined.includes(`name: '${tool}'`), `runtime exposes ${tool}`)
for (const tool of [
  'x_create_post',
  'x_delete_post',
  'x_like_post',
  'x_repost',
  'x_follow_user',
  'x_send_message',
])
  assert(!combined.includes(`name: '${tool}'`), `runtime excludes ${tool}`)
for (const forbidden of [
  'OAuth1',
  'OAuth2',
  '.delete(',
  '.create(',
  '.repostPost(',
  '.stream.',
  'setInterval(',
])
  assert(!combined.includes(forbidden), `runtime excludes ${forbidden}`)

const loaded = await createPluginFromPath(plugin, 'x@local', true, 'x')
const errors = [...loaded.errors]
const raw = await loadPluginMcpServers(loaded.plugin, errors)
const cache = await mkdtemp(join(tmpdir(), 'x-plugin-cache-'))
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = cache
const scoped = await extractMcpServersFromPlugins(
  [loaded.plugin],
  errors,
).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(cache, { recursive: true, force: true })
})
assertEqual(errors.length, 0, 'Plugin lifecycle errors')
assertEqual(Object.keys(raw ?? {}).join(','), 'x', 'raw MCP identity')
assertEqual(scoped['plugin:x:x']?.type, 'stdio', 'scoped MCP transport')
console.log('[x-plugin-boundary] PASS')
