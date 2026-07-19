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
    { status, code },
  )
}

async function* parseChatCompletionSSE(
  response: Response,
  clearRequestTimeout: () => void,
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
      const result = await reader.read()
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
        if (!data || data === '[DONE]') continue
        yield JSON.parse(data) as ChatCompletionChunk
      }
    }
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

    let response: Response
    try {
      response = await fetchWithUsage(
        `${target.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          ...getProxyFetchOptions({ forAnthropicAPI: false }),
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        } as RequestInit,
      )
    } catch (error) {
      clearRequestTimeout()
      throw error
    }
    if (!response.ok) {
      clearRequestTimeout()
      const responseBody = await response.text().catch(() => '')
      throw requestError(
        response.status,
        response.statusText,
        responseBody.slice(0, 4_000),
      )
    }
    if (body.stream) {
      return parseChatCompletionSSE(response, clearRequestTimeout)
    }
    try {
      return (await response.json()) as ChatCompletion
    } finally {
      clearRequestTimeout()
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
