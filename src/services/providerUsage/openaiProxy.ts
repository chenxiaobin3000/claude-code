import { resolveModelTarget } from '../../utils/model/modelRegistry.js'

export const OPENAI_PROXY_LOCAL_TOKEN_ENV = 'OPENAI_PROXY_LOCAL_TOKEN' as const

export interface OpenAIProxyQuotaWindow {
  remainingPercent: number
  windowMinutes?: number
}

export interface OpenAIProxyQuotaSnapshot {
  primary?: OpenAIProxyQuotaWindow
  secondary?: OpenAIProxyQuotaWindow
  capturedAt: number
}

export interface OpenAIProxyUsageTarget {
  endpoint: string
  retainEndpoint: string
  releaseEndpoint: string
  token: string
}

type ModelUsageCandidate = {
  baseUrl: string
  apiKeyEnv?: string
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '[::1]' ||
    normalized === '::1'
  )
}

export function resolveOpenAIProxyUsageTarget(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): OpenAIProxyUsageTarget | null {
  try {
    const target = resolveModelTarget(model)
    return openAIProxyUsageTargetFromModel(target, env)
  } catch {
    return null
  }
}

export function openAIProxyUsageTargetFromModel(
  target: ModelUsageCandidate,
  env: NodeJS.ProcessEnv,
): OpenAIProxyUsageTarget | null {
  if (target.apiKeyEnv !== OPENAI_PROXY_LOCAL_TOKEN_ENV) return null
  let baseUrl: URL
  try {
    baseUrl = new URL(target.baseUrl)
  } catch {
    return null
  }
  if (!isLoopback(baseUrl.hostname)) return null
  const token = env[OPENAI_PROXY_LOCAL_TOKEN_ENV]?.trim()
  if (!token) return null
  return {
    endpoint: `${target.baseUrl.replace(/\/$/, '')}/usage`,
    retainEndpoint: `${baseUrl.origin}/control/client/retain`,
    releaseEndpoint: `${baseUrl.origin}/control/client/release`,
    token,
  }
}

function parseQuotaWindow(value: unknown): OpenAIProxyQuotaWindow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const raw = record.remainingPercent
  if (
    (typeof raw !== 'number' && typeof raw !== 'string') ||
    (typeof raw === 'string' && raw.trim() === '')
  ) {
    return undefined
  }
  const number = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(number)) return undefined
  const rawWindowMinutes = record.windowMinutes
  const windowMinutes =
    typeof rawWindowMinutes === 'number' &&
    Number.isFinite(rawWindowMinutes) &&
    rawWindowMinutes > 0
      ? Math.round(rawWindowMinutes)
      : undefined
  return {
    remainingPercent: Math.min(100, Math.max(0, number)),
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
  }
}

function formatWindowLabel(
  window: OpenAIProxyQuotaWindow,
  fallback: '5h' | '7d',
): string {
  const minutes = window.windowMinutes
  if (minutes === undefined) return fallback
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

export function formatOpenAIProxyQuota(
  snapshot: OpenAIProxyQuotaSnapshot,
): string {
  return (
    [
      snapshot.primary
        ? { window: snapshot.primary, fallback: '5h' as const }
        : undefined,
      snapshot.secondary
        ? { window: snapshot.secondary, fallback: '7d' as const }
        : undefined,
    ] as const
  )
    .filter(
      (
        value,
      ): value is {
        window: OpenAIProxyQuotaWindow
        fallback: '5h' | '7d'
      } => value !== undefined,
    )
    .sort(
      (left, right) =>
        (left.window.windowMinutes ?? Number.MAX_SAFE_INTEGER) -
        (right.window.windowMinutes ?? Number.MAX_SAFE_INTEGER),
    )
    .map(
      ({ window, fallback }) =>
        `${formatWindowLabel(window, fallback)}: ${Math.round(window.remainingPercent)}%`,
    )
    .join(' · ')
}

export function parseOpenAIProxyQuotaSnapshot(
  value: unknown,
): OpenAIProxyQuotaSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const primary = parseQuotaWindow(body.primary)
  const secondary = parseQuotaWindow(body.secondary)
  const capturedAt =
    typeof body.capturedAt === 'number' && Number.isFinite(body.capturedAt)
      ? body.capturedAt
      : undefined
  if (
    (primary === undefined && secondary === undefined) ||
    capturedAt === undefined
  ) {
    return null
  }
  return {
    ...(primary !== undefined ? { primary } : {}),
    ...(secondary !== undefined ? { secondary } : {}),
    capturedAt,
  }
}
