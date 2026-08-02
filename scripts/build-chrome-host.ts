#!/usr/bin/env bun

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const platformTarget =
  process.platform === 'win32'
    ? 'bun-windows-x64'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'bun-darwin-arm64'
        : 'bun-darwin-x64'
      : process.arch === 'arm64'
        ? 'bun-linux-arm64'
        : 'bun-linux-x64'
const projectRoot = resolve(import.meta.dir, '..')
const pluginRoot = join(projectRoot, 'plugins', 'chrome')
const outputDirectory = join(projectRoot, 'dist', 'plugins', 'chrome')
const legacyOutputDirectory = join(
  projectRoot,
  'dist',
  'plugins',
  'claudeinchrome',
)
const hostFilename =
  process.platform === 'win32'
    ? 'chrome-host.exe'
    : 'chrome-host'
const outfile = join(outputDirectory, hostFilename)

await Promise.all([
  rm(outputDirectory, { recursive: true, force: true }),
  rm(legacyOutputDirectory, { recursive: true, force: true }),
])
await mkdir(outputDirectory, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(pluginRoot, 'host', 'entry.ts')],
  target: 'bun',
  compile: {
    target: platformTarget,
    outfile,
    ...(process.platform === 'win32'
      ? {
          windows: {
            title: 'chrome Host',
            description: 'Local Chrome MCP and Native Messaging Host',
            version: '1.0.0.0',
          },
        }
      : {}),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
})

if (!result.success) {
  console.error('chrome Host build failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const output = await stat(outfile)

await Promise.all([
  cp(
    join(pluginRoot, 'chrome-extension'),
    join(outputDirectory, 'chrome-extension'),
    {
      recursive: true,
    },
  ),
  cp(join(pluginRoot, 'skills'), join(outputDirectory, 'skills'), {
    recursive: true,
  }),
  cp(join(pluginRoot, 'README.md'), join(outputDirectory, 'README.md')),
])

const sourceManifest = JSON.parse(
  await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>
sourceManifest.mcpServers = {
  'claude-in-chrome': {
    type: 'stdio',
    command: `\${CLAUDE_PLUGIN_ROOT}/${hostFilename}`,
    args: ['mcp'],
  },
}
await mkdir(join(outputDirectory, '.claude-plugin'), { recursive: true })
await writeFile(
  join(outputDirectory, '.claude-plugin', 'plugin.json'),
  `${JSON.stringify(sourceManifest, null, 2)}\n`,
  'utf8',
)

console.log(
  `Generated distributable plugin ${outputDirectory} (${(output.size / 1024 / 1024).toFixed(1)} MiB Host, standalone Bun runtime)`,
)
