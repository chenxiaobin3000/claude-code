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
      prompt_tokens_details: { cached_tokens: 5 },
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

console.log('[validation] OpenAI stream adaptation passed')
