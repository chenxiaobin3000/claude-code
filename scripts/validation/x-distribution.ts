#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const directory = join(root, 'dist', 'plugins', 'x')
const host = join(
  directory,
  process.platform === 'win32' ? 'x-host.exe' : 'x-host',
)
await access(host)
const executable = await readFile(host)
assert(
  !executable.includes(Buffer.from('xdk-typescript/0.6.6')),
  'standalone excludes the rejected XDK runtime transport',
)
const manifest = JSON.parse(
  await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8'),
) as { name: string; mcpServers: { x: { command: string; args: string[] } } }
assertEqual(manifest.name, 'x', 'distribution identity')
assert(
  manifest.mcpServers.x.command.includes('x-host'),
  'standalone Host command',
)
assert(
  !manifest.mcpServers.x.command.includes('bun'),
  'target does not require Bun',
)
const version = Bun.spawnSync([host, '--version'], {
  stdout: 'pipe',
  stderr: 'pipe',
})
assertEqual(version.exitCode, 0, 'Host version exit')
assertEqual(version.stdout.toString().trim(), '1.0.0', 'Host version')
const empty = mkdtempSync(join(tmpdir(), 'x-host-eof-'))
try {
  const child = Bun.spawn([host, 'mcp'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, X_STATE_DIR: empty },
  })
  child.stdin.end()
  const timer = setTimeout(() => child.kill(), 10_000)
  const status = await child.exited.finally(() => clearTimeout(timer))
  assertEqual(status, 0, 'MCP Host exits cleanly on EOF')
} finally {
  rmSync(empty, { recursive: true, force: true })
}
console.log('[x-distribution] PASS')
