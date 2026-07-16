#!/usr/bin/env bun

import {
  collectSensitiveStrings,
  redactSensitiveText,
  sanitizeEndpoint,
  sanitizeErrorDetails,
  summarizeModelPayload,
} from '../../src/utils/logRedaction.js'
import {
  formatModelRequestError,
  formatModelRequestStart,
} from '../../src/services/api/modelDiagnostics.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertAbsent(value: string, forbidden: string, label: string): void {
  assert(
    !value.includes(forbidden),
    `${label} leaked ${JSON.stringify(forbidden)}`,
  )
}

const apiKey = 'sk-validation-APIKEY-123456789'
const oauthToken =
  'eyJhbGciOiJIUzI1NiJ9.validation-payload.validation-signature'
const prompt = 'PROMPT_SECRET_MARKER_8e714c4c'
const endpoint =
  'https://diagnostic-user:diagnostic-password@example.test/v1?access_token=url-token#private'

const rawError = Object.assign(
  new Error(
    `request failed Authorization: Bearer ${oauthToken}; x-api-key=${apiKey}; prompt=${prompt}; ${endpoint}`,
  ),
  {
    status: 401,
    code: 'invalid_api_key',
    requestId: 'request-safe-123',
  },
)

const sensitiveValues = [
  apiKey,
  ...collectSensitiveStrings([{ role: 'user', content: prompt }]),
]
const sanitizedError = sanitizeErrorDetails(rawError, {
  secrets: sensitiveValues,
})
const errorLine = formatModelRequestError({
  requestId: 'local-request-123',
  provider: 'openai',
  model: 'deepseek-local',
  durationMs: 42,
  error: sanitizedError,
})

for (const [label, value] of [
  ['sanitized error', sanitizedError.message],
  ['diagnostic error line', errorLine],
] as const) {
  assertAbsent(value, apiKey, label)
  assertAbsent(value, oauthToken, label)
  assertAbsent(value, prompt, label)
  assertAbsent(value, 'diagnostic-password', label)
  assertAbsent(value, 'url-token', label)
}
assert(errorLine.includes('401'), 'diagnostic error line lost HTTP status')
assert(errorLine.includes('invalid_api_key'), 'diagnostic error line lost code')
assert(
  errorLine.includes('request-safe-123'),
  'diagnostic error line lost request ID',
)

const sanitizedEndpoint = sanitizeEndpoint(endpoint)
assert(
  sanitizedEndpoint === 'https://example.test/v1',
  'endpoint was not sanitized',
)

const messages = [
  { role: 'system', content: 'system secret' },
  { role: 'user', content: prompt },
  { role: 'assistant', content: 'answer secret' },
]
const summary = summarizeModelPayload(messages)
const serializedSummary = JSON.stringify(summary)
assert(summary.itemCount === 3, 'payload summary lost message count')
assert(summary.roles?.user === 1, 'payload summary lost role counts')
assertAbsent(serializedSummary, prompt, 'payload summary')
assertAbsent(serializedSummary, 'system secret', 'payload summary')

const startLine = formatModelRequestStart({
  requestId: 'local-request-123',
  provider: 'openai',
  model: 'deepseek-local',
  endpoint,
  messageCount: messages.length,
  inputChars: summary.serializedChars,
  toolCount: 2,
  maxOutputTokens: 4096,
  thinking: true,
  source: 'validation',
})
assertAbsent(startLine, prompt, 'request start line')
assertAbsent(startLine, 'diagnostic-password', 'request start line')
assertAbsent(startLine, 'url-token', 'request start line')

const genericRedaction = redactSensitiveText(
  `Authorization: Bearer ${oauthToken} apiKey=${apiKey}`,
  { secrets: [apiKey] },
)
assertAbsent(genericRedaction, apiKey, 'generic redaction')
assertAbsent(genericRedaction, oauthToken, 'generic redaction')

const truncated = redactSensitiveText('x'.repeat(100), { maxLength: 20 })
assert(
  truncated.endsWith('…[TRUNCATED]'),
  'long diagnostics were not truncated',
)

console.log('[validation] model diagnostics redaction passed')
