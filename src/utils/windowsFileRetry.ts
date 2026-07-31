import { getErrnoCode } from './errors.js'

export const WINDOWS_FILE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const
const TRANSIENT_WINDOWS_FILE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export type WindowsFileRetryOptions = {
  platform?: NodeJS.Platform
  random?: () => number
  sleep?: (delayMs: number) => Promise<void>
  beforeRetry?: (attempt: number) => void | Promise<void>
}

export function isTransientWindowsFileError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === 'win32' &&
    TRANSIENT_WINDOWS_FILE_CODES.has(getErrnoCode(error) ?? '')
  )
}

/** Retry only a Windows sharing-conflict failure; business validation errors
 * and non-Windows failures are never retried. */
export async function withWindowsFileRetry<T>(
  operation: (attempt: number) => T | Promise<T>,
  options: WindowsFileRetryOptions = {},
): Promise<T> {
  const platform = options.platform ?? process.platform
  const random = options.random ?? Math.random
  const sleep =
    options.sleep ??
    (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt)
    } catch (error) {
      const retryDelay = WINDOWS_FILE_RETRY_DELAYS_MS[attempt]
      if (
        retryDelay === undefined ||
        !isTransientWindowsFileError(error, platform)
      ) {
        throw error
      }
      const jitteredDelay = Math.round(retryDelay * (0.75 + random() * 0.5))
      await sleep(jitteredDelay)
      await options.beforeRetry?.(attempt + 1)
    }
  }
}
