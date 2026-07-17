#!/usr/bin/env bun

import type { Message } from '../../src/types/message.js'
import { deriveShortMessageId, deriveUUID } from '../../src/utils/messages/ids.js'
import {
  findLastCompactBoundaryIndex,
  getLastAssistantMessage,
  hasToolCallsInLastAssistantTurn,
  isThinkingMessage,
} from '../../src/utils/messages/predicates.js'
import {
  extractTag,
  extractTextContent,
  getAssistantMessageText,
  stripPromptXMLTags,
} from '../../src/utils/messages/text.js'
import { assert, assertEqual } from './assertions.js'

const parent = '12345678-1234-4234-8234-123456789abc'
assertEqual(deriveUUID(parent, 15), '12345678-1234-4234-8234-00000000000f', 'derived UUID')
assertEqual(deriveShortMessageId(parent), deriveShortMessageId(parent), 'stable short ID')
assertEqual(extractTag('<x a="1">value</x>', 'x'), 'value', 'tag extraction')
assertEqual(stripPromptXMLTags('<context>hidden</context>shown'), 'shown', 'prompt XML stripping')
assertEqual(extractTextContent([{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }], '|'), 'a|b', 'text blocks')

const assistant = {
  type: 'assistant',
  uuid: parent,
  message: { content: [{ type: 'thinking', thinking: 'x' }] },
} as unknown as Message
const toolCall = {
  type: 'assistant',
  uuid: deriveUUID(parent, 1),
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
} as unknown as Message
const boundary = { type: 'system', subtype: 'compact_boundary' } as Message
assert(isThinkingMessage(assistant), 'thinking predicate')
assert(hasToolCallsInLastAssistantTurn([assistant, toolCall]), 'last assistant tool call')
assertEqual(getLastAssistantMessage([assistant, toolCall])?.uuid, toolCall.uuid, 'last assistant')
assertEqual(getAssistantMessageText({ ...toolCall, message: { content: [{ type: 'text', text: 'ok' }] } } as Message), 'ok', 'assistant text')
assertEqual(findLastCompactBoundaryIndex([assistant, boundary]), 1, 'compact boundary index')

console.log('[message-utils] PASS')
