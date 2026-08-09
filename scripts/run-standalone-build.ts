#!/usr/bin/env bun

import { readdir, rm } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { isRetryableStandaloneBuildError } from './standalone-build.js'

const allowedBuildScripts = new Set([
  'scripts/build-exe.ts',
  'scripts/build-chrome-host.ts',
  'scripts/build-weixin-host.ts',
  'scripts/build-wxwork-host.ts',
  'scripts/build-qq-host.ts',
  'scripts/build-telegram-host.ts',
  'scripts/build-telegram-user-host.ts',
  'scripts/build-x-host.ts',
  'scripts/build-openai-proxy-host.ts',
])
const retryDelaysMs = [250, 500, 1000] as const
const temporaryBuildFile = /^\.[0-9a-f]+-[0-9a-f]+\.bun-build$/i

export interface StandaloneBuildProcessResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface StandaloneBuildProcessOptions {
  script: string
  platform?: NodeJS.Platform
  delaysMs?: readonly number[]
  runAttempt?: () => Promise<StandaloneBuildProcessResult>
  sleep?: (milliseconds: number) => Promise<void>
  cleanup?: () => Promise<void>
  writeOutput?: (result: StandaloneBuildProcessResult) => void
  log?: (message: string) => void
}

function normalizeBuildScript(script: string): string {
  return normalize(script).replaceAll('\\', '/')
}

function assertAllowedBuildScript(script: string): string {
  const normalized = normalizeBuildScript(script)
  if (!allowedBuildScripts.has(normalized)) {
    throw new Error(`Unsupported standalone build script: ${script}`)
  }
  return normalized
}

async function listTemporaryBuildFiles(): Promise<Set<string>> {
  return new Set(
    (await readdir(process.cwd())).filter(name =>
      temporaryBuildFile.test(name),
    ),
  )
}

async function removeNewTemporaryBuildFiles(
  existing: ReadonlySet<string>,
): Promise<void> {
  const current = await listTemporaryBuildFiles()
  await Promise.allSettled(
    [...current]
      .filter(name => !existing.has(name))
      .map(name => rm(join(process.cwd(), name), { force: true })),
  )
}

async function executeBuildScript(
  script: string,
): Promise<StandaloneBuildProcessResult> {
  const child = Bun.spawn([process.execPath, script], {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

export async function runStandaloneBuildProcess({
  script,
  platform = process.platform,
  delaysMs = retryDelaysMs,
  runAttempt,
  sleep = Bun.sleep,
  cleanup = async () => undefined,
  writeOutput = result => {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  },
  log = message => process.stderr.write(`${message}\n`),
}: StandaloneBuildProcessOptions): Promise<number> {
  const normalized = assertAllowedBuildScript(script)
  const attempt = runAttempt ?? (() => executeBuildScript(normalized))
  for (let index = 0; ; index += 1) {
    const existingTemporaryFiles = await listTemporaryBuildFiles()
    const result = await attempt()
    writeOutput(result)
    await removeNewTemporaryBuildFiles(existingTemporaryFiles)
    if (result.exitCode === 0) return 0
    const delay = delaysMs[index]
    const detail = `${result.stderr}\n${result.stdout}`
    if (
      platform !== 'win32' ||
      delay === undefined ||
      !isRetryableStandaloneBuildError(new Error(detail))
    ) {
      return result.exitCode
    }
    await cleanup()
    log(
      `[standalone-build] Windows metadata/temp failure in ${normalized}; retrying process (${index + 2}/${delaysMs.length + 1}) after ${delay} ms.`,
    )
    await sleep(delay)
  }
}

if (import.meta.main) {
  const script = process.argv[2]
  if (!script || process.argv.length !== 3) {
    process.stderr.write(
      'Usage: bun run scripts/run-standalone-build.ts scripts/build-<target>.ts\n',
    )
    process.exitCode = 1
  } else {
    try {
      process.exitCode = await runStandaloneBuildProcess({ script })
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      )
      process.exitCode = 1
    }
  }
}
