#!/usr/bin/env bun

import { access, readFile, readdir } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import {
  DEFAULT_BUILD_FEATURES,
  FEATURE_POLICY,
  resolveBuildFeatures,
} from '../feature-policy.js'
import { assert } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string): Promise<string> =>
  readFile(resolve(root, path), 'utf8')

const integrationFiles = new Set([
  'CLAUDE.md',
  'README.md',
  'docs/DEVELOPMENT_PLAN.md',
  'package.json',
  'scripts/feature-policy.ts',
  'scripts/validation/dependency-boundary.ts',
  'scripts/validation/computer-use-default-bundle.ts',
  'scripts/verify.ts',
  'src/cli/modes/defaultMode.tsx',
  'src/entrypoints/cli.tsx',
  'src/query.ts',
  'src/query/stopHooks.ts',
  'src/services/analytics/metadata.ts',
  'src/services/mcp/client.ts',
  'src/services/mcp/config.ts',
  'src/state/AppStateStore.ts',
])
const protectedGenericReferences = new Set([
  // OpenAI/Anthropic protocol compatibility and bundled documentation mention
  // the generic upstream computer_use tool type; neither belongs to Chicago.
  'packages/@ant/model-provider/src/shared/openaiConvertTools.ts',
  'packages/builtin-tools/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts',
])

async function walk(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'dist', 'node_modules'].includes(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (
      entry.isFile() &&
      ['.js', '.jsx', '.json', '.md', '.py', '.ts', '.tsx'].includes(
        extname(entry.name),
      )
    ) {
      files.push(path)
    }
  }
  return files
}

const marker =
  /CHICAGO_MCP|computer[-_ ]use|computerUse|mcp__computer-use|--computer-use-mcp|bridge\.py/i
const markerFiles: string[] = []
for (const path of await walk(root)) {
  const projectPath = relative(root, path).replaceAll('\\', '/')
  if (projectPath === 'scripts/validation/computer-use-removal-boundary.ts')
    continue
  if (!marker.test(await readFile(path, 'utf8'))) continue
  markerFiles.push(projectPath)
  assert(
    integrationFiles.has(projectPath) ||
      protectedGenericReferences.has(projectPath),
    `Computer Use marker escaped the frozen removal boundary: ${projectPath}`,
  )
}
assert(markerFiles.length > 0, 'Computer Use inventory unexpectedly empty')

const readme = await source('README.md')
const contributorGuide = await source('CLAUDE.md')
const developmentPlan = await source('docs/DEVELOPMENT_PLAN.md')
for (const [path, contents] of [
  ['README.md', readme],
  ['CLAUDE.md', contributorGuide],
  ['docs/DEVELOPMENT_PLAN.md', developmentPlan],
] as const) {
  assert(
    contents.includes('不提供操作系统桌面 Computer Use'),
    `${path} must state the retired desktop Computer Use boundary`,
  )
}
for (const staleContributorMarker of [
  '@ant/computer-use-input',
  '@ant/computer-use-mcp',
  '@ant/computer-use-swift',
  '--computer-use-mcp',
  'CHICAGO_MCP',
]) {
  assert(
    !contributorGuide.includes(staleContributorMarker),
    `CLAUDE.md still advertises retired surface ${staleContributorMarker}`,
  )
}
for (const requiredBoundary of [
  '独立 `chrome` 插件',
  'Windows Sandbox 只隔离 Bash/PowerShell',
]) {
  assert(
    readme.includes(requiredBoundary) && developmentPlan.includes(requiredBoundary),
    `README and development baseline must preserve boundary: ${requiredBoundary}`,
  )
}

for (const path of [
  'packages/@ant/computer-use-input',
  'packages/@ant/computer-use-mcp',
  'packages/@ant/computer-use-swift',
  'src/components/permissions/ComputerUseApproval',
  'src/utils/computerUse',
]) {
  let implementationFiles: string[] = []
  try {
    implementationFiles = await walk(resolve(root, path))
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    ) {
      throw error
    }
    // A missing directory is the expected persisted repository state. Empty
    // directories may remain in a local worktree because Git does not track them.
  }
  assert(
    implementationFiles.length === 0,
    `retired Computer Use implementation remains: ${path}`,
  )
}
let withResolversExists = true
try {
  await access(resolve(root, 'src/utils/withResolvers.ts'))
} catch {
  withResolversExists = false
}
assert(
  !withResolversExists,
  'retired Computer Use-only withResolvers helper remains',
)

const rootManifestSource = await source('package.json')
const lockfileSource = await source('bun.lock')
for (const packageName of [
  '@ant/computer-use-input',
  '@ant/computer-use-mcp',
  '@ant/computer-use-swift',
]) {
  assert(
    !rootManifestSource.includes(packageName),
    `retired root workspace dependency remains: ${packageName}`,
  )
  assert(
    !lockfileSource.includes(packageName),
    `retired lockfile workspace dependency remains: ${packageName}`,
  )
}

const rootManifest = JSON.parse(rootManifestSource) as { workspaces?: string[] }
const workspaceManifests = new Set<string>()
for (const pattern of rootManifest.workspaces ?? []) {
  const glob = new Bun.Glob(`${pattern.replaceAll('\\', '/')}/package.json`)
  for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
    workspaceManifests.add(path)
  }
}
assert(
  workspaceManifests.size === 19,
  `expected 19 workspaces after Computer Use removal, found ${workspaceManifests.size}`,
)

