#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '..', '..')
const directory = join(root, 'dist', 'plugins', 'telegram')
const host = join(directory, process.platform === 'win32' ? 'telegram-host.exe' : 'telegram-host')
await access(host)
const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string; mcpServers: { telegram: { command: string; args: string[] } } }
assertEqual(manifest.name, 'telegram', 'Telegram distribution identity')
assert(manifest.mcpServers.telegram.command.includes('telegram-host'), 'Telegram distribution standalone Host')
assert(!manifest.mcpServers.telegram.command.includes('bun'), 'Telegram target must not require Bun')
const proxyCapabilities = Bun.spawnSync([host, 'proxy', 'capabilities'], { stdout: 'pipe', stderr: 'pipe' })
assertEqual(proxyCapabilities.exitCode, 0, 'proxy capabilities exit')
assert(proxyCapabilities.stdout.toString().includes('HTTP/HTTPS supported'), 'standalone HTTP proxy capability')
assert(proxyCapabilities.stdout.toString().includes('SOCKS5 unsupported'), 'standalone SOCKS5 fail-closed capability')
const empty = mkdtempSync(join(tmpdir(), 'telegram-host-eof-'))
try {
  const child = Bun.spawn([host, 'mcp'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, TELEGRAM_STATE_DIR: empty } }); child.stdin.end()
  const timer = setTimeout(() => child.kill(), 10_000)
  const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]).finally(() => clearTimeout(timer))
  assertEqual(status, 1, 'unconfigured Telegram MCP Host exits')
  assert(stderr.includes('No Telegram bot configured'), 'Telegram Host configuration diagnostic')
} finally { rmSync(empty, { recursive: true, force: true }) }
console.log('[telegram-distribution] PASS')
