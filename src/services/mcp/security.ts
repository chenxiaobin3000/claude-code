const REDACTED = '[REDACTED]'

const SECRET_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|session|signature)/i

/**
 * Return a URL that is safe for terminal output and logs.
 *
 * User info and every query value are removed. Query names are retained so
 * users can still diagnose endpoint shape without exposing credentials.
 */
export function redactMcpUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username) url.username = REDACTED
    if (url.password) url.password = REDACTED
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, REDACTED)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return '<invalid URL>'
  }
}

export function redactMcpHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(Object.keys(headers).map(key => [key, REDACTED]))
}

export function redactMcpEnvironment(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined
  return Object.fromEntries(Object.keys(env).map(key => [key, REDACTED]))
}

/**
 * Command arguments are configuration, not a safe display surface. Even an
 * argument without a familiar secret-shaped flag can contain an access token.
 */
export function describeMcpArguments(args: string[] | undefined): string {
  const count = args?.length ?? 0
  return count === 0 ? '(none)' : `<${count} configured; values hidden>`
}

/**
 * Keep HTTP status/cause information useful while stripping URLs, bearer
 * tokens, assignments and common secret-labelled values.
 */
export function redactMcpError(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value)
  text = text.replace(
    /https?:\/\/[^\s"'<>]+/gi,
    match => redactMcpUrl(match.replace(/[),.;]+$/, '')),
  )
  text = text.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`)
  text = text.replace(
    /\b([A-Za-z_][A-Za-z0-9_.-]*)(=|:\s*)([^\s,;]+)/g,
    (match, key: string, separator: string) =>
      SECRET_KEY_PATTERN.test(key)
        ? `${key}${separator}${REDACTED}`
        : match,
  )
  return text.slice(0, 500)
}

export function getMcpHttpStatus(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/\b(?:HTTP(?:\s+status)?\s*)?([1-5]\d{2})\b/i)
  if (!match) return undefined
  const status = Number(match[1])
  return Number.isInteger(status) ? status : undefined
}

