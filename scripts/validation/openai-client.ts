#!/usr/bin/env bun

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions/completions.mjs'
import { getOpenAIClient } from '../../src/services/api/openai/client.js'
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

console.log('[openai-client] PASS')
