import { logForDebugging } from '../../utils/debug.js'
import {
  type SanitizedErrorDetails,
  redactSensitiveText,
  sanitizeEndpoint,
} from '../../utils/logRedaction.js'

interface ModelDiagnosticBase {
  requestId: string
  model: string
  provider: 'openai'
}

export interface ModelRequestStartDiagnostic extends ModelDiagnosticBase {
  endpoint: string
  inputChars: number
  maxOutputTokens: number
  messageCount: number
  source?: string
  thinking: boolean
  toolCount: number
}

export interface ModelRequestSuccessDiagnostic extends ModelDiagnosticBase {
  durationMs: number
  inputTokens: number
  outputTokens: number
  stopReason: string | null
  toolCallCount: number
  ttftMs: number | null
}

export interface ModelRequestErrorDiagnostic extends ModelDiagnosticBase {
  durationMs: number
  error: SanitizedErrorDetails
}

type DiagnosticRecord = Record<
  string,
  boolean | null | number | string | undefined
>

function diagnosticLine(event: string, values: DiagnosticRecord): string {
  const sanitized = Object.fromEntries(
    Object.entries(values)
      .filter(
        (entry): entry is [string, boolean | null | number | string] =>
          entry[1] !== undefined,
      )
      .map(([key, value]) => [
        key,
        typeof value === 'string'
          ? redactSensitiveText(value, { maxLength: 500 })
          : value,
      ]),
  )
  return `[ModelDiagnostic] ${JSON.stringify({ event, ...sanitized })}`
}

export function formatModelRequestStart(
  diagnostic: ModelRequestStartDiagnostic,
): string {
  return diagnosticLine('request_start', {
    requestId: diagnostic.requestId,
    provider: diagnostic.provider,
    model: diagnostic.model,
    endpoint: sanitizeEndpoint(diagnostic.endpoint),
    messageCount: diagnostic.messageCount,
    inputChars: diagnostic.inputChars,
    toolCount: diagnostic.toolCount,
    maxOutputTokens: diagnostic.maxOutputTokens,
    thinking: diagnostic.thinking,
    source: diagnostic.source,
  })
}

export function logModelRequestStart(
  diagnostic: ModelRequestStartDiagnostic,
): void {
  logForDebugging(formatModelRequestStart(diagnostic), { level: 'info' })
}

export function logModelRequestFirstToken(
  diagnostic: ModelDiagnosticBase & { ttftMs: number },
): void {
  logForDebugging(
    diagnosticLine('first_token', {
      requestId: diagnostic.requestId,
      provider: diagnostic.provider,
      model: diagnostic.model,
      ttftMs: diagnostic.ttftMs,
    }),
    { level: 'info' },
  )
}

export function logModelRequestSuccess(
  diagnostic: ModelRequestSuccessDiagnostic,
): void {
  logForDebugging(
    diagnosticLine('request_success', {
      requestId: diagnostic.requestId,
      provider: diagnostic.provider,
      model: diagnostic.model,
      durationMs: diagnostic.durationMs,
      ttftMs: diagnostic.ttftMs,
      inputTokens: diagnostic.inputTokens,
      outputTokens: diagnostic.outputTokens,
      stopReason: diagnostic.stopReason,
      toolCallCount: diagnostic.toolCallCount,
    }),
    { level: 'info' },
  )
}

export function formatModelRequestError(
  diagnostic: ModelRequestErrorDiagnostic,
): string {
  return diagnosticLine('request_error', {
    requestId: diagnostic.requestId,
    provider: diagnostic.provider,
    model: diagnostic.model,
    durationMs: diagnostic.durationMs,
    errorName: diagnostic.error.name,
    errorMessage: diagnostic.error.message,
    status: diagnostic.error.status,
    code: diagnostic.error.code,
    providerRequestId: diagnostic.error.requestId,
  })
}

export function logModelRequestError(
  diagnostic: ModelRequestErrorDiagnostic,
): void {
  logForDebugging(formatModelRequestError(diagnostic), { level: 'error' })
}
