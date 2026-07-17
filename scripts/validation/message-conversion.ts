#!/usr/bin/env bun

import {
  anthropicMessagesToOpenAI,
  anthropicToolChoiceToOpenAI,
  anthropicToolsToOpenAI,
  asSystemPrompt,
  type AssistantMessage,
  type UserMessage,
} from '@ant/model-provider'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const assistant = {
  type: 'assistant',
  uuid: '00000000-0000-4000-8000-000000000001',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'inspect first', signature: '' },
      { type: 'text', text: 'I will read it.' },
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ],
  },
} as unknown as AssistantMessage

const toolResultAndUserText = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000002',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'fixture contents',
      },
      { type: 'text', text: 'Continue.' },
    ],
  },
} as unknown as UserMessage

const converted = anthropicMessagesToOpenAI(
  [assistant, toolResultAndUserText],
  asSystemPrompt(['system one', 'system two']),
)

assertDeepEqual(
  converted.map(message => message.role),
  ['system', 'assistant', 'tool', 'user'],
  'OpenAI message ordering changed',
)
assertEqual(converted[0]?.content, 'system one\n\nsystem two', 'system prompt')

const convertedAssistant = converted[1] as unknown as {
  content: string | null
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    function: { name: string; arguments: string }
  }>
}
assertEqual(convertedAssistant.content, 'I will read it.', 'assistant text')
assertEqual(
  convertedAssistant.reasoning_content,
  'inspect first',
  'thinking content',
)
assertEqual(convertedAssistant.tool_calls?.[0]?.id, 'tool-1', 'tool call ID')
assertEqual(
  convertedAssistant.tool_calls?.[0]?.function.name,
  'Read',
  'tool call name',
)
assertDeepEqual(
  JSON.parse(convertedAssistant.tool_calls?.[0]?.function.arguments ?? '{}'),
  { file_path: '/tmp/example.txt' },
  'tool call input',
)

const convertedTool = converted[2] as unknown as {
  content: string
  tool_call_id: string
}
assertEqual(convertedTool.tool_call_id, 'tool-1', 'tool result ID')
assertEqual(convertedTool.content, 'fixture contents', 'tool result content')
assertEqual(converted[3]?.content, 'Continue.', 'user text after tool result')

const imageMessage = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000003',
  message: {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this.' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AA==' },
      },
    ],
  },
} as unknown as UserMessage
const imageOutput = anthropicMessagesToOpenAI(
  [imageMessage],
  asSystemPrompt([]),
)
const imageContent = imageOutput[0]?.content
assert(Array.isArray(imageContent), 'image content was not converted to parts')
assertDeepEqual(
  imageContent,
  [
    { type: 'text', text: 'Describe this.' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AA==' },
    },
  ],
  'image conversion',
)

const unknownBlockMessage = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000004',
  message: {
    role: 'user',
    content: [
      { type: 'server_tool_use', id: 'server-1', name: 'search' },
      { type: 'text', text: 'Keep this text.' },
    ],
  },
} as unknown as UserMessage
const unknownBlockOutput = anthropicMessagesToOpenAI(
  [unknownBlockMessage],
  asSystemPrompt([]),
)
assertEqual(
  unknownBlockOutput[0]?.content,
  'Keep this text.',
  'unsupported content block handling',
)

const convertedTools = anthropicToolsToOpenAI([
  {
    name: 'FixtureTool',
    description: 'Fixture tool description',
    input_schema: {
      type: 'object',
      properties: {
        mode: { const: 'safe' },
        options: {
          type: 'object',
          properties: { enabled: { const: true } },
        },
      },
      required: ['mode'],
    },
  },
  {
    type: 'server',
    name: 'ServerOnlyTool',
    input_schema: { type: 'object', properties: {} },
  },
] as unknown as Parameters<typeof anthropicToolsToOpenAI>[0])
assertEqual(convertedTools.length, 1, 'server tool filtering')
assertEqual(convertedTools[0]?.function.name, 'FixtureTool', 'tool schema name')
assertEqual(
  convertedTools[0]?.function.description,
  'Fixture tool description',
  'tool schema description',
)
assertDeepEqual(
  convertedTools[0]?.function.parameters,
  {
    type: 'object',
    properties: {
      mode: { enum: ['safe'] },
      options: {
        type: 'object',
        properties: { enabled: { enum: [true] } },
      },
    },
    required: ['mode'],
  },
  'tool schema sanitization',
)

assertEqual(
  anthropicToolChoiceToOpenAI({ type: 'none' }),
  'none',
  'disabled tool choice',
)
assertEqual(
  anthropicToolChoiceToOpenAI({ type: 'auto' }),
  'auto',
  'automatic tool choice',
)
assertEqual(
  anthropicToolChoiceToOpenAI({ type: 'any' }),
  'required',
  'required tool choice',
)
assertDeepEqual(
  anthropicToolChoiceToOpenAI({ type: 'tool', name: 'FixtureTool' }),
  { type: 'function', function: { name: 'FixtureTool' } },
  'named tool choice',
)
assertEqual(
  anthropicToolChoiceToOpenAI(undefined),
  undefined,
  'default tool choice',
)

console.log('[validation] message conversion passed')
