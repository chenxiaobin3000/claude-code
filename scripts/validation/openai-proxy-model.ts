#!/usr/bin/env bun
import { adaptOpenAIStreamToAnthropic } from '@ant/model-provider'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.mjs'
import { chatCompletionsToResponses } from '../../plugins/openai-proxy/src/model/convert.js'
import { OpenAIProxyModelService } from '../../plugins/openai-proxy/src/model/service.js'
import { adaptResponsesSse } from '../../plugins/openai-proxy/src/model/sse.js'
import type {
  ModelRequest,
  ModelTransport,
} from '../../plugins/openai-proxy/src/model/types.js'
import type { OpenAIProxySession } from '../../plugins/openai-proxy/src/auth/session.js'
import { startOpenAIProxyGateway } from '../../plugins/openai-proxy/src/gateway.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const session: OpenAIProxySession = {
  version: 1,
  authMode: 'chatgpt',
  tokens: {
    idToken: 'fixture-id-token',
    accessToken: 'fixture-access-token',
    refreshToken: 'fixture-refresh-token',
  },
  account: {
    accountId: 'workspace-fixture',
    isFedramp: false,
  },
  updatedAt: new Date(0).toISOString(),
}

const chatRequest = {
  model: 'gpt-fixture',
  messages: [
    { role: 'system', content: 'System instructions' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'inspect ' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
      ],
    },
    {
      role: 'assistant',
      content: 'Calling a tool',
      reasoning_content: 'Need the fixture tool.',
      tool_calls: [
        {
          id: 'call_previous',
          type: 'function',
          function: { name: 'fixture_tool', arguments: '{"value":1}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_previous', content: 'tool result' },
    { role: 'user', content: 'continue' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'fixture_tool',
        description: 'fixture',
        parameters: { type: 'object' },
        strict: true,
      },
    },
  ],
  tool_choice: { type: 'function', function: { name: 'fixture_tool' } },
  parallel_tool_calls: true,
  max_completion_tokens: 2048,
  reasoning_effort: 'high',
  stream: true,
  stream_options: { include_usage: true },
}

const converted = chatCompletionsToResponses(chatRequest)
assertEqual(
  converted.instructions,
  'System instructions',
  'system instructions',
)
assertEqual(converted.model, 'gpt-fixture', 'model preserved')
assertEqual(converted.max_output_tokens, 2048, 'output token field converted')
assertDeepEqual(
  converted.reasoning,
  { effort: 'high', summary: 'auto' },
  'reasoning converted',
)
assertDeepEqual(
  converted.tool_choice,
  { type: 'function', name: 'fixture_tool' },
  'named tool choice converted',
)
assert(
  converted.input.some(item => item.type === 'function_call_output'),
  'tool result converted',
)
assert(
  converted.input.some(item => item.type === 'reasoning'),
  'assistant reasoning round trips',
)

let unsupportedRejected = false
try {
  chatCompletionsToResponses({
    ...chatRequest,
    response_format: { type: 'json_object' },
  })
} catch (error) {
  unsupportedRejected =
    (error as { code?: string }).code === 'unsupported_field'
}
assert(unsupportedRejected, 'unsupported Chat Completions fields fail closed')

const upstreamEvents = [
  {
    type: 'response.created',
    response: { id: 'resp_fixture', model: 'gpt-fixture' },
  },
  {
    type: 'response.reasoning_summary_text.delta',
    item_id: 'rs_fixture',
    summary_index: 0,
    delta: 'Reasoning. ',
  },
  {
    type: 'response.output_text.delta',
    item_id: 'msg_fixture',
    delta: 'Hello. ',
  },
  {
    type: 'response.output_item.added',
    item: {
      id: 'fc_fixture',
      type: 'function_call',
      call_id: 'call_fixture',
      name: 'fixture_tool',
      arguments: '',
    },
  },
  {
    type: 'response.function_call_arguments.delta',
    item_id: 'fc_fixture',
    delta: '{"ok":true}',
  },
  {
    type: 'response.completed',
    response: {
      id: 'resp_fixture',
      model: 'gpt-fixture',
      usage: {
        input_tokens: 20,
        input_tokens_details: { cached_tokens: 5, cache_write_tokens: 2 },
        output_tokens: 8,
        output_tokens_details: { reasoning_tokens: 3 },
        total_tokens: 28,
      },
    },
  },
]
const upstreamSse = upstreamEvents
  .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('')

const requests: ModelRequest[] = []
let refreshes = 0
const auth = {
  async getValidSession() {
    return session
  },
  async forceRefreshSession() {
    refreshes++
    return {
      ...session,
      tokens: { ...session.tokens, accessToken: 'fixture-refreshed-token' },
    }
  },
}
const transport: ModelTransport = async request => {
  requests.push(request)
  if (new URL(request.url).pathname.endsWith('/models')) {
    return Response.json({ models: [{ slug: 'gpt-fixture' }] })
  }
  return new Response(upstreamSse, {
    headers: { 'content-type': 'text/event-stream' },
  })
}
const service = new OpenAIProxyModelService({
  auth,
  transport,
  baseUrl: 'https://fixture.invalid/backend-api/codex',
  version: '0.1.0-fixture',
})
const token = 'fixture-local-token-that-is-at-least-32-characters'
const gateway = startOpenAIProxyGateway('0.1.0-fixture', {
  token,
  port: 0,
  modelService: service,
})
try {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  const models = await fetch(`${gateway.url}/v1/models`, { headers })
  assertEqual(models.status, 200, 'model list status')
  assertDeepEqual(
    ((await models.json()) as { data: unknown[] }).data,
    [{ id: 'gpt-fixture', object: 'model', owned_by: 'openai' }],
    'model list conversion',
  )
  assertEqual(
    new URL(requests[0]!.url).searchParams.get('client_version'),
    '0.147.0',
    'model catalog uses pinned upstream Codex client version',
  )
  const completion = await fetch(`${gateway.url}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(chatRequest),
  })
  assertEqual(completion.status, 200, 'completion status')
  const streamText = await completion.text()
  assert(
    streamText.includes('"reasoning_content":"Reasoning. "'),
    'reasoning SSE converted',
  )
  assert(streamText.includes('"content":"Hello. "'), 'text SSE converted')
  assert(streamText.includes('"id":"call_fixture"'), 'tool call id converted')
  assert(
    streamText.includes('"arguments":"{\\"ok\\":true}"'),
    'tool arguments converted',
  )
  assert(
    streamText.includes('"finish_reason":"tool_calls"'),
    'tool finish reason converted',
  )
  assert(streamText.includes('"cached_tokens":5'), 'cached usage converted')
  assert(streamText.endsWith('data: [DONE]\n\n'), 'stream terminator emitted')

  const modelRequest = requests.find(request => request.method === 'POST')
  assert(modelRequest !== undefined, 'upstream model request captured')
  assertEqual(
    modelRequest.headers.authorization,
    'Bearer fixture-access-token',
    'subscription bearer attached upstream only',
  )
  assertEqual(
    modelRequest.headers['chatgpt-account-id'],
    'workspace-fixture',
    'account id attached',
  )
  assertEqual(
    modelRequest.headers.originator,
    'codex_cli_rs',
    'official originator',
  )
  const upstreamBody = JSON.parse(modelRequest.body ?? '{}') as Record<
    string,
    unknown
  >
  assertEqual(upstreamBody.stream, true, 'Responses stream requested')
  assert(Array.isArray(upstreamBody.input), 'Responses input emitted')
  assert(
    !streamText.includes('fixture-access-token'),
    'token absent from local stream',
  )

  const sdk = new OpenAI({ apiKey: token, baseURL: `${gateway.url}/v1` })
  const sdkStream = await sdk.chat.completions.create(
    chatRequest as ChatCompletionCreateParamsStreaming,
  )
  const internalEvents = []
  for await (const event of adaptOpenAIStreamToAnthropic(
    sdkStream,
    'gpt-fixture',
  )) {
    internalEvents.push(event)
  }
  assert(
    internalEvents.some(event => event.type === 'content_block_start'),
    'existing OpenAI stream adapter accepts proxy chunks',
  )
  assertEqual(
    internalEvents.at(-1)?.type,
    'message_stop',
    'existing model stream completes',
  )
} finally {
  gateway.stop()
}

let attempts = 0
const retryService = new OpenAIProxyModelService({
  auth,
  baseUrl: 'https://fixture.invalid/backend-api/codex',
  transport: async () => {
    attempts++
    return attempts === 1
      ? Response.json({ error: { message: 'expired' } }, { status: 401 })
      : new Response(upstreamSse, {
          headers: { 'content-type': 'text/event-stream' },
        })
  },
})
const retried = await retryService.chatCompletions(
  new Request('http://127.0.0.1/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(chatRequest),
  }),
)
await retried.text()
assertEqual(attempts, 2, '401 retried exactly once after refresh')
assertEqual(refreshes, 1, '401 forced one token refresh')

for (const expectedStatus of [403, 429]) {
  const rejectedService = new OpenAIProxyModelService({
    auth,
    baseUrl: 'https://fixture.invalid/backend-api/codex',
    transport: async () =>
      Response.json(
        { error: { message: 'sensitive upstream detail' } },
        {
          status: expectedStatus,
        },
      ),
  })
  let actualStatus = 0
  let actualMessage = ''
  try {
    await rejectedService.chatCompletions(
      new Request('http://127.0.0.1/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify(chatRequest),
      }),
    )
  } catch (error) {
    actualStatus = (error as { status?: number }).status ?? 0
    actualMessage = error instanceof Error ? error.message : String(error)
  }
  assertEqual(
    actualStatus,
    expectedStatus,
    `${expectedStatus} status preserved`,
  )
  assert(
    !actualMessage.includes('sensitive upstream detail'),
    `${expectedStatus} upstream body redacted`,
  )
}

const timeoutService = new OpenAIProxyModelService({
  auth,
  baseUrl: 'https://fixture.invalid/backend-api/codex',
  timeoutMs: 5,
  transport: request =>
    new Promise((_, reject) => {
      request.signal?.addEventListener(
        'abort',
        () => reject(request.signal?.reason ?? new Error('aborted')),
        { once: true },
      )
    }),
})
let timedOut = false
try {
  await timeoutService.chatCompletions(
    new Request('http://127.0.0.1/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(chatRequest),
    }),
  )
} catch (error) {
  timedOut =
    error instanceof Error && error.message === 'OpenAI upstream timed out.'
}
assert(timedOut, 'upstream request timeout aborts the transport')

let upstreamCancelled = false
const pendingUpstream = new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify(upstreamEvents[0])}\n\n`,
        ),
      )
    },
    cancel() {
      upstreamCancelled = true
    },
  }),
)
const abort = new AbortController()
const adapted = adaptResponsesSse(pendingUpstream, 'gpt-fixture', abort)
const adaptedReader = adapted.body!.getReader()
await adaptedReader.read()
await adaptedReader.cancel('fixture cancel')
assert(abort.signal.aborted, 'local cancellation aborts upstream request')
assert(upstreamCancelled, 'local cancellation cancels upstream reader')

let interrupted = false
try {
  await adaptResponsesSse(
    new Response(`data: ${JSON.stringify(upstreamEvents[0])}\n\n`),
    'gpt-fixture',
    new AbortController(),
  ).text()
} catch {
  interrupted = true
}
assert(interrupted, 'stream interruption before response.completed is rejected')

console.log('[openai-proxy-model] PASS')
