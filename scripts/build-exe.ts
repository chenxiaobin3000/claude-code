import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'fs/promises'
import { getMacroDefines, resolveBuildFeatures } from './defines.ts'
import { buildStandaloneWithRetry } from './standalone-build.ts'

const outfile = 'dist/claude.exe'
const legacyOutfiles = ['dist/claude-code.exe']
const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string
}
const windowsVersion = `${packageJson.version}.0`
const ripgrepPath = 'src/utils/vendor/ripgrep/x64-win32/rg.exe'
const ripgrepHash = createHash('sha256')
  .update(await readFile(ripgrepPath))
  .digest('hex')

const features = resolveBuildFeatures()

await mkdir('dist', { recursive: true })
await Promise.all(legacyOutfiles.map(path => rm(path, { force: true })))

async function buildStandalone(includeWindowsMetadata: boolean) {
  return buildStandaloneWithRetry({
    label: 'claude.exe',
    outfile,
    build: () => Bun.build({
    entrypoints: ['src/entrypoints/cli-standalone-windows.ts'],
    target: 'bun',
    compile: {
      target: 'bun-windows-x64',
      outfile,
      ...(includeWindowsMetadata
        ? {
            windows: {
              title: 'Claude Code',
              description: 'OpenAI-compatible coding assistant CLI',
              version: windowsVersion,
            },
          }
        : {}),
    },
    define: {
      ...getMacroDefines(),
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.CCB_BUNDLED_MODE': JSON.stringify('1'),
      'process.env.CCB_EMBEDDED_RIPGREP_SHA256': JSON.stringify(ripgrepHash),
    },
    features,
    }),
  })
}

let result: Awaited<ReturnType<typeof buildStandalone>>
try {
  result = await buildStandalone(true)
} catch (error) {
  if (!String(error).includes('FailedToCommit')) throw error
  console.warn(
    'Windows metadata commit failed; retrying standalone build without optional metadata.',
  )
  await rm(outfile, { force: true })
  result = await buildStandalone(false)
}

if (!result.success) {
  console.error('EXE build failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const output = await stat(outfile)
console.log(
  `Generated ${outfile} (${(output.size / 1024 / 1024).toFixed(1)} MiB, standalone Bun runtime)`,
)
