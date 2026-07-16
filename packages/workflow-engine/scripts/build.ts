import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DIST = new URL('../dist/', import.meta.url)

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

// Emit dist/**/*.js + dist/**/*.d.ts (+ maps) via tsc.
const proc = Bun.spawn(
  [process.execPath, 'x', 'tsc', '-p', 'tsconfig.build.json'],
  {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
const exitCode = await proc.exited
if (exitCode !== 0) {
  console.error('tsc emit failed')
  process.exit(exitCode)
}

console.log('✓ build complete')
