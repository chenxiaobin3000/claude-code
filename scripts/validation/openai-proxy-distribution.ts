#!/usr/bin/env bun
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const directory = join(root, 'dist', 'plugins', 'openai-proxy')
const host = join(
  directory,
  process.platform === 'win32'
    ? 'openai-proxy-host.exe'
    : 'openai-proxy-host',
)
await access(host)
const manifest = JSON.parse(
  await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8'),
) as {
  name: string
  mcpServers: { 'openai-proxy': { command: string; args: string[] } }
}
assertEqual(manifest.name, 'openai-proxy', 'distribution identity')
assert(
  manifest.mcpServers['openai-proxy'].command.includes('openai-proxy-host'),
  'standalone Host command',
)
assert(
  !manifest.mcpServers['openai-proxy'].command.includes('bun'),
  'distribution does not require an installed Bun runtime',
)
const version = Bun.spawnSync([host, '--version'], {
  stdout: 'pipe',
  stderr: 'pipe',
})
assertEqual(version.exitCode, 0, 'Host version exit')
assertEqual(version.stdout.toString().trim(), '0.1.0', 'Host version')
const mcp = Bun.spawn([host, 'mcp'], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
})
mcp.stdin.end()
const timer = setTimeout(() => mcp.kill(), 10_000)
const status = await mcp.exited.finally(() => clearTimeout(timer))
assertEqual(status, 0, 'MCP Host exits cleanly on EOF')
console.log('[openai-proxy-distribution] PASS')
