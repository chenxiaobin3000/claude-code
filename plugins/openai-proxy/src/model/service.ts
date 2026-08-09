import { OpenAIProxyAuth } from '../auth/oauth.js'
import type { OpenAIProxySession } from '../auth/session.js'
import { chatCompletionsToResponses } from './convert.js'
import { adaptResponsesSse } from './sse.js'
import {
  OpenAIProxyModelError,
  type JsonObject,
  type ModelRequest,
  type ModelTransport,
} from './types.js'
import { createOpenAIUpstreamFetch } from '../upstreamProxy.js'

export const OPENAI_CODEX_BACKEND =
  'https://chatgpt.com/backend-api/codex' as const
const MAX_LOCAL_REQUEST_BYTES = 32 * 1024 * 1024
const MODEL_TIMEOUT_MS = 5 * 60_000

export const directModelTransport: ModelTransport = request =>
  fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: 'error',
  })

export function createConfiguredModelTransport(): ModelTransport {
  const upstream = createOpenAIUpstreamFetch()
  return request =>
    upstream.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      redirect: 'error',
    })
}

export interface OpenAIProxyModelServiceOptions {
  auth?: ModelAuth
  transport?: ModelTransport
  baseUrl?: string
  version?: string
  timeoutMs?: number
}

export interface ModelAuth {
  getValidSession(): Promise<OpenAIProxySession>
  forceRefreshSession(): Promise<OpenAIProxySession>
}

function linkedAbortSignal(
  source: AbortSignal,
  timeoutMs: number,
): {
  controller: AbortController
  cleanup(): void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(source.reason)
  if (source.aborted) abort()
  else source.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('OpenAI upstream timed out.')),
    timeoutMs,
  )
  return {
    controller,
    cleanup() {
      clearTimeout(timeout)
      source.removeEventListener('abort', abort)
    },
  }
}

function upstreamHeaders(
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
    accept: 'text/event-stream',
    'content-type': 'application/json',
  }
}

async function boundedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_LOCAL_REQUEST_BYTES) {
    throw new OpenAIProxyModelError(
      'Request body exceeded 32 MiB.',
      'request_too_large',
      413,
    )
  }
  const text = await readBoundedText(
    request.body,
    MAX_LOCAL_REQUEST_BYTES,
    () =>
      new OpenAIProxyModelError(
        'Request body exceeded 32 MiB.',
        'request_too_large',
        413,
      ),
  )
  try {
    return JSON.parse(text)
  } catch {
    throw new OpenAIProxyModelError(
      'Request body is not valid JSON.',
      'invalid_json',
      400,
    )
  }
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  tooLarge: () => Error,
): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return text + decoder.decode()
      size += chunk.value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

async function boundedError(response: Response): Promise<string> {
  await readBoundedText(response.body, 64 * 1024, () => new Error()).catch(
    () => undefined,
  )
  return `OpenAI upstream rejected the request (${response.status}).`
}

async function boundedResponseJson(response: Response): Promise<JsonObject> {
  const text = await readBoundedText(
    response.body,
    4 * 1024 * 1024,
    () =>
      new OpenAIProxyModelError(
        'OpenAI model catalog exceeded 4 MiB.',
        'upstream_response_too_large',
        502,
      ),
  )
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object')
    }
    return value as JsonObject
  } catch {
    throw new OpenAIProxyModelError(
      'OpenAI model catalog returned invalid JSON.',
      'invalid_upstream_response',
      502,
    )
  }
}

function mappedUpstreamStatus(status: number): number {
  if (status === 401 || status === 403 || status === 429) return status
  return status >= 400 && status < 500 ? 400 : 502
}

export class OpenAIProxyModelService {
  private readonly auth: ModelAuth
  private readonly transport: ModelTransport
  private readonly baseUrl: string
  private readonly version: string
  private readonly timeoutMs: number

  constructor(options: OpenAIProxyModelServiceOptions = {}) {
    this.auth = options.auth ?? new OpenAIProxyAuth()
    this.transport = options.transport ?? createConfiguredModelTransport()
    this.baseUrl = (options.baseUrl ?? OPENAI_CODEX_BACKEND).replace(/\/$/, '')
    this.version = options.version ?? '0.1.0'
    this.timeoutMs = options.timeoutMs ?? MODEL_TIMEOUT_MS
  }

  private async send(
    session: OpenAIProxySession,
    request: Omit<ModelRequest, 'headers'>,
    accept: string,
  ): Promise<Response> {
    return this.transport({
      ...request,
      headers: { ...upstreamHeaders(session, this.version), accept },
    })
  }

  private async sendWithAuthRecovery(
    session: OpenAIProxySession,
    request: Omit<ModelRequest, 'headers'>,
    accept: string,
  ): Promise<Response> {
    const first = await this.send(session, request, accept)
    if (first.status !== 401) return first
    await first.body?.cancel().catch(() => undefined)
    const refreshed = await this.auth.forceRefreshSession()
    return this.send(refreshed, request, accept)
  }

  async models(signal: AbortSignal): Promise<Response> {
    const session = await this.auth.getValidSession()
    const linked = linkedAbortSignal(signal, this.timeoutMs)
    try {
      const url = new URL(`${this.baseUrl}/models`)
      url.searchParams.set('client_version', this.version)
      const response = await this.sendWithAuthRecovery(
        session,
        {
          url: url.toString(),
          method: 'GET',
          signal: linked.controller.signal,
        },
        'application/json',
      )
      if (!response.ok) {
        throw new OpenAIProxyModelError(
          await boundedError(response),
          `upstream_${response.status}`,
          mappedUpstreamStatus(response.status),
        )
      }
      const body = await boundedResponseJson(response)
      const models = Array.isArray(body.models)
        ? body.models
        : Array.isArray(body.data)
          ? body.data
          : []
      const data = models.flatMap(raw => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
          return []
        const item = raw as JsonObject
        const id =
          typeof item.slug === 'string'
            ? item.slug
            : typeof item.id === 'string'
              ? item.id
              : undefined
        return id ? [{ id, object: 'model', owned_by: 'openai' }] : []
      })
      return Response.json(
        { object: 'list', data },
        {
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        },
      )
    } finally {
      linked.cleanup()
    }
  }

  async chatCompletions(request: Request): Promise<Response> {
    const body = chatCompletionsToResponses(await boundedJson(request))
    const session = await this.auth.getValidSession()
    const linked = linkedAbortSignal(request.signal, this.timeoutMs)
    let response: Response
    try {
      response = await this.sendWithAuthRecovery(
        session,
        {
          url: `${this.baseUrl}/responses`,
          method: 'POST',
          body: JSON.stringify(body),
          signal: linked.controller.signal,
        },
        'text/event-stream',
      )
    } catch (error) {
      linked.cleanup()
      throw error
    }
    if (!response.ok) {
      linked.cleanup()
      throw new OpenAIProxyModelError(
        await boundedError(response),
        `upstream_${response.status}`,
        mappedUpstreamStatus(response.status),
      )
    }
    return adaptResponsesSse(
      response,
      body.model,
      linked.controller,
      linked.cleanup,
    )
  }
}
