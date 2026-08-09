import { writeFile, cp } from 'fs/promises'
import { join } from 'path'
import { getMacroDefines } from './scripts/defines.ts'
import { resolveBuildFeatures } from './scripts/defines.ts'

const outdir = 'dist'

// Step 1: Clean output directory
const { rmSync } = await import('fs')
rmSync(outdir, { recursive: true, force: true })

const features = resolveBuildFeatures()

// Step 2: Bundle with splitting
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'bun',
  splitting: true,
  sourcemap: 'linked',
  define: {
    ...getMacroDefines(),
    // React production mode — eliminates _debugStack Error objects
    // (6,889 objects × ~1.7KB = 12MB in development builds) and removes
    // prop-type / key warnings not useful in a production CLI tool.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log(`Bundled ${result.outputs.length} files to ${outdir}/`)

// Step 3: Copy vendored ripgrep binaries
const ripgrepDir = join(outdir, 'vendor', 'ripgrep')
await cp('src/utils/vendor/ripgrep', ripgrepDir, { recursive: true })
console.log(`Copied src/utils/vendor/ripgrep/ → ${ripgrepDir}/`)

// Step 4: Generate the Bun executable entry point
const cliBun = join(outdir, 'cli-bun.js')

await writeFile(cliBun, '#!/usr/bin/env bun\nimport "./cli.js"\n')

// Make the published entry point executable.
const { chmodSync } = await import('fs')
chmodSync(cliBun, 0o755)

console.log(`Generated ${cliBun} (shebang: bun)`)
