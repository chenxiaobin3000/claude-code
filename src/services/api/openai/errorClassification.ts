import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import {
  type RedactionOptions,
  type SanitizedErrorDetails,
  sanitizeEndpoint,
  sanitizeErrorDetails,
} from '../../../utils/logRedaction.js'

export type OpenAIErrorKind =
  | 'authentication'
  | 'context_limit'
  | 'model_not_found'
  | 'network'
  | 'protocol_request'
  | 'protocol_response'
  | 'protocol_route'
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'unknown'

export type OpenAIErrorPhase = 'connection' | 'request' | 'response' | 'stream'

export interface ClassifiedOpenAIError {
  details: SanitizedErrorDetails
  endpoint?: string
  kind: OpenAIErrorKind
  userMessage: string
}

export interface OpenAIErrorContext extends RedactionOptions {
  endpoint?: string
  phase?: OpenAIErrorPhase
}

export class OpenAIRequestError extends Error {
  readonly classification: ClassifiedOpenAIError

  constructor(classification: ClassifiedOpenAIError, cause?: unknown) {
    super(classification.userMessage, { cause })
    this.name = 'OpenAIRequestError'
    this.classification = classification
  }
}

function includesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value))
}

function endpointLabel(endpoint?: string): string {
  return endpoint ? ` ${endpoint}` : ''
}

function formatUserMessage(
  kind: OpenAIErrorKind,
  details: SanitizedErrorDetails,
  endpoint?: string,
): string {
  const target = endpointLabel(endpoint)
  switch (kind) {
    case 'authentication':
      return `Authentication failed for the configured OpenAI-compatible endpoint${target}. Check the API key and endpoint permissions.`
    case 'rate_limit':
      return `The configured OpenAI-compatible endpoint${target} rejected the request because of rate limits or quota. Retry later or check the account quota.`
    case 'context_limit':
      return `The request exceeds the configured model context or output limit. Reduce the conversation size or correct the model profile limits. Provider detail: ${details.message}`
    case 'model_not_found':
      return `The configured endpoint${target} does not provide the selected model. Check the exact model ID in models.json.`
    case 'network':
      return `Unable to connect to the configured OpenAI-compatible endpoint${target}. Check the address, listener, proxy, and network connection.`
    case 'timeout':
      return `The request to the configured OpenAI-compatible endpoint${target} timed out.`
    case 'protocol_route':
      return `OpenAI compatibility error: endpoint${target} does not expose the required POST /chat/completions route. Check whether baseUrl includes the correct API prefix such as /v1. No provider-specific fallback was attempted.`
    case 'protocol_request':
      return `OpenAI compatibility error: endpoint${target} rejected a required Chat Completions request field. It must support streaming, stream_options, messages, tools, and tool_choice when used. No fields were removed and no provider-specific fallback was attempted. Provider detail: ${details.message}`
    case 'protocol_response':
      return `OpenAI compatibility error: endpoint${target} returned a response that does not follow the OpenAI Chat Completions JSON/SSE contract. No provider-specific response adapter was attempted. Provider detail: ${details.message}`
    case 'server_error':
      return `The configured OpenAI-compatible endpoint${target} returned a server error${details.status ? ` (HTTP ${details.status})` : ''}.`
    case 'unknown':
      return `API Error: ${details.message}`
  }
}

