#!/usr/bin/env bun

import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import {
  assertOpenAIChatCompletionResponse,
  classifyOpenAIError,
  validateOpenAIChatCompletionStream,
  type OpenAIErrorKind,
} from '../../src/services/api/openai/errorClassification.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function providerError(
  message: string,
  status?: number,
  code?: string,
): Error {
  return Object.assign(new Error(message), { status, code })
}

function assertKind(
  expected: OpenAIErrorKind,
  error: unknown,
  phase: 'request' | 'response' | 'stream' = 'request',
): void {
  const result = classifyOpenAIError(error, { phase })
  assert(
    result.kind === expected,
    `expected ${expected}, received ${result.kind}: ${result.userMessage}`,
  )
}

assertKind('authentication', providerError('invalid API key', 401))
assertKind('rate_limit', providerError('quota exceeded', 429))
assertKind(
  'context_limit',
  providerError(
    'request (24168 tokens) exceeds the available context size (16384 tokens)',
    400,
  ),
)
assertKind(
  'model_not_found',
  providerError('The model exact-model-id does not exist', 404, 'model_not_found'),
)
assertKind('protocol_route', providerError('Not Found', 404))
assertKind('protocol_route', providerError('Method Not Allowed', 405))
assertKind(
  'protocol_request',
  providerError('unknown field stream_options', 400),
)
assertKind(
  'protocol_request',
  providerError('reasoning_effort is not supported', 400),
)
assertKind(
  'protocol_request',
  providerError('unknown field parallel_tool_calls', 422),
)
assertKind(
  'protocol_response',
  new Error('unexpected content-type text/html'),
  'stream',
)
assertKind('network', Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }))
assertKind('timeout', Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' }))
assertKind('server_error', providerError('upstream unavailable', 503))
assertKind('unknown', providerError('bad request', 400))

const secret = 'sk-validation-secret-123456'
const classified = classifyOpenAIError(providerError(`invalid key ${secret}`, 401), {
  endpoint: 'https://user:password@example.test/v1?api_key=url-secret',
  secrets: [secret],
})
assert(classified.endpoint === 'https://example.test/v1', 'endpoint was not sanitized')
assert(!classified.userMessage.includes(secret), 'user message leaked API key')
assert(!classified.userMessage.includes('password'), 'user message leaked URL credentials')
assert(
  classified.userMessage.includes('OpenAI-compatible endpoint'),
  'authentication message lost endpoint context',
)

assertOpenAIChatCompletionResponse({
  choices: [{ message: { role: 'assistant', content: 'ok' } }],
})
try {
  assertOpenAIChatCompletionResponse({ response: 'provider-specific' })
  throw new Error('malformed non-stream response was accepted')
} catch (error) {
  assertKind('protocol_response', error, 'response')
}

async function* validStream(): AsyncGenerator<ChatCompletionChunk> {
  yield { choices: [] } as unknown as ChatCompletionChunk
  yield {
    choices: [{ delta: { content: 'ok' } }],
  } as unknown as ChatCompletionChunk
}

async function* invalidStream(): AsyncGenerator<ChatCompletionChunk> {
  yield { data: 'provider-specific' } as unknown as ChatCompletionChunk
}

const validChunks: ChatCompletionChunk[] = []
for await (const chunk of validateOpenAIChatCompletionStream(validStream())) {
  validChunks.push(chunk)
}
assert(validChunks.length === 2, 'valid stream chunks were not preserved')

try {
  for await (const _chunk of validateOpenAIChatCompletionStream(
    invalidStream(),
  )) {
    // Consume the generator so structural validation runs.
  }
  throw new Error('malformed stream was accepted')
} catch (error) {
  assertKind('protocol_response', error, 'stream')
}

console.log('[validation] OpenAI-compatible error classification passed')
