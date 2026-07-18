/**
 * Authentication for a user-operated Remote Control Server.
 *
 * Tokens must be configured explicitly by the operator. This module does not
 * consume Claude OAuth/API keys, session cookies, organization identifiers,
 * inherited file descriptors, or credentials downloaded by another service.
 */
export function getSessionIngressAuthToken(): string | null {
  return process.env.CLAUDE_CODE_RCS_AUTH_TOKEN?.trim() || null
}

export function getSessionIngressAuthHeaders(): Record<string, string> {
  const token = getSessionIngressAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function updateSessionIngressAuthToken(token: string): void {
  process.env.CLAUDE_CODE_RCS_AUTH_TOKEN = token
}