assert(
  !DEFAULT_BUILD_FEATURES.includes('CHICAGO_MCP'),
  'CHICAGO_MCP must be unreachable in the default build',
)
assert(
  !resolveBuildFeatures({}).includes('CHICAGO_MCP'),
  'empty build environment enabled CHICAGO_MCP',
)
assert(
  !FEATURE_POLICY.CHICAGO_MCP,
  'retired CHICAGO_MCP feature must not remain classified or enableable',
)
let retiredFeatureRejected = false
try {
  resolveBuildFeatures({
    ALLOW_INTERNAL_FEATURES: '1',
    FEATURE_CHICAGO_MCP: '1',
  })
} catch (error) {
  retiredFeatureRejected =
    error instanceof Error && error.message.includes('Unknown feature flag')
}
assert(
  retiredFeatureRejected,
  'FEATURE_CHICAGO_MCP must be rejected instead of silently ignored or enabled',
)

const productEntryMarkers: Record<string, readonly string[]> = {
  'src/entrypoints/cli.tsx': [
    '--computer-use-mcp',
    'runComputerUseMcpServer',
  ],
  'src/cli/modes/defaultMode.tsx': [
    'setupComputerUseMCP',
    'COMPUTER_USE_MCP_SERVER_NAME',
    'isComputerUseMCPServer',
  ],
  'src/services/mcp/client.ts': [
    'createComputerUseMcpServerForCli',
    'getComputerUseMCPToolOverrides',
    'isComputerUseMCPServer',
  ],
  'src/services/mcp/config.ts': [
    'COMPUTER_USE_MCP_SERVER_NAME',
    'DEFAULT_DISABLED_BUILTINS',
    'isComputerUseMCPServer',
  ],
  'src/services/analytics/metadata.ts': [
    'BUILTIN_MCP_SERVER_NAMES',
    'COMPUTER_USE_MCP_SERVER_NAME',
  ],
}
for (const [path, forbiddenMarkers] of Object.entries(productEntryMarkers)) {
  const contents = await source(path)
  for (const forbiddenMarker of forbiddenMarkers) {
    assert(
      !contents.includes(forbiddenMarker),
      `retired product entry remains in ${path}: ${forbiddenMarker}`,
    )
  }
}

const retiredCoreMarkers: Record<string, readonly string[]> = {
  'src/query.ts': ['cleanupComputerUseAfterTurn', './utils/computerUse/'],
  'src/query/stopHooks.ts': [
    'cleanupComputerUseAfterTurn',
    '../utils/computerUse/',
  ],
  'src/state/AppStateStore.ts': ['computerUseMcpState', 'computer-use-mcp'],
}
for (const [path, forbiddenMarkers] of Object.entries(retiredCoreMarkers)) {
  const contents = await source(path)
  for (const forbiddenMarker of forbiddenMarkers) {
    assert(
      !contents.includes(forbiddenMarker),
      `retired core integration remains in ${path}: ${forbiddenMarker}`,
    )
  }
}

for (const path of await walk(resolve(root, 'src'))) {
  assert(
    !(await readFile(path, 'utf8')).includes('CHICAGO_MCP'),
    `retired CHICAGO_MCP source reference remains: ${relative(root, path)}`,
  )
}

const protectedFiles: Record<string, readonly string[]> = {
  'src/services/mcp/client.ts': [
    'StdioClientTransport',
    'connectToServer',
    "serverRef.type === 'sse'",
    "serverRef.type === 'http'",
  ],
  'src/services/mcp/config.ts': [
    "case 'stdio'",
    "case 'sse'",
    "case 'http'",
    'dedupPluginMcpServers',
  ],
  'src/query.ts': [
    'executePostSamplingHooks',
    'executeStopFailureHooks',
    'handleStopHooks',
    'runTools(',
  ],
  'src/query/stopHooks.ts': ['export async function* handleStopHooks'],
  'src/components/permissions/PermissionRequest.tsx': [
    'FallbackPermissionRequest',
    'FileWritePermissionRequest',
    'BashPermissionRequest',
    'PowerShellPermissionRequest',
  ],
  'scripts/validation/chrome-plugin-boundary.ts': [
    '[chrome-plugin-boundary] PASS',
    'plugins/chrome',
  ],
  'scripts/validation/windows-sandbox.ts': [
    'buildWindowsSandboxConfiguration',
    'Windows Sandbox validation passed.',
  ],
  'scripts/verify-workspaces.ts': [
    'function checkContract(',
    'missing scripts.typecheck',
    'missing scripts.test or scripts.test:smoke',
  ],
}
for (const [path, requiredMarkers] of Object.entries(protectedFiles)) {
  const contents = await source(path)
  for (const requiredMarker of requiredMarkers) {
    assert(
      contents.includes(requiredMarker),
      `protected ${path} baseline lost ${requiredMarker}`,
    )
  }
}

for (const path of [
  'plugins/chrome/.claude-plugin/plugin.json',
  'packages/acp-link/package.json',
  'packages/builtin-tools/package.json',
  'packages/mcp-client/package.json',
  'packages/workflow-engine/package.json',
  'src/utils/sandbox/windowsSandboxProtocol.ts',
]) {
  await access(resolve(root, path))
}

console.log(
  `[computer-use-removal-boundary] PASS (${markerFiles.length} inventoried files; runtime and 3 workspaces removed, 19 workspaces remain)`,
)
