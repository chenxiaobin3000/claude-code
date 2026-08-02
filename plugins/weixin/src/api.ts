import { randomBytes } from 'node:crypto'
import pluginPackage from '../package.json'
import { assertSessionActive } from './session.js'
import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  NotifyLifecycleResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
  SendTypingResp,
} from './types.js'

const ILINK_APP_ID = 'bot'
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const DEFAULT_API_TIMEOUT_MS = 15_000
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000
const BOT_AGENT_MAX_BYTES = 256

export function buildClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  return (
    ((major & 0xff) << 16) |
    ((minor & 0xff) << 8) |
    (patch & 0xff)
  )
}

export function sanitizeBotAgent(value?: string): string {
  const fallback = `ClaudeCode/${pluginPackage.version}`
  if (!value?.trim()) return fallback
  const token = /^[A-Za-z0-9_.-]{1,32}\/[A-Za-z0-9_.+-]{1,32}$/
  const accepted = value
    .trim()
    .split(/\s+/)
    .filter(part => token.test(part))
    .join(' ')
  if (!accepted || Buffer.byteLength(accepted, 'utf-8') > BOT_AGENT_MAX_BYTES) {
    return fallback
  }
  return accepted
}

export function buildBaseInfo(botAgent?: string): BaseInfo {
  return {
    channel_version: pluginPackage.version,
    bot_agent: sanitizeBotAgent(botAgent),
  }
}

export function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

export function buildCommonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(
      buildClientVersion(pluginPackage.version),
    ),
  }
}

export function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
  }
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

export type FetchErrorKind = 'dns' | 'tcp' | 'tls' | 'timeout' | 'unknown'

export function classifyFetchError(error: unknown): {
  type: FetchErrorKind
  description: string
  code?: string
} {
  if (error instanceof Error && error.name === 'AbortError') {
    return { type: 'timeout', description: 'request timed out or was cancelled' }
  }
  const cause = (error as { cause?: unknown } | undefined)?.cause
  const code =
    typeof (cause as { code?: unknown } | undefined)?.code === 'string'
      ? String((cause as { code: string }).code)
      : undefined
  const detail = `${String(error ?? '')} ${String(cause ?? '')} ${code ?? ''}`
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
    return { type: 'dns', description: 'DNS resolution failed', ...(code && { code }) }
  }
  if (/ECONNREFUSED/i.test(detail)) {
    return { type: 'tcp', description: 'TCP connection refused', ...(code && { code }) }
  }
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(detail)) {
    return { type: 'tcp', description: 'TCP endpoint unreachable', ...(code && { code }) }
  }
  if (/UND_ERR_SOCKET|SSL|TLS|CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(detail)) {
    return { type: 'tls', description: 'TLS connection failed', ...(code && { code }) }
  }
  return { type: 'unknown', description: 'network request failed', ...(code && { code }) }
}

function endpointUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`).toString()
}

function combineAbortSignals(
  timeoutMs: number | undefined,
  external?: AbortSignal,
): { signal?: AbortSignal; cleanup: () => void } {
  if (timeoutMs === undefined && !external) {
    return { cleanup: () => {} }
  }
  const controller = new AbortController()
  const timeout =
    timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined
  const abort = () => controller.abort()
  if (external?.aborted) controller.abort()
  else external?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout !== undefined) clearTimeout(timeout)
      external?.removeEventListener('abort', abort)
    },
  }
}

async function requestJson<T>(params: {
  baseUrl: string
  path: string
  method: 'GET' | 'POST'
  body?: unknown
  token?: string
  timeoutMs?: number
  signal?: AbortSignal
  label: string
}): Promise<T> {
  const { signal, cleanup } = combineAbortSignals(
    params.timeoutMs,
    params.signal,
  )
  try {
    const response = await fetch(endpointUrl(params.baseUrl, params.path), {
      method: params.method,
      headers:
        params.method === 'POST'
          ? buildHeaders(params.token)
          : buildCommonHeaders(),
      ...(params.body !== undefined && { body: JSON.stringify(params.body) }),
      ...(signal && { signal }),
    })
    if (!response.ok) {
      throw new Error(`${params.label} HTTP ${response.status} ${response.statusText}`)
    }
    const text = await response.text()
    try {
      return JSON.parse(text || '{}') as T
    } catch {
      throw new Error(`${params.label} returned invalid JSON`)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (error instanceof Error && error.message.startsWith(`${params.label} `)) {
      throw error
    }
    const classified = classifyFetchError(error)
    throw new Error(
      `${params.label} ${classified.type}: ${classified.description}${classified.code ? ` (${classified.code})` : ''}`,
      { cause: error },
    )
  } finally {
    cleanup()
  }
}

export function apiGetJson<T>(params: {
  baseUrl: string
  path: string
  timeoutMs?: number
  label: string
}): Promise<T> {
  return requestJson<T>({ ...params, method: 'GET' })
}

export function apiPostJson<T>(params: {
  baseUrl: string
  path: string
  body: unknown
  token?: string
  timeoutMs?: number
  signal?: AbortSignal
  label: string
}): Promise<T> {
  return requestJson<T>({ ...params, method: 'POST' })
}

export async function getUpdates(
  baseUrl: string,
  token: string,
  getUpdatesBuf: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS,
): Promise<GetUpdatesResp> {
  const body: GetUpdatesReq = {
    get_updates_buf: getUpdatesBuf,
    base_info: buildBaseInfo(),
  }
  try {
    return await apiPostJson<GetUpdatesResp>({
      baseUrl,
      path: '/ilink/bot/getupdates',
      body,
      token,
      timeoutMs,
      signal,
      label: 'getUpdates',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf }
    }
    throw error
  }
}

export async function sendMessage(
  baseUrl: string,
  token: string,
  msg: SendMessageReq['msg'],
  accountId = 'default',
): Promise<void> {
  assertSessionActive(Date.now(), accountId)
  const response = await apiPostJson<SendMessageResp>({
    baseUrl,
    path: '/ilink/bot/sendmessage',
    body: { msg, base_info: buildBaseInfo() } satisfies SendMessageReq,
    token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: 'sendMessage',
  })
  if (response.ret !== undefined && response.ret !== 0) {
    throw new Error(
      `sendMessage ret=${response.ret} errmsg=${response.errmsg ?? '(none)'}`,
    )
  }
}

export async function getUploadUrl(
  baseUrl: string,
  token: string,
  params: Omit<GetUploadUrlReq, 'base_info'>,
  accountId = 'default',
): Promise<GetUploadUrlResp> {
  assertSessionActive(Date.now(), accountId)
  return apiPostJson<GetUploadUrlResp>({
    baseUrl,
    path: '/ilink/bot/getuploadurl',
    body: { ...params, base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: 'getUploadUrl',
  })
}

export async function getConfig(
  baseUrl: string,
  token: string,
  userId: string,
  contextToken?: string,
  accountId = 'default',
): Promise<GetConfigResp> {
  assertSessionActive(Date.now(), accountId)
  return apiPostJson<GetConfigResp>({
    baseUrl,
    path: '/ilink/bot/getconfig',
    body: {
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: buildBaseInfo(),
    },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'getConfig',
  })
}

export async function sendTyping(
  baseUrl: string,
  token: string,
  req: Omit<SendTypingReq, 'base_info'>,
  accountId = 'default',
): Promise<SendTypingResp> {
  assertSessionActive(Date.now(), accountId)
  return apiPostJson<SendTypingResp>({
    baseUrl,
    path: '/ilink/bot/sendtyping',
    body: { ...req, base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'sendTyping',
  })
}

async function notifyLifecycle(
  baseUrl: string,
  token: string,
  event: 'start' | 'stop',
): Promise<NotifyLifecycleResp> {
  return apiPostJson<NotifyLifecycleResp>({
    baseUrl,
    path: `/ilink/bot/msg/notify${event}`,
    body: { base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: `notify${event[0]!.toUpperCase()}${event.slice(1)}`,
  })
}

export function notifyStart(
  baseUrl: string,
  token: string,
): Promise<NotifyLifecycleResp> {
  return notifyLifecycle(baseUrl, token, 'start')
}

export function notifyStop(
  baseUrl: string,
  token: string,
): Promise<NotifyLifecycleResp> {
  return notifyLifecycle(baseUrl, token, 'stop')
}
