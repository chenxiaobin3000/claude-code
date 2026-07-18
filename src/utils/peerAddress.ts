/**
 * Peer address parsing — kept separate from peerRegistry.ts so that
 * SendMessageTool can import parseAddress without loading transport modules.
 */

/** Parse a URI-style address into scheme + target. */
export function parseAddress(to: string): {
  scheme: 'uds' | 'tcp' | 'other'
  target: string
} {
  if (to.startsWith('uds:')) return { scheme: 'uds', target: to.slice(4) }
  if (to.startsWith('tcp:')) return { scheme: 'tcp', target: to.slice(4) }
  // Legacy: old-code UDS senders emit bare socket paths in from=; route them
  // through the UDS branch so replies aren't silently dropped into teammate
  // routing.
  if (to.startsWith('/')) return { scheme: 'uds', target: to }
  return { scheme: 'other', target: to }
}

/** Parse a tcp: target string into host and port. */
export function parseTcpTarget(
  target: string,
): { host: string; port: number } | null {
  const match = target.match(/^([^:]+):(\d+)$/)
  if (!match) return null
  const port = parseInt(match[2]!, 10)
  if (port < 1 || port > 65535) return null
  return { host: match[1]!, port }
}
