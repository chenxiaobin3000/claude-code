#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const removedPaths = [
  'packages/cloud-artifacts',
  'packages/builtin-tools/src/tools/ArtifactTool',
  'packages/builtin-tools/src/tools/ReviewArtifactTool',
  'src/commands/artifacts',
  'src/components/permissions/ReviewArtifactPermissionRequest',
  'src/skills/bundled/useArtifacts.ts',
]

for (const path of removedPaths) {
  try {
    await access(join(root, path))
    throw new Error(`[artifact-boundary] removed path was restored: ${path}`)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('[artifact-boundary]')
    )
      throw error
  }
}

const scanRoots = ['src', 'packages/builtin-tools', 'scripts']
const forbidden = [
  'cloud-artifacts.claude-code-best.win',
  'CLAUDE_ARTIFACTS_TOKEN',
  'CLAUDE_ARTIFACTS_URL',
  'ARTIFACTS_DEFAULT_TOKEN',
  'ARTIFACTS_DEFAULT_URL',
  'ArtifactTool',
  'ReviewArtifact',
  'REVIEW_ARTIFACT',
  'registerUseArtifactsSkill',
  "name: 'use-artifacts'",
  "name: 'artifacts'",
  'unpkg.com/mermaid',
  'unpkg.com/@highlightjs/cdn-assets',
]

for (const scanRoot of scanRoots) {
  const glob = new Bun.Glob(
    '**/*.{ts,tsx,js,mjs,cjs,json,jsonc,toml,md,html,sh}',
  )
  for await (const relativePath of glob.scan({
    cwd: join(root, scanRoot),
    onlyFiles: true,
  })) {
    const path = `${scanRoot}/${relativePath}`.replaceAll('\\', '/')
    if (
      path === 'scripts/validation/artifact-boundary.ts' ||
      path === 'scripts/removed-cloud-markers.ts' ||
      path === 'scripts/check-bundle-integrity.ts'
    )
      continue
    const text = await readFile(join(root, path), 'utf8')
    for (const marker of forbidden) {
      if (text.includes(marker)) {
        throw new Error(
          `[artifact-boundary] ${path} contains removed Artifact marker: ${marker}`,
        )
      }
    }
  }
}

console.log('[artifact-boundary] PASS')