function classifyDetails(
  details: SanitizedErrorDetails,
  phase: OpenAIErrorPhase,
): OpenAIErrorKind {
  const status = details.status
  const value = `${details.name} ${details.code ?? ''} ${details.message}`.toLowerCase()

  if (
    status === 401 ||
    status === 403 ||
    includesAny(value, [
      /invalid[_ -]?api[_ -]?key/,
      /authentication.*(?:failed|required)/,
      /unauthorized/,
    ])
  ) {
    return 'authentication'
  }
  if (status === 429 || /rate.?limit|quota.*(?:exceed|limit)/.test(value)) {
    return 'rate_limit'
  }
  if (
    includesAny(value, [
      /context.{0,40}(?:exceed|limit|length|size|too long|maximum)/,
      /(?:exceed|too many).{0,40}(?:context|tokens?)/,
      /maximum context/,
      /token limit/,
    ])
  ) {
    return 'context_limit'
  }
  if (
    details.code === 'model_not_found' ||
    includesAny(value, [
      /model.{0,40}(?:not found|does not exist|unknown|unavailable)/,
      /no such model/,
    ])
  ) {
    return 'model_not_found'
  }
  if (
    includesAny(value, [
      /timed? ?out/,
      /etimedout/,
      /request time limit/,
      /aborterror/,
    ])
  ) {
    return 'timeout'
  }
  if (
    includesAny(value, [
      /apiconnectionerror/,
      /econnrefused/,
      /econnreset/,
      /enotfound/,
      /fetch failed/,
      /network error/,
      /socket hang up/,
    ])
  ) {
    return 'network'
  }
  if (status === 405 || (status === 404 && !/model/.test(value))) {
    return 'protocol_route'
  }
  if (
    (status === 400 || status === 422) &&
    includesAny(value, [
      /(?:unknown|unsupported|unrecognized|unexpected|invalid).{0,40}(?:stream_options|stream|tools?|tool_choice|messages?)/,
      /(?:stream_options|stream|tools?|tool_choice|messages?).{0,40}(?:unknown|unsupported|unrecognized|not supported|not allowed)/,
    ])
  ) {
    return 'protocol_request'
  }
  if (
    phase === 'response' ||
    phase === 'stream' ||
    includesAny(value, [
      /invalid_chat_completion/,
      /server[- ]sent events?|\bsse\b/,
      /event.?stream/,
      /content.?type.{0,30}(?:html|text\/plain|unexpected)/,
      /unexpected token.{0,10}</,
      /(?:json|response).{0,30}(?:parse|invalid|malformed)/,
    ])
  ) {
    return 'protocol_response'
  }
  if (status !== undefined && status >= 500) return 'server_error'
  return 'unknown'
}

export function classifyOpenAIError(
  error: unknown,
  context: OpenAIErrorContext = {},
): ClassifiedOpenAIError {
  if (error instanceof OpenAIRequestError) return error.classification
  const details = sanitizeErrorDetails(error, { secrets: context.secrets })
  const endpoint = context.endpoint
    ? sanitizeEndpoint(context.endpoint)
    : undefined
  const kind = classifyDetails(details, context.phase ?? 'request')
  return {
    details,
    endpoint,
    kind,
    userMessage: formatUserMessage(kind, details, endpoint),
  }
}

export function createOpenAIRequestError(
  error: unknown,
  context: OpenAIErrorContext = {},
): OpenAIRequestError {
  if (error instanceof OpenAIRequestError) return error
  return new OpenAIRequestError(classifyOpenAIError(error, context), error)
}

function protocolResponseError(message: string): Error {
  return Object.assign(new Error(`invalid_chat_completion_response: ${message}`), {
    code: 'invalid_chat_completion_response',
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function assertOpenAIChatCompletionResponse(value: unknown): void {
  const response = asRecord(value)
  if (!response || !Array.isArray(response.choices)) {
    throw protocolResponseError('non-streaming response must contain choices[]')
  }
  const first = asRecord(response.choices[0])
  if (!first || !asRecord(first.message)) {
    throw protocolResponseError('first choice must contain message')
  }
}

function assertOpenAIChatCompletionChunk(value: unknown): boolean {
  const chunk = asRecord(value)
  if (!chunk || !Array.isArray(chunk.choices)) {
    throw protocolResponseError('stream chunk must contain choices[]')
  }
  let hasChoice = false
  for (const rawChoice of chunk.choices) {
    const choice = asRecord(rawChoice)
    if (!choice || !asRecord(choice.delta)) {
      throw protocolResponseError('stream choice must contain delta')
    }
    hasChoice = true
  }
  return hasChoice
}

export async function* validateOpenAIChatCompletionStream(
  source: AsyncIterable<ChatCompletionChunk>,
): AsyncGenerator<ChatCompletionChunk> {
  let sawChoice = false
  for await (const chunk of source) {
    sawChoice = assertOpenAIChatCompletionChunk(chunk) || sawChoice
    yield chunk
  }
  if (!sawChoice) {
    throw protocolResponseError('stream ended without a completion choice')
  }
}
