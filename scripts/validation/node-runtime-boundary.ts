#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assert, assertDeepEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const normalize = (path: string) => path.replaceAll('\\', '/')
const source = (path: string) => readFile(resolve(root, path), 'utf8')

type PackageManifest = {
  bin?: Record<string, string>
  dependencies?: Record<string, string>
  engines?: Record<string, string>
  packageManager?: string
  scripts?: Record<string, string>
}

async function matchingPaths(pattern: string): Promise<string[]> {
  const paths: string[] = []
  const glob = new Bun.Glob(pattern)
  for await (const path of glob.scan({
    cwd: root,
    dot: false,
    followSymlinks: false,
    onlyFiles: true,
  })) {
    const normalized = normalize(path)
    if (
      normalized.startsWith('node_modules/') ||
      normalized.startsWith('dist/') ||
      normalized.includes('/node_modules/') ||
      normalized.includes('/dist/') ||
      normalized.startsWith('.git/')
    ) {
      continue
    }
    paths.push(normalized)
  }
  return paths.sort()
}

const packagePaths = await matchingPaths('**/package.json')
const scriptExecutables: string[] = []
const nodeEngines: string[] = []
const nodeBinTargets: string[] = []

for (const path of packagePaths) {
  const manifest = JSON.parse(await source(path)) as PackageManifest
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    const executables = command.matchAll(
      /(?:^|&&|\|\||;)\s*(node(?:\.exe)?|npx)(?=\s|$)/g,
    )
    for (const match of executables) {
      scriptExecutables.push(`${path}#scripts.${name}=${match[1]}`)
    }
  }
  if (manifest.engines?.node) {
    nodeEngines.push(`${path}#engines.node=${manifest.engines.node}`)
  }
  for (const [name, target] of Object.entries(manifest.bin ?? {})) {
    if (target.includes('cli-node.js')) {
      nodeBinTargets.push(`${path}#bin.${name}=${target}`)
    }
  }
}

assertDeepEqual(
  scriptExecutables.sort(),
  [],
  'external Node/npm-family package script inventory changed',
)
assertDeepEqual(
  nodeEngines.sort(),
  [],
  'Node engine contract inventory changed',
)
assertDeepEqual(
  nodeBinTargets.sort(),
  [],
  'Node CLI publication target inventory changed',
)

const codePaths = (
  await Promise.all(
    [
      '*.ts',
      '*.js',
      'scripts/**/*.{ts,js,mjs,cjs}',
      'src/**/*.{ts,tsx,js,mjs,cjs}',
      'packages/**/*.{ts,tsx,js,mjs,cjs}',
      'plugins/**/*.{ts,tsx,js,mjs,cjs}',
    ].map(matchingPaths),
  )
)
  .flat()
  .filter((path, index, all) => all.indexOf(path) === index)
  .sort()

const nodeShebangs: string[] = []
const generatedNodeShebangs: string[] = []
const directNodeSpawns: string[] = []

for (const path of codePaths) {
  const text = await source(path)
  if (/^#!.*\bnode\b/.test(text)) nodeShebangs.push(path)
  if (/['"]#!\/usr\/bin\/env node\\n/.test(text)) {
    generatedNodeShebangs.push(path)
  }
  if (/\[\s*['"]node(?:\.exe)?['"]\s*,/.test(text)) {
    directNodeSpawns.push(path)
  }
}

assertDeepEqual(nodeShebangs, [], 'Node shebang inventory changed')
assertDeepEqual(
  generatedNodeShebangs,
  [],
  'generated Node entrypoint inventory changed',
)
assertDeepEqual(
  directNodeSpawns,
  [],
  'direct Node subprocess inventory changed',
)

const ci = await source('.github/workflows/ci.yml')
assert(
  /uses:\s*actions\/setup-node@/.test(ci) && /node-version:\s*["']?22/.test(ci),
  'CI Node runtime requirement changed without updating its boundary inventory',
)

const rootPackage = JSON.parse(await source('package.json')) as PackageManifest
assert(
  rootPackage.scripts?.postinstall === 'bun scripts/postinstall.cjs' &&
    rootPackage.scripts?.['docs:dev'] === 'bunx --bun mintlify dev',
  'installation and documentation commands must execute directly under Bun',
)
assert(
  rootPackage.scripts?.prepublishOnly ===
    'bun run build:bun && bun run check:bundle',
  'publication must use the Bun bundle chain',
)
assert(
  rootPackage.bin?.ccb === 'dist/cli-bun.js' &&
    rootPackage.bin?.['ccb-bun'] === 'dist/cli-bun.js' &&
    rootPackage.bin?.['claude-code'] === 'dist/cli-bun.js',
  'published CLI names must all use the Bun entrypoint',
)

const acpPackage = JSON.parse(
  await source('packages/acp-link/package.json'),
) as PackageManifest
assertDeepEqual(
  Object.keys(acpPackage.dependencies ?? {})
    .filter(name => name.startsWith('@hono/node-'))
    .sort(),
  [],
  'acp-link Node server adapter inventory changed',
)
assert(
  acpPackage.engines?.bun === '>=1.3.0' &&
    acpPackage.engines?.node === undefined &&
    acpPackage.packageManager === 'bun@1.3.14',
  'acp-link must retain its Bun-only runtime and package-manager contract',
)

const workflowPackage = JSON.parse(
  await source('packages/workflow-engine/package.json'),
) as PackageManifest
assert(
  workflowPackage.engines?.bun === '>=1.3.0' &&
    workflowPackage.engines?.node === undefined &&
    workflowPackage.packageManager === 'bun@1.3.14',
  'workflow-engine must retain its Bun-only runtime and package-manager contract',
)

console.log(
  `[node-runtime-boundary] PASS (${scriptExecutables.length} script calls, ${nodeEngines.length} engine contracts, ${nodeBinTargets.length} Node bin targets, ${nodeShebangs.length} Node shebangs, ${generatedNodeShebangs.length} generated Node entries, ${directNodeSpawns.length} direct Node subprocess)`,
)
