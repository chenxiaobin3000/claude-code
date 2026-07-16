import { mkdir, readFile, stat } from 'fs/promises'
import { getMacroDefines, DEFAULT_BUILD_FEATURES } from './defines.ts'

const outfile = 'dist/claude-code.exe'
const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string
}
const windowsVersion = `${packageJson.version}.0`

const envFeatures = Object.keys(process.env)
  .filter(key => key.startsWith('FEATURE_'))
  .map(key => key.replace('FEATURE_', ''))
const features = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]

await mkdir('dist', { recursive: true })

const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  target: 'bun',
  compile: {
    target: 'bun-windows-x64',
    outfile,
    windows: {
      title: 'Claude Code',
      description: 'OpenAI-compatible coding assistant CLI',
      version: windowsVersion,
    },
  },
  define: {
    ...getMacroDefines(),
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.CCB_BUNDLED_MODE': JSON.stringify('1'),
  },
  features,
})

if (!result.success) {
  console.error('EXE build failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const output = await stat(outfile)
console.log(
  `Generated ${outfile} (${(output.size / 1024 / 1024).toFixed(1)} MiB, standalone Bun runtime)`,
)
