#!/usr/bin/env bun
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

const profile = await mkdtemp(join(tmpdir(), 'openai-proxy-host-profile-'))
const token = 'standalone-lifecycle-token-with-sufficient-entropy'
const env = {
  ...process.env,
  HOME: profile,
  USERPROFILE: profile,
  OPENAI_PROXY_LOCAL_TOKEN: token,
}
const liveMcp = Bun.spawn([host, 'mcp'], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  env,
})
try {
  const statePath = join(
    profile,
    '.claude',
    'openai-proxy',
    'runtime',
    'runtime.json',
  )
  const deadline = Date.now() + 15_000
  let state: { endpoint: string; instanceId: string } | undefined
  while (Date.now() < deadline) {
    try {
      state = JSON.parse(await readFile(statePath, 'utf8')) as typeof state
      if (state?.endpoint && state.instanceId) break
    } catch {
      // The MCP Host may still be starting its detached singleton.
    }
    await Bun.sleep(100)
  }
  assert(state, 'standalone MCP starts and publishes daemon state')
  const doctor = await fetch(`${state.endpoint}/doctor`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assertEqual(doctor.status, 200, 'standalone daemon doctor status')
  const body = (await doctor.json()) as Record<string, unknown>
  assertEqual(body.instanceId, state.instanceId, 'standalone daemon identity')
  const stop = Bun.spawnSync([host, 'stop'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  assertEqual(stop.exitCode, 0, 'standalone daemon stop exit')
  liveMcp.stdin.end()
  const liveStatus = await Promise.race([
    liveMcp.exited,
    Bun.sleep(10_000).then(() => -1),
  ])
  assertEqual(liveStatus, 0, 'standalone live MCP exits cleanly')
} finally {
  liveMcp.stdin.end()
  if ((await Promise.race([liveMcp.exited, Bun.sleep(100).then(() => null)])) === null) {
    liveMcp.kill()
  }
  await rm(profile, { recursive: true, force: true })
}
console.log('[openai-proxy-distribution] PASS')
