#!/usr/bin/env bun
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildStandaloneWithRetry } from './standalone-build.js'

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
const root = resolve(import.meta.dir, '..')
const plugin = join(root, 'plugins', 'x')
const directory = join(root, 'dist', 'plugins', 'x')
const filename = process.platform === 'win32' ? 'x-host.exe' : 'x-host'
const outfile = join(directory, filename)

await rm(directory, { recursive: true, force: true })
await mkdir(directory, { recursive: true })
const result = await buildStandaloneWithRetry({
  label: 'x-host',
  outfile,
  build: () =>
    Bun.build({
      entrypoints: [join(plugin, 'host', 'entry.ts')],
      target: 'bun',
      compile: {
        target: platformTarget,
        outfile,
        ...(process.platform === 'win32'
          ? {
              windows: {
                title: 'X Host',
                description: 'Local read-only X API MCP Host',
                version: '1.0.0.0',
              },
            }
          : {}),
      },
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    }),
})
if (!result.success) {
  for (const item of result.logs) console.error(item)
  process.exit(1)
}
const output = await stat(outfile)
await cp(join(plugin, 'README.md'), join(directory, 'README.md'))
const manifest = JSON.parse(
  await readFile(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>
manifest.mcpServers = {
  x: {
    type: 'stdio',
    command: `\${CLAUDE_PLUGIN_ROOT}/${filename}`,
    args: ['mcp'],
  },
}
await mkdir(join(directory, '.claude-plugin'), { recursive: true })
await writeFile(
  join(directory, '.claude-plugin', 'plugin.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
console.log(
  `Generated distributable plugin ${directory} (${(output.size / 1024 / 1024).toFixed(1)} MiB Host, standalone Bun runtime)`,
)
