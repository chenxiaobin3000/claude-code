import type {
  ChatCompletionRequest,
  JsonObject,
  ResponsesRequest,
} from './types.js'
import { OpenAIProxyModelError } from './types.js'

const ALLOWED_REQUEST_FIELDS = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'max_completion_tokens',
  'max_tokens',
  'reasoning_effort',
  'temperature',
])

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenAIProxyModelError(
      `${label} must be an object.`,
      'invalid_request',
      400,
    )
  }
  return value as JsonObject
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OpenAIProxyModelError(
      `${label} must be a non-empty string.`,
      'invalid_request',
      400,
    )
  }
  return value
}

function textContent(value: unknown, label: string): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) {
    throw new OpenAIProxyModelError(
      `${label} must be text.`,
      'unsupported_field',
      400,
    )
  }
  return value
    .map((part, index) => {
      const item = object(part, `${label}[${index}]`)
      if (item.type !== 'text' || typeof item.text !== 'string') {
        throw new OpenAIProxyModelError(
          `${label}[${index}] is not a supported text part.`,
          'unsupported_field',
          400,
        )
      }
      return item.text
    })
    .join('')
}

function userContent(value: unknown, label: string): JsonObject[] {
  if (typeof value === 'string') return [{ type: 'input_text', text: value }]
  if (!Array.isArray(value)) {
    throw new OpenAIProxyModelError(
      `${label} has unsupported content.`,
      'unsupported_field',
      400,
    )
  }
  return value.map((part, index) => {
    const item = object(part, `${label}[${index}]`)
    if (item.type === 'text' && typeof item.text === 'string') {
      return { type: 'input_text', text: item.text }
    }
    if (item.type === 'image_url') {
      const image = item.image_url
      const url =
        typeof image === 'string'
          ? image
          : object(image, `${label}[${index}].image_url`).url
      return {
        type: 'input_image',
        image_url: nonEmptyString(url, `${label}[${index}].image_url.url`),
      }
    }
    throw new OpenAIProxyModelError(
      `${label}[${index}] has unsupported type ${JSON.stringify(item.type)}.`,
      'unsupported_field',
      400,
    )
  })
}

function assistantItems(message: JsonObject, index: number): JsonObject[] {
  const items: JsonObject[] = []
  const reasoning = message.reasoning_content
  if (reasoning !== undefined && reasoning !== null) {
    if (typeof reasoning !== 'string') {
      throw new OpenAIProxyModelError(
        `messages[${index}].reasoning_content must be text.`,
        'invalid_request',
        400,
      )
    }
    items.push({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: reasoning }],
      content: null,
    })
  }
  if (message.content !== undefined && message.content !== null) {
    const text = textContent(message.content, `messages[${index}].content`)
    if (text.length > 0) {
      items.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      })
    }
  }
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) {
      throw new OpenAIProxyModelError(
        `messages[${index}].tool_calls must be an array.`,
        'invalid_request',
        400,
      )
    }
    for (const [toolIndex, rawTool] of message.tool_calls.entries()) {
      const tool = object(
        rawTool,
        `messages[${index}].tool_calls[${toolIndex}]`,
      )
      const fn = object(
        tool.function,
        `messages[${index}].tool_calls[${toolIndex}].function`,
      )
      if (tool.type !== 'function') {
        throw new OpenAIProxyModelError(
          'Only function tool calls are supported.',
          'unsupported_field',
          400,
        )
      }
      items.push({
        type: 'function_call',
        call_id: nonEmptyString(
          tool.id,
          `messages[${index}].tool_calls[${toolIndex}].id`,
        ),
        name: nonEmptyString(
          fn.name,
          `messages[${index}].tool_calls[${toolIndex}].function.name`,
        ),
        arguments: nonEmptyString(
          fn.arguments,
          `messages[${index}].tool_calls[${toolIndex}].function.arguments`,
        ),
      })
    }
  }
  return items
}

function convertTools(value: unknown): JsonObject[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new OpenAIProxyModelError(
      'tools must be an array.',
      'invalid_request',
      400,
    )
  }
  return value.map((rawTool, index) => {
    const tool = object(rawTool, `tools[${index}]`)
    const fn = object(tool.function, `tools[${index}].function`)
    if (tool.type !== 'function') {
      throw new OpenAIProxyModelError(
        'Only function tools are supported.',
        'unsupported_field',
        400,
      )
    }
    return {
      type: 'function',
      name: nonEmptyString(fn.name, `tools[${index}].function.name`),
      ...(typeof fn.description === 'string' && {
        description: fn.description,
      }),
      parameters: object(
        fn.parameters ?? {},
        `tools[${index}].function.parameters`,
      ),
      ...(typeof fn.strict === 'boolean' && { strict: fn.strict }),
    }
  })
}

