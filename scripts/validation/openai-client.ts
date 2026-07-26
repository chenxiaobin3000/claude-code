#!/usr/bin/env bun

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions/completions.mjs'
import { getOpenAIClient } from '../../src/services/api/openai/client.js'
import { OpenAIStreamInterruptedError } from '../../src/services/api/openai/errorClassification.js'
import {
  getOpenAIRetryDelayMs,
  getOpenAIRetryOptions,
  hasVisibleOpenAIChunk,
  isRetryableOpenAITransportError,
} from '../../src/services/api/openai/retryPolicy.js'
import type { ResolvedModelTarget } from '../../src/utils/model/modelRegistry.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[openai-client] ${message}`)
}

const target = {
  model: 'validation-model',
  baseUrl: 'http://127.0.0.1:39999/v1',
  apiKey: 'validation-secret',
  apiKeyEnv: 'VALIDATION_API_KEY',
} as ResolvedModelTarget

let streamRequestChecked = false
const streamFetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  assert(String(input).endsWith('/v1/chat/completions'), 'incorrect Chat Completions URL')
  assert(init?.method === 'POST', 'request must use POST')
  const headers = new Headers(init?.headers)
  assert(headers.get('authorization') === 'Bearer validation-secret', 'missing API key header')
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  assert(body.stream === true, 'stream request lost stream=true')
  streamRequestChecked = true
  return new Response(
    'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1,"model":"validation-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}) as typeof fetch

const streamClient = getOpenAIClient({ target, fetchOverride: streamFetch })
const stream = await streamClient.chat.completions.create(
  {
    model: target.model,
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  } satisfies ChatCompletionCreateParamsStreaming,
  {},
)
const chunks = []
for await (const chunk of stream) chunks.push(chunk)
assert(streamRequestChecked, 'stream fetch was not called')
assert(chunks.length === 1, 'stream parser returned the wrong chunk count')
assert(chunks[0]?.choices[0]?.delta.content === 'ok', 'stream content was not preserved')

const jsonFetch = (async (): Promise<Response> =>
  new Response(
    JSON.stringify({
      id: 'completion-1',
      object: 'chat.completion',
      created: 1,
      model: target.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'json-ok', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch
const jsonClient = getOpenAIClient({ target, fetchOverride: jsonFetch })
const completion = await jsonClient.chat.completions.create(
  {
    model: target.model,
    messages: [{ role: 'user', content: 'hello' }],
  } satisfies ChatCompletionCreateParamsNonStreaming,
  {},
)
assert(completion.choices[0]?.message.content === 'json-ok', 'JSON response was not preserved')

const errorFetch = (async (): Promise<Response> =>
  new Response(
    JSON.stringify({ error: { message: 'bad key', code: 'invalid_api_key' } }),
    { status: 401, statusText: 'Unauthorized' },
  )) as typeof fetch
const errorClient = getOpenAIClient({ target, fetchOverride: errorFetch })
let requestError: unknown
try {
  await errorClient.chat.completions.create(
    {
      model: target.model,
      messages: [{ role: 'user', content: 'hello' }],
    } satisfies ChatCompletionCreateParamsNonStreaming,
    {},
  )
} catch (error) {
  requestError = error
}
assert(requestError instanceof Error, 'HTTP error did not reject')
assert(
  (requestError as Error & { status?: number }).status === 401,
  'HTTP status was not attached to the error',
)
assert(
  (requestError as Error & { code?: string }).code === 'invalid_api_key',
  'provider error code was not attached to the error',
)

assert(
  hasVisibleOpenAIChunk({ choices: [{ delta: { content: 'visible' } }] }),
  'text chunk was not recognized as visible output',
)
assert(
  !hasVisibleOpenAIChunk({ choices: [{ delta: { role: 'assistant' } }] }),
  'metadata-only chunk was treated as visible output',
)
assert(
  isRetryableOpenAITransportError(Object.assign(new Error('busy'), { status: 503 })),
  'server error was not retryable',
)
assert(
  !isRetryableOpenAITransportError(Object.assign(new Error('bad key'), { status: 401 })),
  'authentication error was retryable',
)
const retryOptions = getOpenAIRetryOptions({ API_MAX_RETRIES: '2' })
assert(retryOptions.maxRetries === 2, 'retry option was not parsed')
assert(
  getOpenAIRetryDelayMs(new Error('network error'), 1, retryOptions, () => 0) === 250,
  'retry delay was not deterministic at the lower jitter bound',
)

const previousRetries = process.env.API_MAX_RETRIES
process.env.API_MAX_RETRIES = '1'
let retryFetchCalls = 0
const retryFetch = (async (): Promise<Response> => {
  retryFetchCalls++
  if (retryFetchCalls === 1) return new Response('temporary outage', { status: 503 })
  return new Response(
    'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1,"model":"validation-model","choices":[{"index":0,"delta":{"content":"retried"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}) as typeof fetch
try {
  const retryClient = getOpenAIClient({ target, fetchOverride: retryFetch })
  const retryStream = await retryClient.chat.completions.create(
    {
      model: target.model,
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    } satisfies ChatCompletionCreateParamsStreaming,
    {},
  )
  for await (const _chunk of retryStream) {
    // Consumption triggers the retrying stream.
  }
  assert(retryFetchCalls === 2, 'pre-output server failure was not retried')
} finally {
  if (previousRetries === undefined) delete process.env.API_MAX_RETRIES
  else process.env.API_MAX_RETRIES = previousRetries
}

let partialFetchCalls = 0
const partialFetch = (async (): Promise<Response> => {
  partialFetchCalls++
  return new Response(
    'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1,"model":"validation-model","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}) as typeof fetch
const partialClient = getOpenAIClient({ target, fetchOverride: partialFetch })
let partialError: unknown
try {
  const partialStream = await partialClient.chat.completions.create(
    {
      model: target.model,
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    } satisfies ChatCompletionCreateParamsStreaming,
    {},
  )
  for await (const _chunk of partialStream) {
    // The visible chunk must remain available before the interrupted error.
  }
} catch (error) {
  partialError = error
}
assert(partialError instanceof OpenAIStreamInterruptedError, 'visible partial stream was replayed or lost')
assert(partialFetchCalls === 1, 'visible partial stream was retried')

console.log('[openai-client] PASS')
