import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const WINDOWS_RETRY_DELAYS_MS = [250, 500, 1000] as const
const WINDOWS_TRANSIENT_BUILD_MARKERS = [
  'EBUSY',
  'failed to open temporary file to copy bun into',
  'Failed to get temp file path',
  'FailedToCommit',
] as const
const BUN_TEMPORARY_BUILD_FILE = /^\.[0-9a-f]+-[0-9a-f]+\.bun-build$/i

async function listBunTemporaryBuildFiles(): Promise<Set<string>> {
  return new Set(
    (await readdir(process.cwd())).filter(name =>
      BUN_TEMPORARY_BUILD_FILE.test(name),
    ),
  )
}

async function removeNewBunTemporaryBuildFiles(
  existing: ReadonlySet<string>,
): Promise<void> {
  const current = await listBunTemporaryBuildFiles()
  await Promise.allSettled(
    [...current]
      .filter(name => !existing.has(name))
      .map(name => rm(join(process.cwd(), name), { force: true })),
  )
}

export function isRetryableStandaloneBuildError(error: unknown): boolean {
  const message = (
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ).toLowerCase()
  return WINDOWS_TRANSIENT_BUILD_MARKERS.some(marker =>
    message.includes(marker.toLowerCase()),
  )
}

function getStandaloneBuildResultError(result: unknown): Error | undefined {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('success' in result) ||
    result.success !== false
  ) {
    return undefined
  }
  const logs = 'logs' in result && Array.isArray(result.logs) ? result.logs : []
  const message = logs
    .map(log => {
      if (typeof log === 'object' && log !== null && 'message' in log) {
        return String(log.message)
      }
      return String(log)
    })
    .filter(Boolean)
    .join('\n')
  return new Error(message || 'Standalone build returned success=false')
}

interface StandaloneBuildRetryOptions<T> {
  label: string
  outfile: string
  build: () => Promise<T>
  platform?: NodeJS.Platform
  delaysMs?: readonly number[]
  sleep?: (milliseconds: number) => Promise<void>
  removePartialOutput?: (path: string) => Promise<void>
  log?: (message: string) => void
}

export async function buildStandaloneWithRetry<T>({
  label,
  outfile,
  build,
  platform = process.platform,
  delaysMs = WINDOWS_RETRY_DELAYS_MS,
  sleep = Bun.sleep,
  removePartialOutput = path =>
    rm(path, { force: true, maxRetries: 3, retryDelay: 100 }),
  log = message => console.warn(message),
}: StandaloneBuildRetryOptions<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const existingTemporaryFiles = await listBunTemporaryBuildFiles()
    try {
      const result = await build()
      const resultError = getStandaloneBuildResultError(result)
      if (resultError) throw resultError
      await removeNewBunTemporaryBuildFiles(existingTemporaryFiles)
      return result
    } catch (error) {
      const delay = delaysMs[attempt]
      await removeNewBunTemporaryBuildFiles(existingTemporaryFiles)
      if (
        platform !== 'win32' ||
        delay === undefined ||
        !isRetryableStandaloneBuildError(error)
      ) {
        throw error
      }
      await removePartialOutput(outfile)
      log(
        `[${label}] Windows temporary file contention detected; retrying standalone build (${attempt + 2}/${delaysMs.length + 1}) after ${delay} ms.`,
      )
      await sleep(delay)
      await removeNewBunTemporaryBuildFiles(existingTemporaryFiles)
    }
  }
}
