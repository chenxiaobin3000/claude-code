import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions/completions.mjs'
import { openaiAdapter } from 'src/services/providerUsage/adapters/openai.js'
import { updateProviderBuckets } from 'src/services/providerUsage/store.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import type { ResolvedModelTarget } from 'src/utils/model/modelRegistry.js'
import { logForDebugging } from 'src/utils/debug.js'
import { OpenAIStreamInterruptedError } from './errorClassification.js'
import {
  getOpenAIRetryDelayMs,
  getOpenAIRetryOptions,
  hasVisibleOpenAIChunk,
  isRetryableOpenAITransportError,
} from './retryPolicy.js'

type CreateOptions = { signal?: AbortSignal }

export type OpenAICompatibleClient = {
  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParamsStreaming,
        options: CreateOptions,
      ): Promise<AsyncIterable<ChatCompletionChunk>>
      create(
        body: ChatCompletionCreateParamsNonStreaming,
        options: CreateOptions,
      ): Promise<ChatCompletion>
    }
  }
}

const cachedClients = new Map<string, OpenAICompatibleClient>()

function wrapFetchForUsage(base: typeof fetch): typeof fetch {
  const wrapped = async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const response = await base(...args)
    try {
      updateProviderBuckets(
        'openai',
        openaiAdapter.parseHeaders(response.headers),
      )
    } catch {
      // Usage tracking must never affect the model request.
    }
    return response
  }
  return wrapped as unknown as typeof fetch
}

