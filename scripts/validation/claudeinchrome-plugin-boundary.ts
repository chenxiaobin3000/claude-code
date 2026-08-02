#!/usr/bin/env bun

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PluginManifestSchema } from '../../src/utils/plugins/schemas.js'
import { createPluginFromPath } from '../../src/utils/plugins/pluginLoader.js'
import {
  extractMcpServersFromPlugins,
  loadPluginMcpServers,
} from '../../src/utils/plugins/mcpPluginIntegration.js'
import { parseFrontmatter } from '../../src/utils/frontmatterParser.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../src/utils/markdownConfigLoader.js'
import { buildMcpToolName } from '../../src/services/mcp/mcpStringUtils.js'
import { IMPLEMENTED_CHROME_TOOL_NAMES } from '../../plugins/chrome/protocol/index.js'

const root = resolve(import.meta.dir, '../..')
const pluginRoot = join(root, 'plugins', 'chrome')
const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')
const sourceHostArgument = '$' + '{CLAUDE_PLUGIN_ROOT}/host/entry.ts'
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
  join(pluginRoot, 'skills', 'claude-in-chrome', 'SKILL.md'),
  join(pluginRoot, 'protocol', 'index.ts'),
  join(pluginRoot, 'host', 'entry.ts'),
  join(pluginRoot, 'host', 'mcpServer.ts'),
  join(pluginRoot, 'host', 'nativeHost.ts'),
  join(pluginRoot, 'host', 'paths.ts'),
  join(pluginRoot, 'host', 'registration.ts'),
  join(pluginRoot, 'mcp', 'index.ts'),
  join(pluginRoot, 'mcp', 'mcpServer.ts'),
  join(pluginRoot, 'mcp', 'mcpSocketClient.ts'),
]) {
  await access(path)
}

try {
  await access(join(root, 'plugins', 'claudeinchrome'))
  throw new Error(
    '[claudeinchrome-plugin-boundary] legacy claudeinchrome Plugin directory still exists',
  )
} catch (error) {
  if (
    error instanceof Error &&
    error.message.startsWith('[claudeinchrome-plugin-boundary]')
  ) {
    throw error
  }
}

const manifest = PluginManifestSchema().parse(
  JSON.parse(await readFile(manifestPath, 'utf8')),
)
if (manifest.name !== 'chrome') {
  throw new Error(
    `[claudeinchrome-plugin-boundary] unexpected plugin name: ${manifest.name}`,
  )
}
const mcpSpec = manifest.mcpServers
if (
  !mcpSpec ||
  typeof mcpSpec === 'string' ||
  Array.isArray(mcpSpec) ||
  !('claude-in-chrome' in mcpSpec)
) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] standard claude-in-chrome MCP server is missing',
  )
}
const declaredServer = mcpSpec['claude-in-chrome']
if (
  declaredServer.type !== 'stdio' ||
  declaredServer.command !== 'bun' ||
  !declaredServer.args.includes(sourceHostArgument) ||
  declaredServer.args.at(-1) !== 'mcp'
) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] source plugin MCP entry is not the local Host development entry',
  )
}
if (manifest.skills) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] standard skills/ discovery must not be duplicated in manifest.skills',
  )
}

const loaded = await createPluginFromPath(
  pluginRoot,
  'chrome@local',
  true,
  'chrome',
)
if (loaded.errors.length > 0 || !loaded.plugin.skillsPath) {
  throw new Error(
    `[claudeinchrome-plugin-boundary] plugin lifecycle load failed: ${JSON.stringify(loaded.errors)}`,
  )
}
const loadErrors: Parameters<typeof loadPluginMcpServers>[1] = []
const rawServers = await loadPluginMcpServers(loaded.plugin, loadErrors)
if (
  loadErrors.length > 0 ||
  Object.keys(rawServers ?? {}).join(',') !== 'claude-in-chrome'
) {
  throw new Error(
    `[claudeinchrome-plugin-boundary] plugin MCP load failed: ${JSON.stringify(loadErrors)}`,
  )
}
const pluginCache = await mkdtemp(
  join(tmpdir(), 'claudeinchrome-plugin-cache-'),
)
process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginCache
const scopedServers = await extractMcpServersFromPlugins(
  [loaded.plugin],
  loadErrors,
).finally(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  await rm(pluginCache, { recursive: true, force: true })
})
const scopedServer = scopedServers['plugin:chrome:claude-in-chrome']
if (
  !scopedServer ||
  scopedServer.type !== 'stdio' ||
  resolve(scopedServer.args?.[0] ?? '') !==
    resolve(pluginRoot, 'host', 'entry.ts')
) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] plugin MCP environment was not resolved inside the plugin root',
  )
}
const skillSource = await readFile(
  join(pluginRoot, 'skills', 'claude-in-chrome', 'SKILL.md'),
  'utf8',
)
const skill = parseFrontmatter(
  skillSource,
  join(pluginRoot, 'skills', 'claude-in-chrome', 'SKILL.md'),
)
const skillTools = parseSlashCommandToolsFromFrontmatter(
  skill.frontmatter['allowed-tools'],
)
const expectedSkillTools = [...IMPLEMENTED_CHROME_TOOL_NAMES]
  .map(name => buildMcpToolName('plugin:chrome:claude-in-chrome', name))
  .sort()
