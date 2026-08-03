#!/usr/bin/env bun

import { mkdtempSync, rmSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const directory = join(root, 'dist', 'plugins', 'wxwork')
const host = join(directory, process.platform === 'win32' ? 'wxwork-host.exe' : 'wxwork-host')
await access(host)
const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8')) as {
  name: string
  mcpServers: { wxwork: { command: string; args: string[] } }
}
assertEqual(manifest.name, 'wxwork', 'distribution Plugin identity')
assert(manifest.mcpServers.wxwork.command.includes('wxwork-host'), 'distribution manifest must launch standalone Host')
assert(!manifest.mcpServers.wxwork.command.includes('bun'), 'distribution must not require Bun on target')
assertEqual(manifest.mcpServers.wxwork.args[0], 'mcp', 'distribution MCP mode')

const emptyState = mkdtempSync(join(tmpdir(), 'wxwork-host-eof-'))
try {
  const lifecycle = Bun.spawn([host, 'mcp'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, WXWORK_STATE_DIR: emptyState },
  })
  lifecycle.stdin.end()
  const killTimer = setTimeout(() => lifecycle.kill(), 10_000)
  const [status, stderr] = await Promise.all([
    lifecycle.exited,
    new Response(lifecycle.stderr).text(),
  ]).finally(() => clearTimeout(killTimer))
  assertEqual(status, 1, 'unconfigured MCP Host must fail without hanging')
  assert(stderr.includes('No wxwork bot configured'), 'unconfigured Host diagnostic')
} finally {
  rmSync(emptyState, { recursive: true, force: true })
}

console.log('[wxwork-distribution] PASS')
