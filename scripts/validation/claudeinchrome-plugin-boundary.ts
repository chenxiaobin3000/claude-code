#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'

const root = resolve(import.meta.dir, '../..')
const pluginRoot = join(root, 'plugins', 'claudeinchrome')
const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')
const extensionManifestPath = join(
  pluginRoot,
  'chrome-extension',
  'manifest.json',
)
const expectedExtensionId = 'dlpofjonbnceelbmpelkfblmnghclmkm'

for (const path of [
  manifestPath,
  extensionManifestPath,
  join(pluginRoot, 'README.md'),
  join(pluginRoot, 'mcp', 'README.md'),
  join(pluginRoot, 'skills', 'README.md'),
  join(pluginRoot, 'native-host', 'README.md'),
]) {
  await access(path)
}

const manifest = PluginManifestSchema().parse(
  JSON.parse(await readFile(manifestPath, 'utf8')),
)
if (manifest.name !== 'claudeinchrome') {
  throw new Error(
    `[claudeinchrome-plugin-boundary] unexpected plugin name: ${manifest.name}`,
  )
}
if (manifest.mcpServers || manifest.skills) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] unaccepted MCP/Skill components were advertised',
  )
}

const extensionManifest = JSON.parse(
  await readFile(extensionManifestPath, 'utf8'),
) as { key?: string; manifest_version?: number }
if (extensionManifest.manifest_version !== 3 || !extensionManifest.key) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] extension must be Manifest V3 with a fixed key',
  )
}
const digest = createHash('sha256')
  .update(Buffer.from(extensionManifest.key, 'base64'))
  .digest()
  .subarray(0, 16)
const extensionId = [...digest]
  .flatMap(byte => [byte >> 4, byte & 15])
  .map(value => String.fromCharCode(97 + value))
  .join('')
if (extensionId !== expectedExtensionId) {
  throw new Error(
    `[claudeinchrome-plugin-boundary] extension ID changed: ${extensionId}`,
  )
}

const removedMainPaths = [
  'src/commands/chrome/chrome.tsx',
  'src/commands/chrome/index.ts',
  'src/components/ClaudeInChromeOnboarding.tsx',
  'src/hooks/useChromeExtensionNotification.tsx',
  'src/hooks/usePromptsFromClaudeInChrome.tsx',
  'src/skills/bundled/claudeInChrome.ts',
]
for (const relative of removedMainPaths) {
  try {
    await access(join(root, relative))
    throw new Error(
      `[claudeinchrome-plugin-boundary] main-tree Chrome entry restored: ${relative}`,
    )
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('[claudeinchrome-plugin-boundary]')
    ) {
      throw error
    }
  }
}

const forbiddenByFile: Record<string, string[]> = {
  'src/entrypoints/cli.tsx': ['--claude-in-chrome-mcp', '--chrome-native-host'],
  'src/cli/arguments/registerRootCommand.ts': [
    ".option('--chrome'",
    ".option('--no-chrome'",
  ],
  'src/cli/modes/defaultMode.tsx': [
    'setupClaudeInChrome',
    'shouldEnableClaudeInChrome',
    'CLAUDE_IN_CHROME_SKILL_HINT',
  ],
  'src/commands.ts': ['./commands/chrome/index.js'],
  'src/skills/bundled/index.ts': [
    'registerClaudeInChromeSkill',
    'shouldAutoEnableClaudeInChrome',
  ],
  'src/services/mcp/client.ts': [
    'isClaudeInChromeMCPServer',
    'claudeInChromeToolRendering',
  ],
  'src/services/mcp/config.ts': ['isClaudeInChromeMCPServer'],
  'src/screens/repl/ReplRuntimeController.tsx': [
    'useChromeExtensionNotification',
    'usePromptsFromClaudeInChrome',
  ],
  'src/utils/config.ts': [
    'claudeInChromeDefaultEnabled',
    'hasCompletedClaudeInChromeOnboarding',
    'cachedChromeExtensionInstalled',
  ],
}

for (const [relative, forbidden] of Object.entries(forbiddenByFile)) {
  const source = await readFile(join(root, relative), 'utf8')
  for (const marker of forbidden) {
    if (source.includes(marker)) {
      throw new Error(
        `[claudeinchrome-plugin-boundary] ${relative} restored main-tree marker ${marker}`,
      )
    }
  }
}

console.log('[claudeinchrome-plugin-boundary] PASS')
