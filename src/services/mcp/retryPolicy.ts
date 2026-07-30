import type { ScopedMcpServerConfig } from './types.js'
import { getMcpHttpStatus } from './security.js'

export const MCP_STARTUP_MAX_ATTEMPTS = 3
export const MCP_STARTUP_INITIAL_BACKOFF_MS = 1000

export function isRemoteMcpConfig(config: ScopedMcpServerConfig): boolean {
  return config.type === 'http' || config.type === 'sse'
}

/**
 * Initial startup retries are deliberately narrower than reconnect retries:
 * only transport failures and 5xx responses are transient. Authentication,
 * not-found, invalid configuration and local spawn errors require user action.
 */
export function isTransientMcpStartupError(error: unknown): boolean {
  const status = getMcpHttpStatus(error)
  if (status !== undefined) return status >= 500 && status <= 599

  const message = error instanceof Error ? error.message : String(error)
  return /(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up|network error|fetch failed|connection timed out|connection timeout)/i.test(
    message,
  )
}

export function getMcpStartupBackoffMs(completedAttempt: number): number {
  return MCP_STARTUP_INITIAL_BACKOFF_MS * 2 ** Math.max(0, completedAttempt - 1)
}

