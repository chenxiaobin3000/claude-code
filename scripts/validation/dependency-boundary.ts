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
  ['@claude-code-best/mcp-chrome-bridge', 'fflate', 'undici', 'ws'],
  'production dependency allowlist',
)

for (const bundled of ['@agentclientprotocol/sdk', 'highlight.js']) {
  assert(
    bundled in pkg.devDependencies && !(bundled in pkg.dependencies),
    `${bundled} must remain a bundled build input`,
  )
}
assert(
  pkg.dependencies.ws !== undefined && pkg.devDependencies.ws === undefined,
  'ws must remain available to residual dynamic imports in production bundles',
)

assert(
  pkg.devDependencies['@claude-code-best/workflow-engine'] === 'workspace:*',
  'root workflow-engine import must be declared',
)

for (const removed of [
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
const viteBuild = await source('vite.config.ts')
assert(
  !/\bexternal\s*:/.test(bunBuild),
  'Bun bundle must not externalize packages',
)
assert(
  !/\bexternal\s*:/.test(exeBuild),
  'standalone EXE must not externalize packages',
)
assert(
  /noExternal:\s*true/.test(viteBuild),
  'Vite Node bundle must include dependencies',
)

const setupScript = await source('scripts/setup-chrome-mcp.mjs')
const postinstall = await source('scripts/postinstall.cjs')
assert(
  setupScript.includes("'@claude-code-best/mcp-chrome-bridge/dist/cli.js'"),
  'Chrome MCP install consumer must remain explicit',
)
for (const dependency of ['fflate', 'undici']) {
  assert(
    postinstall.includes(`require('${dependency}')`),
    `${dependency} must have a published-script consumer`,
  )
}

console.log('[dependency-boundary] PASS')
