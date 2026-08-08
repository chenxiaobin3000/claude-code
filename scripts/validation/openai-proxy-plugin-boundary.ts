#!/usr/bin/env bun
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  extractMcpServersFromPlugins,
  loadPluginMcpServers,
} from '../../src/utils/plugins/mcpPluginIntegration.js'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const plugin = join(root, 'plugins', 'openai-proxy')
const pkg = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')) as {
  name: string
}
const manifest = PluginManifestSchema().parse(
  JSON.parse(
    await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'),
  ),
)
assertEqual(
  pkg.name,
  '@claude-code/openai-proxy-plugin',
  'workspace identity',
)
assertEqual(manifest.name, 'openai-proxy', 'Plugin identity')
await access(join(plugin, 'host', 'entry.ts'))

const files = await readdir(plugin, { recursive: true })
for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  assert(!normalized.endsWith('.rs'), `Rust source is forbidden: ${normalized}`)
  assert(
    !/(^|\/)Cargo\.(toml|lock)$/.test(normalized),
    `Cargo metadata is forbidden: ${normalized}`,
  )
}
const authSources = await Promise.all(
  files
    .filter(file => file.startsWith(`src${sep}auth`) && file.endsWith('.ts'))
    .map(file => readFile(join(plugin, file), 'utf8')),
)
assert(
  !authSources.join('\n').includes(".codex/auth.json"),
  'Plugin auth source must not read the Codex credential store',
)

const loaded = await createPluginFromPath(
  plugin,
  'openai-proxy@local',
  true,
  'openai-proxy',
)
const errors = [...loaded.errors]
const raw = await loadPluginMcpServers(loaded.plugin, errors)
const cache = await mkdtemp(join(tmpdir(), 'openai-proxy-plugin-cache-'))
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = cache
const scoped = await extractMcpServersFromPlugins(
  [loaded.plugin],
  errors,
).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(cache, { recursive: true, force: true })
})
assertEqual(errors.length, 0, 'Plugin lifecycle errors')
assertEqual(
  Object.keys(raw ?? {}).join(','),
  'openai-proxy',
  'raw MCP identity',
)
assertEqual(
  scoped['plugin:openai-proxy:openai-proxy']?.type,
  'stdio',
  'scoped MCP transport',
)

const rootSources = await Promise.all(
  (await readdir(join(root, 'src'), { recursive: true }))
    .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
    .map(file => readFile(join(root, 'src', file), 'utf8')),
)
assert(
  !rootSources.join('\n').includes('openai-proxy-host'),
  'root model/runtime source must not statically depend on the optional Host',
)
console.log('[openai-proxy-plugin-boundary] PASS')