function convertToolChoice(value: unknown): string | JsonObject {
  if (value === undefined) return 'auto'
  if (value === 'auto' || value === 'none' || value === 'required') return value
  const choice = object(value, 'tool_choice')
  if (choice.type !== 'function') {
    throw new OpenAIProxyModelError(
      'Unsupported tool_choice type.',
      'unsupported_field',
      400,
    )
  }
  const fn = object(choice.function, 'tool_choice.function')
  return {
    type: 'function',
    name: nonEmptyString(fn.name, 'tool_choice.function.name'),
  }
}

export function chatCompletionsToResponses(value: unknown): ResponsesRequest {
  const raw = object(value, 'request')
  const unsupported = Object.keys(raw).filter(
    key => !ALLOWED_REQUEST_FIELDS.has(key),
  )
  if (unsupported.length > 0) {
    throw new OpenAIProxyModelError(
      `Unsupported Chat Completions field(s): ${unsupported.sort().join(', ')}.`,
      'unsupported_field',
      400,
    )
  }
  if (raw.stream !== true) {
    throw new OpenAIProxyModelError(
      'openai-proxy requires stream=true.',
      'stream_required',
      400,
    )
  }
  if (requestStreamOptionsInvalid(raw.stream_options)) {
    throw new OpenAIProxyModelError(
      'stream_options only supports include_usage=true.',
      'unsupported_field',
      400,
    )
  }
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    throw new OpenAIProxyModelError(
      'messages must be a non-empty array.',
      'invalid_request',
      400,
    )
  }
  const request = raw as ChatCompletionRequest
  const instructions: string[] = []
  const input: JsonObject[] = []
  let sawConversation = false
  for (const [index, rawMessage] of request.messages.entries()) {
    const message = object(rawMessage, `messages[${index}]`)
    const role = message.role
    if (role === 'system' || role === 'developer') {
      if (sawConversation) {
        throw new OpenAIProxyModelError(
          'System/developer messages are only supported before conversation messages.',
          'unsupported_field',
          400,
        )
      }
      instructions.push(
        textContent(message.content, `messages[${index}].content`),
      )
      continue
    }
    sawConversation = true
    if (role === 'user') {
      input.push({
        type: 'message',
        role: 'user',
        content: userContent(message.content, `messages[${index}].content`),
      })
    } else if (role === 'assistant') {
      input.push(...assistantItems(message, index))
    } else if (role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: nonEmptyString(
          message.tool_call_id,
          `messages[${index}].tool_call_id`,
        ),
        output: textContent(message.content, `messages[${index}].content`),
      })
    } else {
      throw new OpenAIProxyModelError(
        `Unsupported message role ${JSON.stringify(role)}.`,
        'unsupported_field',
        400,
      )
    }
  }
  if (input.length === 0) {
    throw new OpenAIProxyModelError(
      'At least one conversation message is required.',
      'invalid_request',
      400,
    )
  }
  const maxOutputTokens = request.max_completion_tokens ?? request.max_tokens
  if (
    request.max_completion_tokens !== undefined &&
    request.max_tokens !== undefined &&
    request.max_completion_tokens !== request.max_tokens
  ) {
    throw new OpenAIProxyModelError(
      'max_completion_tokens and max_tokens conflict.',
      'invalid_request',
      400,
    )
  }
  if (
    maxOutputTokens !== undefined &&
    (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0)
  ) {
    throw new OpenAIProxyModelError(
      'Output token limit must be a positive integer.',
      'invalid_request',
      400,
    )
  }
  if (
    request.temperature !== undefined &&
    !Number.isFinite(request.temperature)
  ) {
    throw new OpenAIProxyModelError(
      'temperature must be finite.',
      'invalid_request',
      400,
    )
  }
  if (
    request.reasoning_effort !== undefined &&
    typeof request.reasoning_effort !== 'string'
  ) {
    throw new OpenAIProxyModelError(
      'reasoning_effort must be a string.',
      'invalid_request',
      400,
    )
  }
  return {
    model: nonEmptyString(request.model, 'model'),
    instructions: instructions.join('\n\n'),
    input,
    tools: convertTools(request.tools),
    tool_choice: convertToolChoice(request.tool_choice),
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    ...(request.reasoning_effort !== undefined && {
      reasoning: {
        effort: request.reasoning_effort,
        ...(request.reasoning_effort !== 'none' && {
          summary: 'auto' as const,
        }),
      },
    }),
    // The ChatGPT/Codex subscription backend rejects the public Responses API
    // max_output_tokens field. Keep validating the caller's limit above, but
    // leave enforcement and context planning to the local client profile.
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
  }
}

function requestStreamOptionsInvalid(value: unknown): boolean {
  if (value === undefined) return false
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return true
  }
  const options = value as JsonObject
  return (
    Object.keys(options).some(key => key !== 'include_usage') ||
    options.include_usage !== true
  )
}