if (
  skill.frontmatter.name !== 'claude-in-chrome' ||
  JSON.stringify([...skillTools].sort()) !== JSON.stringify(expectedSkillTools)
) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] Chrome Skill permissions do not exactly match its scoped MCP tools',
  )
}

const extensionManifest = JSON.parse(
  await readFile(extensionManifestPath, 'utf8'),
) as {
  host_permissions?: string[]
  key?: string
  manifest_version?: number
  permissions?: string[]
  optional_host_permissions?: string[]
}
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
  'src/utils/claudeInChrome/chromeNativeHost.ts',
  'src/utils/claudeInChrome/common.ts',
  'src/utils/claudeInChrome/mcpServer.ts',
  'src/utils/claudeInChrome/prompt.ts',
  'src/utils/claudeInChrome/setup.ts',
  'src/utils/claudeInChrome/setupPortable.ts',
  'src/utils/claudeInChrome/toolRendering.tsx',
  'packages/@ant/claude-for-chrome-mcp/package.json',
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
if (
  extensionManifest.permissions?.includes('activeTab') ||
  JSON.stringify(extensionManifest.permissions) !==
    JSON.stringify([
      'nativeMessaging',
      'storage',
      'tabs',
      'scripting',
      'windows',
    ]) ||
  JSON.stringify(extensionManifest.host_permissions) !==
    JSON.stringify(['<all_urls>']) ||
  extensionManifest.optional_host_permissions !== undefined
) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] browser Host access must remain fixed to all pages without a local authorization layer',
  )
}
const extensionSource = await readFile(
  join(pluginRoot, 'chrome-extension', 'background.js'),
  'utf8',
)
const screenshotStart = extensionSource.indexOf(
  'async function executeComputer(args)',
)
const screenshotEnd = extensionSource.indexOf(
  "return success(await sendPageMessage(args.tabId, 'computer', args))",
  screenshotStart,
)
const screenshotSource = extensionSource.slice(screenshotStart, screenshotEnd)
for (const marker of [
  'await assertTabAllowed(args.tabId)',
  'await chrome.tabs.update(tab.id, { active: true })',
  'chrome.tabs.captureVisibleTab(tab.windowId',
]) {
  if (!screenshotSource.includes(marker)) {
    throw new Error(
      `[claudeinchrome-plugin-boundary] screenshot boundary is missing: ${marker}`,
    )
  }
}
for (const marker of [
  'MAX_BRIDGE_MESSAGE_BYTES',
  'new TextEncoder().encode(JSON.stringify(message)).byteLength',
  'Chrome tool result exceeds the $' +
    '{MAX_BRIDGE_MESSAGE_BYTES}-byte bridge limit.',
  'pageNavigation?.canGoBack',
  'pageNavigation?.canGoForward',
]) {
  if (!extensionSource.includes(marker)) {
    throw new Error(
      `[claudeinchrome-plugin-boundary] bridge recovery boundary is missing: ${marker}`,
    )
  }
}
const contentSource = await readFile(
  join(pluginRoot, 'chrome-extension', 'content.js'),
  'utf8',
)
if (!contentSource.includes('element.focus({ preventScroll: true })')) {
  throw new Error(
    '[claudeinchrome-plugin-boundary] computer click must preserve browser focus semantics',
  )
}
const popupSource = await readFile(
  join(pluginRoot, 'chrome-extension', 'popup.js'),
  'utf8',
)
for (const marker of [
  'allowedOrigins',
  'allowAllSites',
  'chrome.permissions.',
]) {
  if (popupSource.includes(marker) || extensionSource.includes(marker)) {
    throw new Error(
      `[claudeinchrome-plugin-boundary] removed page authorization marker was restored: ${marker}`,
    )
  }
}
for (const marker of [
  "const PROFILE_STORAGE_KEY = 'claudeinchromeProfile'",
  'chrome.storage.local.get(PROFILE_STORAGE_KEY)',
  'chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profileIdentity })',
]) {
  if (!extensionSource.includes(marker)) {
    throw new Error(
      `[claudeinchrome-plugin-boundary] profile-local identity storage is missing: ${marker}`,
    )
  }
}

console.log('[claudeinchrome-plugin-boundary] PASS')
