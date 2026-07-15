#!/usr/bin/env bun

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dir, '..')
const bunExecutable = process.execPath
const packageJson = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
) as { version: string }
const expectedVersion = `${packageJson.version} (Claude Code)`
const commandTimeoutMs = 120_000
const modelTimeoutMs = 180_000

interface RunOptions {
  capture?: boolean
  env?: Record<string, string>
  timeoutMs?: number
}

interface RunResult {
  stdout: string
  stderr: string
}

function formatCommand(command: string[]): string {
  return command
    .map(part => (part.includes(' ') ? JSON.stringify(part) : part))
    .join(' ')
}

async function runStep(
  name: string,
  command: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  console.log(`\n[verify] ${name}`)
  console.log(`[verify] $ ${formatCommand(command)}`)

  const capture = options.capture ?? false
  const proc = Bun.spawn(command, {
    cwd: projectRoot,
    env: { ...process.env, ...options.env },
    stdin: 'ignore',
    stdout: capture ? 'pipe' : 'inherit',
    stderr: capture ? 'pipe' : 'inherit',
  })

  const stdoutPromise = capture
    ? new Response(proc.stdout).text()
    : Promise.resolve('')
  const stderrPromise = capture
    ? new Response(proc.stderr).text()
    : Promise.resolve('')
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, options.timeoutMs ?? commandTimeoutMs)

  const exitCode = await proc.exited
  clearTimeout(timeout)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])

  if (timedOut) {
    throw new Error(
      `${name} timed out after ${options.timeoutMs ?? commandTimeoutMs} ms`,
    )
  }
  if (exitCode !== 0) {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    throw new Error(`${name} failed with exit code ${exitCode}`)
  }

  console.log(`[verify] PASS ${name}`)
  return { stdout, stderr }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} did not contain ${JSON.stringify(expected)}`)
  }
}

async function assertVersion(
  runtime: 'bun' | 'node',
  entrypoint: string,
): Promise<void> {
  const executable = runtime === 'bun' ? bunExecutable : runtime
  const result = await runStep(
    `${runtime} CLI version`,
    [executable, entrypoint, '--version'],
    {
      capture: true,
    },
  )
  if (result.stdout.trim() !== expectedVersion) {
    throw new Error(
      `${runtime} CLI version mismatch: expected ${JSON.stringify(expectedVersion)}, got ${JSON.stringify(result.stdout.trim())}`,
    )
  }
}

interface ModelConfig {
  apiKey: string
  baseUrl: string
  model: string
}

interface VerificationConfig {
  llamaCpp?: {
    baseUrl?: string
    model?: string
  }
}

function isLocalAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.startsWith('127.'))
    return true
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true
  const match = /^172\.(\d+)\./.exec(host)
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false
}

async function resolveModelConfig(): Promise<ModelConfig> {
  const configPath = join(projectRoot, 'verify.config.json')
  let configured: VerificationConfig
  try {
    configured = JSON.parse(
      await readFile(configPath, 'utf8'),
    ) as VerificationConfig
  } catch (error) {
    throw new Error(`Cannot read ${configPath}: ${String(error)}`)
  }
  const baseUrl = configured.llamaCpp?.baseUrl?.trim().replace(/\/$/, '') || ''
  const model = configured.llamaCpp?.model?.trim() || ''

  if (!baseUrl || !model) {
    throw new Error(
      'Configure llamaCpp.baseUrl and llamaCpp.model in verify.config.json before running verification.',
    )
  }

  let endpoint: URL
  try {
    endpoint = new URL(baseUrl)
  } catch {
    throw new Error(
      `Configured OPENAI_BASE_URL is invalid: ${JSON.stringify(baseUrl)}`,
    )
  }
  if (!isLocalAddress(endpoint.hostname)) {
    throw new Error(
      `Configured OPENAI_BASE_URL is not a local llama.cpp address: ${endpoint.origin}. Verification will not call an external endpoint.`,
    )
  }

  console.log(`[verify] llama.cpp endpoint: ${baseUrl}`)
  console.log(`[verify] llama.cpp model: ${model}`)
  return {
    apiKey: 'llama.cpp',
    baseUrl,
    model,
  }
}

function modelEnv(config: ModelConfig): Record<string, string> {
  return {
    OPENAI_API_KEY: config.apiKey,
    OPENAI_BASE_URL: config.baseUrl,
    OPENAI_MODEL: config.model,
  }
}

async function verifyModelRequest(config: ModelConfig): Promise<void> {
  const marker = 'MODEL_SMOKE_OK'
  const result = await runStep(
    'single-turn model request',
    [
      'node',
      'dist/cli-node.js',
      '--print',
      '--bare',
      '--output-format',
      'text',
      '--tools',
      '',
      '--max-turns',
      '1',
      '--no-session-persistence',
      `Reply with exactly ${marker} and nothing else.`,
    ],
    { capture: true, env: modelEnv(config), timeoutMs: modelTimeoutMs },
  )
  assertIncludes(result.stdout, marker, 'single-turn model output')
}

async function verifyReadTool(config: ModelConfig): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'claude-code-verify-'))
  const fixturePath = join(tempDir, 'read-smoke.txt')
  const fixtureToken = `READ_FIXTURE_${crypto.randomUUID()}`
  await writeFile(fixturePath, fixtureToken, 'utf8')

  try {
    const result = await runStep(
      'Read tool call',
      [
        'node',
        'dist/cli-node.js',
        '--print',
        '--bare',
        '--verbose',
        '--output-format',
        'stream-json',
        '--tools',
        'Read',
        '--allowed-tools',
        'Read',
        '--permission-mode',
        'dontAsk',
        '--max-turns',
        '3',
        '--no-session-persistence',
        `You must call the Read tool for ${fixturePath}. After reading it, reply with TOOL_SMOKE_OK followed by the exact file content. Do not guess the content.`,
      ],
      { capture: true, env: modelEnv(config), timeoutMs: modelTimeoutMs },
    )

    assertIncludes(result.stdout, '"type":"tool_use"', 'structured CLI output')
    assertIncludes(result.stdout, '"name":"Read"', 'structured CLI output')
    assertIncludes(result.stdout, 'TOOL_SMOKE_OK', 'Read tool final output')
    assertIncludes(result.stdout, fixtureToken, 'Read tool final output')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now()

  await runStep('locked dependency install', [
    bunExecutable,
    'install',
    '--frozen-lockfile',
  ])
  await runStep('TypeScript typecheck', [bunExecutable, 'run', 'typecheck'])
  await runStep('Biome lint', [bunExecutable, 'run', 'lint'])

  await runStep('Bun build', [bunExecutable, 'run', 'build'])
  await assertVersion('bun', 'dist/cli-bun.js')
  await assertVersion('node', 'dist/cli-node.js')

  await runStep('Vite/Node build', [bunExecutable, 'run', 'build:vite'])
  await assertVersion('node', 'dist/cli-node.js')
  const help = await runStep(
    'Node CLI startup',
    ['node', 'dist/cli-node.js', '--help'],
    {
      capture: true,
    },
  )
  assertIncludes(help.stdout, 'Claude Code', 'Node CLI help')

  const config = await resolveModelConfig()
  await verifyModelRequest(config)
  await verifyReadTool(config)

  console.log(
    `\n[verify] ALL CHECKS PASSED in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  )
}

main().catch(error => {
  console.error(
    `\n[verify] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
})
