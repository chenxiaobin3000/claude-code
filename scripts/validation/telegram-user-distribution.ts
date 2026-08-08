#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'
const root = resolve(import.meta.dir, '..', '..'); const directory = join(root, 'dist', 'plugins', 'telegram-user'); const host = join(directory, process.platform === 'win32' ? 'telegram-user-host.exe' : 'telegram-user-host'); await access(host)
const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string; mcpServers: { 'telegram-user': { command: string; args: string[] } } }
assertEqual(manifest.name, 'telegram-user', 'distribution identity'); assert(manifest.mcpServers['telegram-user'].command.includes('telegram-user-host'), 'standalone Host command'); assert(!manifest.mcpServers['telegram-user'].command.includes('bun'), 'target does not require Bun')
const version = Bun.spawnSync([host, '--version'], { stdout: 'pipe', stderr: 'pipe' }); assertEqual(version.exitCode, 0, 'Host version exit'); assertEqual(version.stdout.toString().trim(), '1.0.0', 'Host version')
const help = Bun.spawnSync([host, '--help'], { stdout: 'pipe', stderr: 'pipe' }); assertEqual(help.exitCode, 0, 'Host help exit'); assert(help.stdout.toString().includes('account groups [alias]'), 'standalone group discovery command'); assert(help.stdout.toString().includes('account history <alias>'), 'standalone history command')
const proxyCapabilities = Bun.spawnSync([host, 'proxy', 'capabilities'], { stdout: 'pipe', stderr: 'pipe' }); assertEqual(proxyCapabilities.exitCode, 0, 'proxy capabilities exit'); assert(proxyCapabilities.stdout.toString().includes('SOCKS5 supported'), 'standalone SOCKS5 proxy capability'); assert(proxyCapabilities.stdout.toString().includes('HTTP/HTTPS unsupported'), 'standalone HTTP proxy fail-closed capability')
const empty = mkdtempSync(join(tmpdir(), 'telegram-user-eof-'))
try { const child = Bun.spawn([host, 'mcp'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, TELEGRAM_USER_STATE_DIR: empty } }); child.stdin.end(); const timer = setTimeout(() => child.kill(), 10_000); const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]).finally(() => clearTimeout(timer)); assertEqual(status, 1, 'unconfigured MCP Host exits'); assert(stderr.includes('No Telegram user account configured'), 'configuration diagnostic') } finally { rmSync(empty, { recursive: true, force: true }) }
console.log('[telegram-user-distribution] PASS')

