import { OpenAIProxyAuth } from './auth/oauth.js'
import type { OpenAIProxySession } from './auth/session.js'
import {
  createOpenAIUpstreamFetch,
  type OpenAIUpstreamFetch,
} from './upstreamProxy.js'
import { OpenAIProxyModelError, type ModelTransport } from './model/types.js'

export const OPENAI_CHATGPT_BACKEND = 'https://chatgpt.com/backend-api' as const

const USAGE_TIMEOUT_MS = 10_000
const USAGE_CACHE_TTL_MS = 60_000
const MAX_USAGE_RESPONSE_BYTES = 1024 * 1024

export interface OpenAIProxyUsageWindow {
  usedPercent: number
  remainingPercent: number
  windowMinutes?: number
  resetsAt?: number
}

export interface OpenAIProxyUsageSnapshot {
  primary?: OpenAIProxyUsageWindow
  secondary?: OpenAIProxyUsageWindow
  capturedAt: number
}

interface UsageAuth {
  getValidSession(): Promise<OpenAIProxySession>
  forceRefreshSession(): Promise<OpenAIProxySession>
}

interface OpenAIProxyUsageServiceOptions {
  auth?: UsageAuth
  transport?: ModelTransport
  baseUrl?: string
  version?: string
  timeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
}

function configuredTransport(): ModelTransport {
  const upstream: OpenAIUpstreamFetch = createOpenAIUpstreamFetch()
  return request =>
    upstream.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      redirect: 'error',
    })
}

function headers(
  session: OpenAIProxySession,
  version: string,
): Record<string, string> {
  if (!session.account.accountId) {
    throw new OpenAIProxyModelError(
      'The OpenAI session has no ChatGPT account id; log in again.',
      'missing_chatgpt_account_id',
      401,
    )
  }
  return {
    authorization: `Bearer ${session.tokens.accessToken}`,
    'chatgpt-account-id': session.account.accountId,
    ...(session.account.isFedramp && { 'x-openai-fedramp': 'true' }),
    originator: 'codex_cli_rs',
    'user-agent': `openai-proxy/${version}`,
    accept: 'application/json',
  }
}

function finiteNumber(value: unknown): number | undefined {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return undefined
  }
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function boundedUsageJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_USAGE_RESPONSE_BYTES) {
    throw new OpenAIProxyModelError(
      'OpenAI usage response exceeded 1 MiB.',
      'usage_response_too_large',
      502,
    )
  }
  if (!response.body) {
    throw new OpenAIProxyModelError(
      'OpenAI usage endpoint returned an empty response.',
      'invalid_usage_response',
      502,
    )
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_USAGE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new OpenAIProxyModelError(
          'OpenAI usage response exceeded 1 MiB.',
          'usage_response_too_large',
          502,
        )
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new OpenAIProxyModelError(
      'OpenAI usage endpoint returned invalid JSON.',
      'invalid_usage_response',
      502,
    )
  }
}

function parseWindow(value: unknown): OpenAIProxyUsageWindow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const usedPercent = finiteNumber(record.used_percent)
  if (usedPercent === undefined) return undefined
  const normalizedUsed = Math.min(100, Math.max(0, usedPercent))
  const windowSeconds = finiteNumber(record.limit_window_seconds)
  const resetsAt = finiteNumber(record.reset_at)
  return {
    usedPercent: normalizedUsed,
    remainingPercent: Math.min(100, Math.max(0, 100 - normalizedUsed)),
    ...(windowSeconds !== undefined && windowSeconds > 0
      ? { windowMinutes: Math.ceil(windowSeconds / 60) }
      : {}),
    ...(resetsAt !== undefined && resetsAt > 0
      ? { resetsAt: Math.floor(resetsAt) }
      : {}),
  }
}

export function parseOpenAIProxyUsage(
  value: unknown,
  capturedAt = Date.now(),
): OpenAIProxyUsageSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenAIProxyModelError(
      'OpenAI usage endpoint returned invalid JSON.',
      'invalid_usage_response',
      502,
    )
  }
  const body = value as Record<string, unknown>
  const rateLimit =
    body.rate_limit &&
    typeof body.rate_limit === 'object' &&
    !Array.isArray(body.rate_limit)
      ? (body.rate_limit as Record<string, unknown>)
      : undefined
  const primary = parseWindow(rateLimit?.primary_window)
  const secondary = parseWindow(rateLimit?.secondary_window)
  if (!primary && !secondary) {
    throw new OpenAIProxyModelError(
      'OpenAI usage endpoint returned no supported rate-limit windows.',
      'usage_windows_unavailable',
      502,
    )
  }
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    capturedAt,
  }
}

export class OpenAIProxyUsageService {
  private readonly auth: UsageAuth
  private readonly transport: ModelTransport
  private readonly baseUrl: string
  private readonly version: string
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private cached?: OpenAIProxyUsageSnapshot

  constructor(options: OpenAIProxyUsageServiceOptions = {}) {
    this.auth = options.auth ?? new OpenAIProxyAuth()
    this.transport = options.transport ?? configuredTransport()
    this.baseUrl = (options.baseUrl ?? OPENAI_CHATGPT_BACKEND).replace(
      /\/$/,
      '',
    )
    this.version = options.version ?? '0.1.0'
    this.timeoutMs = options.timeoutMs ?? USAGE_TIMEOUT_MS
    this.cacheTtlMs = options.cacheTtlMs ?? USAGE_CACHE_TTL_MS
    this.now = options.now ?? Date.now
  }

  private async send(
    session: OpenAIProxySession,
    signal: AbortSignal,
  ): Promise<Response> {
    return this.transport({
      url: `${this.baseUrl}/wham/usage`,
      method: 'GET',
      headers: headers(session, this.version),
      signal,
    })
  }

  async usage(signal: AbortSignal): Promise<OpenAIProxyUsageSnapshot> {
    if (this.cached && this.now() - this.cached.capturedAt < this.cacheTtlMs) {
      return this.cached
    }

    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(
      () => controller.abort(new Error('OpenAI usage request timed out.')),
      this.timeoutMs,
    )

    try {
      let session = await this.auth.getValidSession()
      let response = await this.send(session, controller.signal)
      if (response.status === 401) {
        await response.body?.cancel().catch(() => undefined)
        session = await this.auth.forceRefreshSession()
        response = await this.send(session, controller.signal)
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new OpenAIProxyModelError(
          `OpenAI usage request failed (${response.status}).`,
          `usage_upstream_${response.status}`,
          response.status === 401 || response.status === 403
            ? response.status
            : 502,
        )
      }
      const snapshot = parseOpenAIProxyUsage(
        await boundedUsageJson(response),
        this.now(),
      )
      this.cached = snapshot
      return snapshot
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }
}
