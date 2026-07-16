export interface RedactionOptions {
  secrets?: readonly string[]
  maxLength?: number
}

export interface ModelPayloadSummary {
  kind: 'array' | 'object' | 'string' | 'number' | 'boolean' | 'null' | 'other'
  itemCount?: number
  serializedChars: number
  roles?: Record<'assistant' | 'system' | 'tool' | 'unknown' | 'user', number>
}

export interface SanitizedErrorDetails {
  name: string
  message: string
  status?: number
  code?: string
  requestId?: string
}

const REDACTED = '[REDACTED]'
const DEFAULT_MAX_LENGTH = 2_000

const SENSITIVE_KEY =
  '(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|oauth[-_]?token|client[-_]?secret|password)'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function safeString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  return redactSensitiveText(String(value), { maxLength })
}

export function redactSensitiveText(
  value: string,
  options: RedactionOptions = {},
): string {
  let redacted = value

  const secrets = [...new Set(options.secrets ?? [])]
    .filter(secret => secret.length >= 4 && secret !== 'not-required')
    .sort((a, b) => b.length - a.length)
  for (const secret of secrets) {
    redacted = redacted.split(secret).join(REDACTED)
  }

  redacted = redacted
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${REDACTED}@`)
    .replace(
      new RegExp(
        `(["']?${SENSITIVE_KEY}["']?\\s*[:=]\\s*["']?)(?:Bearer\\s+|Basic\\s+)?[^"'\\s,;&}\\]]+`,
        'gi',
      ),
      `$1${REDACTED}`,
    )
    .replace(
      new RegExp(`([?&]${SENSITIVE_KEY}=)[^&#\\s]+`, 'gi'),
      `$1${REDACTED}`,
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, REDACTED)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)

  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  if (redacted.length > maxLength) {
    return `${redacted.slice(0, maxLength)}…[TRUNCATED]`
  }
  return redacted
}

export function sanitizeEndpoint(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return '[INVALID_ENDPOINT]'
  }
}

export function collectSensitiveStrings(value: unknown, limit = 256): string[] {
  const collected: string[] = []
  const seen = new WeakSet<object>()

  function visit(current: unknown): void {
    if (collected.length >= limit) return
    if (typeof current === 'string') {
      if (current.length >= 8) collected.push(current)
      return
    }
    if (!current || typeof current !== 'object') return
    if (seen.has(current)) return
    seen.add(current)
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    for (const item of Object.values(current as Record<string, unknown>)) {
      visit(item)
    }
  }

  visit(value)
  return collected
}

export function summarizeModelPayload(value: unknown): ModelPayloadSummary {
  let serializedChars = 0
  try {
    serializedChars = JSON.stringify(value)?.length ?? 0
  } catch {
    serializedChars = String(value).length
  }

  if (value === null) return { kind: 'null', serializedChars }
  if (Array.isArray(value)) {
    const roles = {
      assistant: 0,
      system: 0,
      tool: 0,
      unknown: 0,
      user: 0,
    }
    for (const item of value) {
      const role = asRecord(item)?.role
      if (
        role === 'assistant' ||
        role === 'system' ||
        role === 'tool' ||
        role === 'user'
      ) {
        roles[role]++
      } else {
        roles.unknown++
      }
    }
    return {
      kind: 'array',
      itemCount: value.length,
      serializedChars,
      roles,
    }
  }
  if (typeof value === 'object') return { kind: 'object', serializedChars }
  if (typeof value === 'string') return { kind: 'string', serializedChars }
  if (typeof value === 'number') return { kind: 'number', serializedChars }
  if (typeof value === 'boolean') return { kind: 'boolean', serializedChars }
  return { kind: 'other', serializedChars }
}

export function sanitizeErrorDetails(
  error: unknown,
  options: RedactionOptions = {},
): SanitizedErrorDetails {
  const record = asRecord(error)
  const rawMessage = error instanceof Error ? error.message : String(error)
  const rawName = error instanceof Error ? error.name : 'Error'
  const status = record?.status
  const requestId =
    safeString(record?.requestId) ?? safeString(record?.request_id)

  return {
    name: redactSensitiveText(rawName, { maxLength: 100 }),
    message: redactSensitiveText(rawMessage, options),
    ...(typeof status === 'number' ? { status } : {}),
    ...(safeString(record?.code) ? { code: safeString(record?.code) } : {}),
    ...(requestId ? { requestId } : {}),
  }
}

export function createSafeError(details: SanitizedErrorDetails): Error {
  const error = new Error(details.message)
  error.name = details.name
  return Object.assign(error, {
    ...(details.status !== undefined ? { status: details.status } : {}),
    ...(details.code ? { code: details.code } : {}),
    ...(details.requestId ? { requestId: details.requestId } : {}),
  })
}
