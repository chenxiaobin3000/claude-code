import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Tools } from '../../src/Tool.js'
import {
  processModelStream,
  type ModelStreamOutput,
  type ModelStreamSummary,
} from '../../src/services/model/streamProcessor.js'
import { assert, assertEqual } from './assertions.js'

async function* events(): AsyncGenerator<BetaRawMessageStreamEvent> {
  yield {
    type: 'message_start',
    message: {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'fixture-model',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 0 },
    },
  } as BetaRawMessageStreamEvent
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  } as BetaRawMessageStreamEvent
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'fixture response' },
  } as BetaRawMessageStreamEvent
  yield {
    type: 'content_block_stop',
    index: 0,
  } as BetaRawMessageStreamEvent
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 4 },
  } as BetaRawMessageStreamEvent
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent
}

const iterator = processModelStream({
  events: events(),
  tools: [] as unknown as Tools,
  maxOutputTokens: 100,
  startedAt: Date.now(),
})
const outputs: ModelStreamOutput[] = []
let summary: ModelStreamSummary | undefined
while (true) {
  const next = await iterator.next()
  if (next.done) {
    summary = next.value
    break
  }
  outputs.push(next.value)
}

assert(summary !== undefined, 'stream summary missing')
assertEqual(summary.usage.input_tokens, 12, 'stream input usage')
assertEqual(summary.usage.output_tokens, 4, 'stream output usage')
assertEqual(summary.stopReason, 'end_turn', 'stream stop reason')
const assistant = outputs.find(output => output.type === 'assistant')
assert(assistant?.type === 'assistant', 'assembled assistant message missing')
assertEqual(
  Array.isArray(assistant.message.content)
    ? assistant.message.content[0]?.type === 'text'
      ? assistant.message.content[0].text
      : undefined
    : assistant.message.content,
  'fixture response',
  'assembled assistant text',
)
assertEqual(
  outputs.filter(output => output.type === 'stream_event').length,
  6,
  'forwarded stream event count',
)

console.log('[validation] model stream processing passed')
