const DEFAULT_MAX_RETRIES = 3
const MAX_RETRIES_CAP = 10
const DEFAULT_MAX_DELAY_MS = 10_000

export interface OpenAIRetryOptions {
  maxRetries: number
  maxDelayMs: number
}

function readBoundedPositiveInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback
  return Math.min(Number(raw), maximum)
}

export function getOpenAIRetryOptions(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIRetryOptions {
  return {
    maxRetries: readBoundedPositiveInteger(
      env.API_MAX_RETRIES,
      DEFAULT_MAX_RETRIES,
      MAX_RETRIES_CAP,
    ),
    maxDelayMs: readBoundedPositiveInteger(
      env.API_RETRY_MAX_DELAY_MS,
      DEFAULT_MAX_DELAY_MS,
      60_000,
    ),
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

export function isRetryableOpenAITransportError(error: unknown): boolean {
  const status = errorStatus(error)
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
  }

  const value = String(
    error instanceof Error ? `${error.name} ${error.message}` : error,
  ).toLowerCase()
  return /timed? ?out|aborterror|econn(?:reset|refused)|enotfound|eai_again|fetch failed|network error|socket hang up|connection (?:closed|reset|dropped)|stream_(?:idle_timeout|ended_before_done)/.test(
    value,
  )
}

export function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

/** attempt starts at 1 for the first retry after the initial request. */
export function getOpenAIRetryDelayMs(
  error: unknown,
  attempt: number,
  options: OpenAIRetryOptions,
  random: () => number = Math.random,
): number {
  const serverDelay = retryAfterMs(error)
  if (serverDelay !== undefined) return Math.min(serverDelay, options.maxDelayMs)
  const capped = Math.min(500 * 2 ** Math.max(0, attempt - 1), options.maxDelayMs)
  // Full jitter prevents multiple local CLI instances from retrying in lockstep.
  return Math.floor(capped * (0.5 + Math.max(0, Math.min(1, random())) * 0.5))
}

export function hasVisibleOpenAIChunk(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') return false
  const choices = (chunk as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return false
  return choices.some(choice => {
    if (!choice || typeof choice !== 'object') return false
    const delta = (choice as { delta?: unknown }).delta
    if (!delta || typeof delta !== 'object') return false
    const record = delta as Record<string, unknown>
    return Boolean(
      (typeof record.content === 'string' && record.content.length > 0) ||
        (typeof record.reasoning_content === 'string' &&
          record.reasoning_content.length > 0) ||
        (typeof record.reasoning === 'string' && record.reasoning.length > 0) ||
        (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) ||
        (record.function_call !== null &&
          typeof record.function_call === 'object'),
    )
  })
}
