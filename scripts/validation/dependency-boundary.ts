#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assert, assertDeepEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(resolve(root, path), 'utf8')
const pkg = JSON.parse(await source('package.json')) as {
  scripts: Record<string, string>
  files: string[]
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const gitignore = await source('.gitignore')
assert(
  /^!bun\.lock$/m.test(gitignore),
  'bun.lock must be committed for frozen installs',
)

const productionDependencies = Object.keys(pkg.dependencies).sort()
assertDeepEqual(
  productionDependencies,
  ['fflate', 'undici'],
  'production dependency allowlist',
)

for (const bundled of ['@agentclientprotocol/sdk', 'highlight.js']) {
  assert(
    bundled in pkg.devDependencies && !(bundled in pkg.dependencies),
    `${bundled} must remain a bundled build input`,
  )
}
assert(
  pkg.dependencies.ws === undefined && pkg.devDependencies.ws === undefined,
  'root ws dependency must stay removed with the Bun-native WebSocket paths',
)

assert(
  pkg.devDependencies['@claude-code/workflow-engine'] === 'workspace:*',
  'root workflow-engine import must be declared',
)

for (const removed of [
  '@claude-code/mcp-chrome-bridge',
  '@smithy/core',
  '@types/sharp',
  '@types/shell-quote',
  'husky',
  'lint-staged',
]) {
  assert(
    !(removed in pkg.dependencies) && !(removed in pkg.devDependencies),
    `${removed} must not return as a direct root dependency`,
  )
}

assert(
  !('prepare' in pkg.scripts),
  'empty Git-hook prepare lifecycle must stay removed',
)
assert(
  !pkg.files.includes('src'),
  'published package must use bundled source only',
)

const bunBuild = await source('build.ts')
const exeBuild = await source('scripts/build-exe.ts')
const defaultMode = await source('src/cli/modes/defaultMode.tsx')
const mcpConfig = await source('src/services/mcp/config.ts')
assert(
  !/\bexternal\s*:/.test(bunBuild),
  'Bun bundle must not externalize packages',
)
assert(
  !/\bexternal\s*:/.test(exeBuild),
  'standalone EXE must not externalize packages',
)
for (const removedBuildDependency of ['rollup', 'vite']) {
  assert(
    !(removedBuildDependency in pkg.devDependencies),
    `root ${removedBuildDependency} dependency must stay removed with the Node bundle`,
  )
}
for (const removedBuildScript of ['build:vite', 'build:vite:only']) {
  assert(
    !(removedBuildScript in pkg.scripts),
    `${removedBuildScript} must stay removed with the Node bundle`,
  )
}
assert(
  pkg.scripts.prepublishOnly === 'bun run build:bun && bun run check:bundle',
  'publication must build and validate the Bun bundle',
)

const postinstall = await source('scripts/postinstall.cjs')
assert(
  pkg.scripts.postinstall === 'bun scripts/postinstall.cjs',
  'dependency install must run directly under Bun without mutating or validating the user Chrome registration',
)
assert(
  !pkg.files.includes('scripts/setup-chrome-mcp.mjs'),
  'removed third-party Chrome MCP setup script must not be published',
)
assert(
  !defaultMode.includes('mcp-chrome') && !mcpConfig.includes('mcp-chrome'),
  'removed mcp-chrome server must not return to default MCP configuration',
)
for (const dependency of ['fflate', 'undici']) {
  assert(
    postinstall.includes(`require('${dependency}')`),
    `${dependency} must have a published-script consumer`,
  )
}

console.log('[dependency-boundary] PASS')
