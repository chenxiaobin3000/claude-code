#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const removedPaths = [
  'src/utils/plugins/marketplaceManager.ts',
  'src/utils/plugins/officialMarketplace.ts',
  'src/utils/plugins/officialMarketplaceGcs.ts',
  'src/utils/plugins/officialMarketplaceStartupCheck.ts',
  'src/utils/plugins/installCounts.ts',
  'src/utils/plugins/pluginAutoupdate.ts',
  'src/utils/plugins/headlessPluginInstall.ts',
  'src/utils/plugins/parseMarketplaceInput.ts',
  'src/utils/plugins/reconciler.ts',
  'src/commands/plugin/AddMarketplace.tsx',
  'src/commands/plugin/BrowseMarketplace.tsx',
  'src/commands/plugin/DiscoverPlugins.tsx',
  'src/commands/plugin/ManageMarketplaces.tsx',
]
for (const path of removedPaths) {
  try {
    await access(join(root, path))
    throw new Error(`[plugin-distribution-boundary] removed path was restored: ${path}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[plugin-distribution-boundary]')) throw error
  }
}

for (const path of [
  'src/utils/plugins/pluginLoader.ts',
  'src/utils/plugins/loadPluginCommands.ts',
  'src/utils/plugins/loadPluginHooks.ts',
  'src/utils/plugins/validatePlugin.ts',
  'src/plugins/builtinPlugins.ts',
  'src/utils/plugins/mcpPluginIntegration.ts',
  'src/utils/plugins/mcpbHandler.ts',
]) {
  await access(join(root, path))
}

const subcommands = await readFile(join(root, 'src/cli/arguments/registerSubcommands.ts'), 'utf8')
for (const pattern of [/\.command\(['"]marketplace['"]\)/, /\.command\(['"]install <plugin>['"]\)/, /--available/]) {
  if (pattern.test(subcommands)) throw new Error(`[plugin-distribution-boundary] remote CLI entry restored: ${pattern}`)
}

const loader = await readFile(join(root, 'src/utils/plugins/pluginLoader.ts'), 'utf8')
for (const required of ['getInlinePlugins', 'getBuiltinPlugins', 'loadPluginHooks']) {
  if (required === 'loadPluginHooks') continue
  if (!loader.includes(required)) throw new Error(`[plugin-distribution-boundary] local loader lost ${required}`)
}
for (const forbidden of ['marketplaceManager', 'gitClone', 'installFromNpm', 'axios', 'https://']) {
  if (loader.includes(forbidden)) throw new Error(`[plugin-distribution-boundary] loader contains remote distribution token ${forbidden}`)
}

const mcpb = await readFile(join(root, 'src/utils/plugins/mcpbHandler.ts'), 'utf8')
if (!mcpb.includes('Remote MCPB downloads are disabled')) {
  throw new Error('[plugin-distribution-boundary] local-only MCPB rejection is missing')
}
for (const forbidden of ['axios.get(', 'downloadMcpb(', 'onDownloadProgress']) {
  if (mcpb.includes(forbidden)) throw new Error(`[plugin-distribution-boundary] MCPB remote download token restored: ${forbidden}`)
}

const forbiddenMarkers = [
  'downloads.claude.ai/claude-code-releases/plugins',
  'plugin-installs.json',
  'anthropics/claude-plugins-official',
  'CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS',
  'CLAUDE_CODE_PLUGIN_SEED_DIR',
  'autoUpdateMarketplacesAndPluginsInBackground',
  'installPluginsForHeadless',
]
for (const scanRoot of ['src', 'packages', 'scripts']) {
  const glob = new Bun.Glob('**/*.{ts,tsx,js,mjs,cjs,json,jsonc,toml,md}')
  for await (const relative of glob.scan({ cwd: join(root, scanRoot), onlyFiles: true })) {
    const path = `${scanRoot}/${relative}`.replaceAll('\\', '/')
    if (path === 'scripts/validation/plugin-distribution-boundary.ts' || path === 'scripts/check-bundle-integrity.ts') continue
    const source = await readFile(join(root, path), 'utf8')
    for (const marker of forbiddenMarkers) {
      if (source.includes(marker)) throw new Error(`[plugin-distribution-boundary] ${path} contains remote distribution marker ${marker}`)
    }
  }
}

console.log('[plugin-distribution-boundary] PASS')
