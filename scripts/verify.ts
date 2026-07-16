#!/usr/bin/env bun

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveModelTarget } from '../src/utils/model/modelRegistry.js'

const projectRoot = resolve(import.meta.dir, '..')
const bunExecutable = process.execPath
const packageJson = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
) as { version: string }
const expectedVersion = `${packageJson.version} (Claude Code)`
const commandTimeoutMs = 120_000
const modelTimeoutMs = 180_000
const ciMode = process.argv.includes('--ci')
const validationScripts = [
  'scripts/validation/anthropic-boundary.ts',
  'scripts/validation/vertex-boundary.ts',
  'scripts/validation/foundry-boundary.ts',
  'scripts/validation/sdk-compat-boundary.ts',
  'scripts/validation/provider-boundary.ts',
  'scripts/validation/main-boundary.ts',
  'scripts/validation/repl-boundary.ts',
  'scripts/validation/model-preparation.ts',
  'scripts/validation/message-conversion.ts',
  'scripts/validation/openai-stream.ts',
  'scripts/validation/model-stream.ts',
  'scripts/validation/model-usage.ts',
  'scripts/validation/tool-permissions.ts',
  'scripts/validation/shell-parsers.ts',
  'scripts/validation/model-diagnostics.ts',
]

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

interface CliArtifact {
  label: string
  command: string[]
}

async function assertVersion(artifact: CliArtifact): Promise<void> {
  const result = await runStep(
    `${artifact.label} version`,
    [...artifact.command, '--version'],
    {
      capture: true,
    },
  )
  if (result.stdout.trim() !== expectedVersion) {
    throw new Error(
      `${artifact.label} version mismatch: expected ${JSON.stringify(expectedVersion)}, got ${JSON.stringify(result.stdout.trim())}`,
    )
  }
}

async function verifyStartup(artifact: CliArtifact): Promise<void> {
  const result = await runStep(
    `${artifact.label} startup`,
    [...artifact.command, '--help'],
    { capture: true },
  )
  assertIncludes(result.stdout, 'Claude Code', `${artifact.label} help`)
}

interface ModelConfig {
  baseUrl: string
  model: string
}

function isLocalAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.startsWith('127.'))
    return true
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true
  const match = /^172\.(\d+)\./.exec(host)
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false
}

function resolveModelConfig(): ModelConfig {
  const configured = resolveModelTarget()
  const { baseUrl, model } = configured

  let endpoint: URL
  try {
    endpoint = new URL(baseUrl)
  } catch {
    throw new Error(
      `Configured model baseUrl is invalid: ${JSON.stringify(baseUrl)}`,
    )
  }
  if (!isLocalAddress(endpoint.hostname)) {
    throw new Error(
      `Configured default model does not use a local llama.cpp address: ${endpoint.origin}. Verification will not call an external endpoint.`,
    )
  }

  console.log(`[verify] llama.cpp endpoint: ${baseUrl}`)
  console.log(`[verify] llama.cpp model: ${model}`)
  return { baseUrl, model }
}

async function verifyModelRequest(
  artifact: CliArtifact,
  config: ModelConfig,
): Promise<void> {
  const marker = 'MODEL_SMOKE_OK'
  const result = await runStep(
    `${artifact.label} single-turn model request`,
    [
      ...artifact.command,
      '--print',
      '--bare',
      '--output-format',
      'text',
      '--model',
      config.model,
      '--tools',
      '',
      '--max-turns',
      '1',
      '--no-session-persistence',
      `Reply with exactly ${marker} and nothing else.`,
    ],
    { capture: true, timeoutMs: modelTimeoutMs },
  )
  assertIncludes(result.stdout, marker, 'single-turn model output')
}

async function verifyReadTool(
  artifact: CliArtifact,
  config: ModelConfig,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'claude-code-verify-'))
  const fixturePath = join(tempDir, 'read-smoke.txt')
  const fixtureToken = `READ_FIXTURE_${crypto.randomUUID()}`
  await writeFile(fixturePath, fixtureToken, 'utf8')

  try {
    const result = await runStep(
      `${artifact.label} Read tool call`,
      [
        ...artifact.command,
        '--print',
        '--bare',
        '--verbose',
        '--output-format',
        'stream-json',
        '--model',
        config.model,
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
      { capture: true, timeoutMs: modelTimeoutMs },
    )

    assertIncludes(result.stdout, '"type":"tool_use"', 'structured CLI output')
    assertIncludes(result.stdout, '"name":"Read"', 'structured CLI output')
    assertIncludes(result.stdout, 'TOOL_SMOKE_OK', 'Read tool final output')
    assertIncludes(result.stdout, fixtureToken, 'Read tool final output')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function verifyCliArtifact(
  artifact: CliArtifact,
  config: ModelConfig | null,
): Promise<void> {
  await assertVersion(artifact)
  await verifyStartup(artifact)
  if (!config) {
    console.log(
      `[verify] SKIP ${artifact.label} model request and tool call in CI mode`,
    )
    return
  }
  await verifyModelRequest(artifact, config)
  await verifyReadTool(artifact, config)
}

async function main(): Promise<void> {
  const startedAt = Date.now()

  if (ciMode) {
    console.log(
      '[verify] CI mode: local model request and tool call checks are disabled',
    )
  }

  await runStep('locked dependency install', [
    bunExecutable,
    'install',
    '--frozen-lockfile',
  ])
  await runStep('TypeScript typecheck', [bunExecutable, 'run', 'typecheck'])
  await runStep('Biome lint', [bunExecutable, 'run', 'lint'])
  for (const script of validationScripts) {
    await runStep(`source validation: ${script}`, [
      bunExecutable,
      'run',
      script,
    ])
  }

  const config = ciMode ? null : resolveModelConfig()
  const bunArtifact: CliArtifact = {
    label: 'Bun bundle CLI',
    command: [bunExecutable, 'dist/cli-bun.js'],
  }
  const nodeArtifact: CliArtifact = {
    label: 'Vite/Node bundle CLI',
    command: ['node', 'dist/cli-node.js'],
  }

  await runStep('Bun bundle build', [bunExecutable, 'run', 'build:bun'])
  await runStep('Bun bundle integrity', [bunExecutable, 'run', 'check:bundle'])
  await verifyCliArtifact(bunArtifact, config)

  await runStep('Vite/Node build', [bunExecutable, 'run', 'build:vite'])
  await runStep('Vite/Node bundle integrity', [
    bunExecutable,
    'run',
    'check:bundle',
  ])
  await verifyCliArtifact(nodeArtifact, config)

  if (process.platform === 'win32' && process.arch === 'x64') {
    await runStep('Windows x64 standalone EXE build', [
      bunExecutable,
      'run',
      'build:exe',
    ])
    const exeArtifact: CliArtifact = {
      label: 'Windows x64 standalone EXE',
      command: [resolve(projectRoot, 'dist', 'claude-code.exe')],
    }
    await verifyCliArtifact(exeArtifact, config)
  } else {
    console.log(
      `\n[verify] SKIP Windows x64 standalone EXE on ${process.platform}-${process.arch}`,
    )
  }

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
