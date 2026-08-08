#!/usr/bin/env bun
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assert, assertEqual } from './assertions.js'
const root = resolve(import.meta.dir, '..', '..'); const directory = join(root, 'dist', 'plugins', 'telegram-user'); const host = join(directory, process.platform === 'win32' ? 'telegram-user-host.exe' : 'telegram-user-host'); await access(host)
const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string; mcpServers: Record<string, { command: string; args: string[] }> }
assertEqual(manifest.name, 'telegram-user', 'distribution identity'); assertEqual(Object.keys(manifest.mcpServers).sort().join(','), 'telegram-user-control', 'standalone MCP identities'); assert(manifest.mcpServers['telegram-user-control']!.command.includes('telegram-user-host'), 'standalone Host command'); assert(!manifest.mcpServers['telegram-user-control']!.command.includes('bun'), 'target does not require Bun'); assertEqual(manifest.mcpServers['telegram-user-control']!.args.join(','), 'control-mcp', 'control MCP entrypoint')
const version = Bun.spawnSync([host, '--version'], { stdout: 'pipe', stderr: 'pipe' }); assertEqual(version.exitCode, 0, 'Host version exit'); assertEqual(version.stdout.toString().trim(), '1.0.0', 'Host version')
const help = Bun.spawnSync([host, '--help'], { stdout: 'pipe', stderr: 'pipe' }); assertEqual(help.exitCode, 0, 'Host help exit'); assert(help.stdout.toString().includes('account groups [alias]'), 'standalone group discovery command'); assert(help.stdout.toString().includes('account history <alias>'), 'standalone history command')
const proxyCapabilities = Bun.spawnSync([host, 'proxy', 'capabilities'], { stdout: 'pipe', stderr: 'pipe' }); assertEqual(proxyCapabilities.exitCode, 0, 'proxy capabilities exit'); assert(proxyCapabilities.stdout.toString().includes('SOCKS5 supported'), 'standalone SOCKS5 proxy capability'); assert(proxyCapabilities.stdout.toString().includes('HTTP/HTTPS unsupported'), 'standalone HTTP proxy fail-closed capability')
const control = Bun.spawn([host, 'control-mcp'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }); control.stdin.end(); const controlTimer = setTimeout(() => control.kill(), 10_000); const controlStatus = await control.exited.finally(() => clearTimeout(controlTimer)); assertEqual(controlStatus, 0, 'control MCP Host exits on EOF')
console.log('[telegram-user-distribution] PASS')