function requestError(
  status: number,
  statusText: string,
  body: string,
  retryAfterMs?: number,
): Error {
  let message = body.trim()
  let code: string | undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const error = parsed.error as Record<string, unknown> | undefined
    if (typeof error?.message === 'string') message = error.message
    if (typeof error?.code === 'string') code = error.code
  } catch {
    // Plain-text errors are valid for some compatible endpoints.
  }
  return Object.assign(
    new Error(
      message ||
        `OpenAI-compatible request failed with HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
    ),
    { status, code, retryAfterMs },
  )
}

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return Number(raw) * 1000
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now())
}

function streamInterruptReason(error: unknown): OpenAIStreamInterruptedError['reason'] {
  const status =
    error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined
  if (status !== undefined && status >= 500) return 'server_error'
  const message = String(error instanceof Error ? error.message : error)
  return /idle_timeout|timed? ?out/i.test(message)
    ? 'stream_stalled'
    : 'connection_closed'
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.API_STREAM_IDLE_TIMEOUT_MS?.trim()
  if (!raw || !/^\d+$/.test(raw)) return 120_000
  return Math.min(Number(raw), 2_147_483_647)
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> {
  if (idleTimeoutMs <= 0) return reader.read()
  return new Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void reader.cancel()
      reject(
        Object.assign(
          new Error('openai_stream_idle_timeout: stream stopped sending data'),
          { code: 'openai_stream_idle_timeout' },
        ),
      )
    }, idleTimeoutMs)
    void reader.read().then(
      result => {
        clearTimeout(timeout)
        resolve(result)
      },
      error => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function* parseChatCompletionSSE(
  response: Response,
  clearRequestTimeout: () => void,
  requestTimedOut: () => boolean,
  idleTimeoutMs: number,
): AsyncGenerator<ChatCompletionChunk> {
  try {
    if (!response.body) {
      throw new Error('invalid_chat_completion_response: response body is empty')
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('text/event-stream')) {
      throw new Error(
        `invalid_chat_completion_response: expected text/event-stream but received ${contentType || 'no content type'}`,
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false
    while (!done) {
      const result = await readStreamChunk(reader, idleTimeoutMs)
      done = result.done
      buffer += decoder.decode(result.value, { stream: !done })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        if (data === '[DONE]') {
          return
        }
        yield JSON.parse(data) as ChatCompletionChunk
      }
    }
    if (requestTimedOut()) {
      throw new DOMException('OpenAI-compatible request timed out', 'TimeoutError')
    }
    throw Object.assign(
      new Error('openai_stream_ended_before_done: stream ended without [DONE]'),
      { code: 'openai_stream_ended_before_done' },
    )
  } finally {
    clearRequestTimeout()
  }
}

function createClient(options: {
  target: ResolvedModelTarget
  fetchOverride?: typeof fetch
}): OpenAICompatibleClient {
  const { target } = options
  const baseFetch = options.fetchOverride ?? (globalThis.fetch as typeof fetch)
  const fetchWithUsage = wrapFetchForUsage(baseFetch)

  const create = async (
    body:
      | ChatCompletionCreateParamsStreaming
      | ChatCompletionCreateParamsNonStreaming,
    requestOptions: CreateOptions,
  ): Promise<AsyncIterable<ChatCompletionChunk> | ChatCompletion> => {
    const timeoutMs = parseInt(
      process.env.API_TIMEOUT_MS || String(600 * 1000),
      10,
    )
    const headers: Record<string, string> = {
      Accept: body.stream ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${target.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (process.env.OPENAI_ORG_ID) {
      headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID
    }
    if (process.env.OPENAI_PROJECT_ID) {
      headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID
    }

    const requestOnce = async (): Promise<{
      response: Response
      clearRequestTimeout: () => void
      requestTimedOut: () => boolean
    }> => {
      const timeoutController = new AbortController()
      const timeout = setTimeout(() => {
        timeoutController.abort(
          new DOMException('OpenAI-compatible request timed out', 'TimeoutError'),
        )
      }, timeoutMs)
      const clearRequestTimeout = () => clearTimeout(timeout)
      const signal = AbortSignal.any([
        ...(requestOptions.signal ? [requestOptions.signal] : []),
        timeoutController.signal,
      ])
      try {
        const response = await fetchWithUsage(
          `${target.baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            ...getProxyFetchOptions({ forAnthropicAPI: false }),
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
          } as RequestInit,
        )
        if (!response.ok) {
          const responseBody = await response.text().catch(() => '')
          throw requestError(
            response.status,
            response.statusText,
            responseBody.slice(0, 4_000),
            parseRetryAfterMs(response),
          )
        }
        return {
          response,
          clearRequestTimeout,
          requestTimedOut: () => timeoutController.signal.aborted,
        }
      } catch (error) {
        clearRequestTimeout()
        if (timeoutController.signal.aborted && !requestOptions.signal?.aborted) {
          throw new DOMException('OpenAI-compatible request timed out', 'TimeoutError')
        }
        throw error
      }
    }
    if (body.stream) {
      const retryOptions = getOpenAIRetryOptions()
      const idleTimeoutMs = readIdleTimeoutMs()
      return (async function* (): AsyncGenerator<ChatCompletionChunk> {
        let retryAttempt = 0
        for (;;) {
          let visibleOutput = false
          try {
            const attempt = await requestOnce()
            for await (const chunk of parseChatCompletionSSE(
              attempt.response,
              attempt.clearRequestTimeout,
              attempt.requestTimedOut,
              idleTimeoutMs,
            )) {
              visibleOutput = visibleOutput || hasVisibleOpenAIChunk(chunk)
              yield chunk
            }
            return
          } catch (error) {
            if (requestOptions.signal?.aborted) throw error
            if (visibleOutput) {
              throw new OpenAIStreamInterruptedError(
                streamInterruptReason(error),
                error,
              )
            }
            if (
              retryAttempt >= retryOptions.maxRetries ||
              !isRetryableOpenAITransportError(error)
            ) {
              throw error
            }
            retryAttempt++
            const delayMs = getOpenAIRetryDelayMs(
              error,
              retryAttempt,
              retryOptions,
            )
            logForDebugging(
              `[OpenAI] retrying request in ${delayMs}ms (attempt ${retryAttempt}/${retryOptions.maxRetries})`,
              { level: 'warn' },
            )
            await waitForRetry(delayMs, requestOptions.signal ?? new AbortController().signal)
          }
        }
      })()
    }
    let retryAttempt = 0
    const retryOptions = getOpenAIRetryOptions()
    for (;;) {
      try {
        const attempt = await requestOnce()
        try {
          return (await attempt.response.json()) as ChatCompletion
        } finally {
          attempt.clearRequestTimeout()
        }
      } catch (error) {
        if (
          requestOptions.signal?.aborted ||
          retryAttempt >= retryOptions.maxRetries ||
          !isRetryableOpenAITransportError(error)
        ) {
          throw error
        }
        retryAttempt++
        await waitForRetry(
          getOpenAIRetryDelayMs(error, retryAttempt, retryOptions),
          requestOptions.signal ?? new AbortController().signal,
        )
      }
    }
  }

  return {
    chat: {
      completions: {
        create: create as OpenAICompatibleClient['chat']['completions']['create'],
      },
    },
  }
}

export function getOpenAIClient(options: {
  target: ResolvedModelTarget
  maxRetries?: number
  fetchOverride?: typeof fetch
  source?: string
}): OpenAICompatibleClient {
  const { target } = options
  const cacheKey = `${target.baseUrl}\0${target.apiKeyEnv ?? 'OPENAI_API_KEY'}`
  if (!options.fetchOverride) {
    const cached = cachedClients.get(cacheKey)
    if (cached) return cached
  }
  const client = createClient(options)
  if (!options.fetchOverride) cachedClients.set(cacheKey, client)
  return client
}

export function clearOpenAIClientCache(): void {
  cachedClients.clear()
}
