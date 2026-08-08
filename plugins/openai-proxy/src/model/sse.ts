import { OpenAIProxyModelError, type JsonObject } from './types.js'

const encoder = new TextEncoder()

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function chatChunk(
  id: string,
  model: string,
  delta: JsonObject,
  finishReason: string | null = null,
): string {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function usageChunk(id: string, model: string, response: JsonObject): string {
  const usage = object(response.usage) ?? {}
  const inputDetails = object(usage.input_tokens_details) ?? {}
  const outputDetails = object(usage.output_tokens_details) ?? {}
  const promptTokens =
    typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
  const completionTokens =
    typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        typeof usage.total_tokens === 'number'
          ? usage.total_tokens
          : promptTokens + completionTokens,
      prompt_tokens_details: {
        cached_tokens:
          typeof inputDetails.cached_tokens === 'number'
            ? inputDetails.cached_tokens
            : 0,
        ...(typeof inputDetails.cache_write_tokens === 'number' && {
          cache_write_tokens: inputDetails.cache_write_tokens,
        }),
      },
      completion_tokens_details: {
        reasoning_tokens:
          typeof outputDetails.reasoning_tokens === 'number'
            ? outputDetails.reasoning_tokens
            : 0,
      },
    },
  })}\n\n`
}

function parseEvent(block: string): JsonObject | undefined {
  const data = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
  if (!data || data === '[DONE]') return undefined
  try {
    return object(JSON.parse(data))
  } catch {
    throw new OpenAIProxyModelError(
      'Upstream returned invalid SSE JSON.',
      'invalid_upstream_stream',
      502,
    )
  }
}

export function adaptResponsesSse(
  upstream: Response,
  requestedModel: string,
  abort: AbortController,
  onDone: () => void = () => undefined,
): Response {
  if (!upstream.body) {
    throw new OpenAIProxyModelError(
      'Upstream response had no stream body.',
      'invalid_upstream_stream',
      502,
    )
  }
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let responseId = `chatcmpl_${crypto.randomUUID().replaceAll('-', '')}`
  let model = requestedModel
  let roleSent = false
  let completed = false
  let sawTool = false
  const toolIndexes = new Map<string, number>()

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const boundary = buffer.search(/\r?\n\r?\n/)
          if (boundary >= 0) {
            const match =
              buffer.slice(boundary).match(/^(?:\r?\n){2}/)?.[0] ?? '\n\n'
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + match.length)
            const event = parseEvent(block)
            if (!event) continue
            const kind = event.type
            const response = object(event.response)
            if (response) {
              if (typeof response.id === 'string') responseId = response.id
              if (typeof response.model === 'string') model = response.model
            }
            if (!roleSent) {
              controller.enqueue(
                encoder.encode(
                  chatChunk(responseId, model, { role: 'assistant' }),
                ),
              )
              roleSent = true
            }
            if (
              kind === 'response.output_text.delta' &&
              typeof event.delta === 'string'
            ) {
              controller.enqueue(
                encoder.encode(
                  chatChunk(responseId, model, { content: event.delta }),
                ),
              )
            } else if (
              (kind === 'response.reasoning_summary_text.delta' ||
                kind === 'response.reasoning_text.delta') &&
              typeof event.delta === 'string'
            ) {
              controller.enqueue(
                encoder.encode(
                  chatChunk(responseId, model, {
                    reasoning_content: event.delta,
                  }),
                ),
              )
            } else if (kind === 'response.output_item.added') {
              const item = object(event.item)
              if (item?.type === 'function_call') {
                const callId =
                  typeof item.call_id === 'string'
                    ? item.call_id
                    : typeof item.id === 'string'
                      ? item.id
                      : undefined
                const name =
                  typeof item.name === 'string' ? item.name : undefined
                if (!callId || !name) {
                  throw new OpenAIProxyModelError(
                    'Upstream function call omitted id or name.',
                    'invalid_upstream_stream',
                    502,
                  )
                }
                const index = toolIndexes.size
                toolIndexes.set(callId, index)
                if (typeof item.id === 'string') toolIndexes.set(item.id, index)
                sawTool = true
                controller.enqueue(
                  encoder.encode(
                    chatChunk(responseId, model, {
                      tool_calls: [
                        {
                          index,
                          id: callId,
                          type: 'function',
                          function: {
                            name,
                            arguments:
                              typeof item.arguments === 'string'
                                ? item.arguments
                                : '',
                          },
                        },
                      ],
                    }),
                  ),
                )
              }
            } else if (
              kind === 'response.function_call_arguments.delta' &&
              typeof event.delta === 'string'
            ) {
              const callId =
                typeof event.call_id === 'string'
                  ? event.call_id
                  : typeof event.item_id === 'string'
                    ? event.item_id
                    : undefined
              const index =
                callId === undefined ? undefined : toolIndexes.get(callId)
              if (index === undefined) {
                throw new OpenAIProxyModelError(
                  'Upstream function arguments arrived before the function call.',
                  'invalid_upstream_stream',
                  502,
                )
              }
              controller.enqueue(
                encoder.encode(
                  chatChunk(responseId, model, {
                    tool_calls: [
                      { index, function: { arguments: event.delta } },
                    ],
                  }),
                ),
              )
            } else if (
              kind === 'response.failed' ||
              kind === 'response.incomplete'
            ) {
              const error = object(response?.error)
              const code =
                typeof error?.code === 'string'
                  ? error.code
                  : 'upstream_stream_failed'
              throw new OpenAIProxyModelError(
                `OpenAI upstream emitted ${String(kind)} (${code}).`,
                code,
                502,
              )
            } else if (kind === 'response.completed' && response) {
              completed = true
              controller.enqueue(
                encoder.encode(
                  chatChunk(
                    responseId,
                    model,
                    {},
                    sawTool ? 'tool_calls' : 'stop',
                  ),
                ),
              )
              controller.enqueue(
                encoder.encode(usageChunk(responseId, model, response)),
              )
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              await reader.cancel().catch(() => undefined)
              onDone()
              controller.close()
              return
            }
            if (controller.desiredSize !== null && controller.desiredSize <= 0)
              return
            continue
          }
          const next = await reader.read()
          if (next.done) {
            if (!completed) {
              throw new OpenAIProxyModelError(
                'Upstream stream closed before response.completed.',
                'upstream_stream_interrupted',
                502,
              )
            }
            controller.close()
            onDone()
            return
          }
          buffer += decoder.decode(next.value, { stream: true })
          if (Buffer.byteLength(buffer, 'utf8') > 1024 * 1024) {
            throw new OpenAIProxyModelError(
              'Upstream SSE event exceeded 1 MiB.',
              'upstream_event_too_large',
              502,
            )
          }
        }
      } catch (error) {
        abort.abort()
        await reader.cancel(error).catch(() => undefined)
        onDone()
        controller.error(error)
      }
    },
    async cancel(reason) {
      abort.abort()
      await reader.cancel(reason).catch(() => undefined)
      onDone()
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    },
  })
}
