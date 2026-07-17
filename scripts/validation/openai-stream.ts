#!/usr/bin/env bun

import { adaptOpenAIStreamToAnthropic } from '@ant/model-provider'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import {
  assert,
  assertDeepEqual,
  assertEqual,
  collectAsync,
} from './assertions.js'

function chunk(value: unknown): ChatCompletionChunk {
  return value as ChatCompletionChunk
}

async function* toolStream(): AsyncGenerator<ChatCompletionChunk> {
  yield chunk({
    choices: [
      { delta: { reasoning_content: 'thinking' }, finish_reason: null },
    ],
  })
  yield chunk({
    choices: [{ delta: { content: 'answer' }, finish_reason: null }],
  })
  yield chunk({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call-1',
              function: { name: 'Read', arguments: '{"file_path":' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  })
  yield chunk({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '"/tmp/a"}' } }],
        },
        finish_reason: null,
      },
    ],
  })
  yield chunk({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  })
  yield chunk({
    choices: [],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 7,
      total_tokens: 27,
      prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 },
      completion_tokens_details: { reasoning_tokens: 2 },
    },
  })
}

const events = await collectAsync(
  adaptOpenAIStreamToAnthropic(toolStream(), 'fixture-model'),
)
assertDeepEqual(
  events.map(event => event.type),
  [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'content_block_start',
    'content_block_delta',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ],
  'stream event sequence',
)

const messageStart = events[0]
assert(messageStart?.type === 'message_start', 'missing message_start')
assert(
  messageStart.message.id.startsWith('msg_'),
  'invalid generated message ID',
)
assertEqual(messageStart.message.model, 'fixture-model', 'stream model')

const thinkingDelta = events.find(
  event =>
    event.type === 'content_block_delta' &&
    event.delta.type === 'thinking_delta',
)
assert(
  thinkingDelta?.type === 'content_block_delta' &&
    thinkingDelta.delta.type === 'thinking_delta',
  'missing thinking delta',
)
assertEqual(thinkingDelta.delta.thinking, 'thinking', 'thinking delta content')

const toolStart = events.find(
  event =>
    event.type === 'content_block_start' &&
    event.content_block.type === 'tool_use',
)
assert(
  toolStart?.type === 'content_block_start' &&
    toolStart.content_block.type === 'tool_use',
  'missing tool start',
)
assertEqual(toolStart.content_block.id, 'call-1', 'tool call ID')
assertEqual(toolStart.content_block.name, 'Read', 'tool call name')

const argumentFragments = events.flatMap(event =>
  event.type === 'content_block_delta' &&
  event.delta.type === 'input_json_delta'
    ? [event.delta.partial_json]
    : [],
)
assertEqual(
  argumentFragments.join(''),
  '{"file_path":"/tmp/a"}',
  'fragmented tool input',
)

const messageDelta = events.find(event => event.type === 'message_delta')
assert(messageDelta?.type === 'message_delta', 'missing message_delta')
assertEqual(messageDelta.delta.stop_reason, 'tool_use', 'tool stop reason')
assertDeepEqual(
  messageDelta.usage,
  {
    input_tokens: 15,
    output_tokens: 7,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 0,
    raw_input_tokens: 20,
    total_tokens: 27,
    reasoning_output_tokens: 2,
    cache_write_input_tokens: 3,
    usage_complete: true,
  },
  'usage conversion',
)

async function* lengthStream(): AsyncGenerator<ChatCompletionChunk> {
  yield chunk({
    choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }],
  })
}
const lengthEvents = await collectAsync(
  adaptOpenAIStreamToAnthropic(lengthStream(), 'fixture-model'),
)
const lengthDelta = lengthEvents.find(event => event.type === 'message_delta')
assert(lengthDelta?.type === 'message_delta', 'missing length message_delta')
assertEqual(lengthDelta.delta.stop_reason, 'max_tokens', 'length stop reason')
assertDeepEqual(
  lengthDelta.usage,
  {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    raw_input_tokens: 0,
    total_tokens: 0,
    reasoning_output_tokens: 0,
    cache_write_input_tokens: 0,
    usage_complete: false,
  },
  'missing usage defaults',
)

async function* refusalStream(): AsyncGenerator<ChatCompletionChunk> {
  yield chunk({
    choices: [{ delta: { refusal: 'Cannot comply.' }, finish_reason: 'stop' }],
  })
}
const refusalEvents = await collectAsync(
  adaptOpenAIStreamToAnthropic(refusalStream(), 'fixture-model'),
)
const refusalText = refusalEvents.find(
  event =>
    event.type === 'content_block_delta' && event.delta.type === 'text_delta',
)
assert(
  refusalText?.type === 'content_block_delta' &&
    refusalText.delta.type === 'text_delta',
  'missing refusal text delta',
)
assertEqual(refusalText.delta.text, 'Cannot comply.', 'refusal text')

async function* parallelToolStream(): AsyncGenerator<ChatCompletionChunk> {
  yield chunk({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call-a',
              function: { name: 'Read', arguments: '{"a":' },
            },
            {
              index: 1,
              id: 'call-b',
              function: { name: 'Glob', arguments: '{"b":' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  })
  yield chunk({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 1, function: { arguments: '2}' } },
            { index: 0, function: { arguments: '1}' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  })
}
const parallelEvents = await collectAsync(
  adaptOpenAIStreamToAnthropic(parallelToolStream(), 'fixture-model'),
)
assertEqual(
  parallelEvents.filter(
    event =>
      event.type === 'content_block_start' &&
      event.content_block.type === 'tool_use',
  ).length,
  2,
  'parallel tool blocks',
)

async function assertInvalidStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  label: string,
): Promise<void> {
  try {
    await collectAsync(adaptOpenAIStreamToAnthropic(stream, 'fixture-model'))
  } catch (error) {
    assert(
      error instanceof Error &&
        error.message.includes('invalid_chat_completion_response'),
      `${label} returned an unclear error`,
    )
    return
  }
  throw new Error(`${label} was accepted`)
}

async function* interruptedStream(): AsyncGenerator<ChatCompletionChunk> {
  yield chunk({
    choices: [{ delta: { content: 'partial' }, finish_reason: null }],
  })
}
await assertInvalidStream(interruptedStream(), 'unfinished stream')

async function* legacyFunctionStream(): AsyncGenerator<ChatCompletionChunk> {
  yield chunk({
    choices: [
      {
        delta: { function_call: { name: 'Read', arguments: '{}' } },
        finish_reason: 'function_call',
      },
    ],
  })
}
await assertInvalidStream(legacyFunctionStream(), 'legacy function_call')

console.log('[validation] OpenAI stream adaptation passed')
