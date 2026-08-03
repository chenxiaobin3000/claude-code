#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'
const root = resolve(import.meta.dir, '..', '..')
const directory = join(root, 'dist', 'plugins', 'qq')
const host = join(directory, process.platform === 'win32' ? 'qq-host.exe' : 'qq-host')
await access(host)
const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string; mcpServers: { qq: { command: string; args: string[] } } }
assertEqual(manifest.name, 'qq', 'QQ distribution identity'); assert(manifest.mcpServers.qq.command.includes('qq-host'), 'QQ distribution standalone Host'); assert(!manifest.mcpServers.qq.command.includes('bun'), 'QQ target must not require Bun')
const empty = mkdtempSync(join(tmpdir(), 'qq-host-eof-'))
try {
  const child = Bun.spawn([host, 'mcp'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, QQ_STATE_DIR: empty } }); child.stdin.end()
  const timer = setTimeout(() => child.kill(), 10_000)
  const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]).finally(() => clearTimeout(timer))
  assertEqual(status, 1, 'unconfigured QQ MCP Host exits'); assert(stderr.includes('No QQ bot configured'), 'QQ Host configuration diagnostic')
} finally { rmSync(empty, { recursive: true, force: true }) }
console.log('[qq-distribution] PASS')
