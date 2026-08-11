export type JsonObject = Record<string, unknown>

export interface ChatCompletionRequest extends JsonObject {
  model: string
  messages: unknown[]
  stream: true
  stream_options?: { include_usage?: boolean }
  tools?: unknown[]
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  max_completion_tokens?: number
  max_tokens?: number
  reasoning_effort?: string
  temperature?: number
}

export interface ResponsesRequest extends JsonObject {
  model: string
  instructions: string
  input: JsonObject[]
  tools: JsonObject[]
  tool_choice: string | JsonObject
  parallel_tool_calls: boolean
  reasoning?: { effort: string; summary?: 'auto' }
  temperature?: number
  store: false
  stream: true
  include: ['reasoning.encrypted_content']
}

export interface ModelRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type ModelTransport = (request: ModelRequest) => Promise<Response>

export class OpenAIProxyModelError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
  }
}
