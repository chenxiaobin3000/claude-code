#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface PackageManifest {
  name?: string
  main?: string
}

const packageDir = process.cwd()
const manifest = JSON.parse(
  await readFile(join(packageDir, 'package.json'), 'utf8'),
) as PackageManifest
const packageName = manifest.name ?? '<unnamed>'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`${packageName}: ${message}`)
}

async function assertFile(relativePath: string): Promise<string> {
  const path = resolve(packageDir, relativePath)
  await access(path)
  return path
}

async function assertImport(relativePath: string): Promise<void> {
  const path = await assertFile(relativePath)
  const imported = (await import(pathToFileURL(path).href)) as Record<
    string,
    unknown
  >
  assert(Object.keys(imported).length > 0, `${relativePath} exports nothing`)
}

async function smokeSourcePackage(): Promise<void> {
  assert(manifest.main?.startsWith('./src/'), 'source package main is invalid')
  await assertImport(manifest.main)
}

async function smokeAcpLink(): Promise<void> {
  await assertFile('dist/server.js')
  await assertFile('dist/server.d.ts')
  const cli = await assertFile('dist/cli/bin.js')
  const proc = Bun.spawn([process.execPath, cli, '--help'], {
    cwd: packageDir,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  assert(exitCode === 0, `CLI --help failed: ${stderr || stdout}`)
  assert(stdout.length > 0, 'CLI --help returned no output')
}

async function smokeWorkflowEngine(): Promise<void> {
  await assertFile('dist/index.d.ts')
  await assertImport('dist/index.js')
}

async function smokeCloudArtifacts(): Promise<void> {
  const workerPath = await assertFile('src/index.ts')
  const worker = (await import(pathToFileURL(workerPath).href)) as {
    default?: {
      fetch?: (
        request: Request,
        env: Record<string, unknown>,
      ) => Promise<Response>
    }
  }
  assert(
    typeof worker.default?.fetch === 'function',
    'Worker fetch export missing',
  )
  const response = await worker.default.fetch(
    new Request('https://artifacts.invalid/not-found', { method: 'POST' }),
    {},
  )
  assert(response.status === 404, `expected 404, received ${response.status}`)
  const body = (await response.json()) as { error?: string }
  assert(body.error === 'not_found', 'unexpected not-found response body')
}

async function smokeRemoteControlServer(): Promise<void> {
  await assertFile('dist/server.js')
  await assertFile('web/dist/index.html')
  const port = 31_000 + Math.floor(Math.random() * 2_000)
  const proc = Bun.spawn([process.execPath, 'dist/server.js'], {
    cwd: packageDir,
    env: {
      ...process.env,
      RCS_HOST: '127.0.0.1',
      RCS_PORT: String(port),
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    let response: Response | undefined
    for (let attempt = 0; attempt < 40; attempt++) {
      if (
        await Promise.race([
          proc.exited.then(() => true),
          Bun.sleep(100).then(() => false),
        ])
      ) {
        break
      }
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`)
        if (response.ok) break
      } catch {
        // Server is still starting.
      }
    }
    assert(response?.ok, 'health endpoint did not become ready')
    const body = (await response.json()) as { status?: string }
    assert(body.status === 'ok', 'health endpoint returned an unexpected body')
  } finally {
    proc.kill()
    await proc.exited
  }
}

switch (packageName) {
  case 'acp-link':
    await smokeAcpLink()
    break
  case '@claude-code-best/workflow-engine':
    await smokeWorkflowEngine()
    break
  case 'cloud-artifacts':
    await smokeCloudArtifacts()
    break
  case '@anthropic/remote-control-server':
    await smokeRemoteControlServer()
    break
  default:
    await smokeSourcePackage()
}

console.log(`[workspace-smoke] PASS ${packageName}`)
