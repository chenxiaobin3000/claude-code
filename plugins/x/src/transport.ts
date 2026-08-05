export type XProxyMode = 'direct' | 'http-connect'

export interface XTransport {
  fetch: typeof fetch
  proxyMode: XProxyMode
  proxyDisplay: string
}

interface BunProxyRequestInit extends RequestInit {
  proxy: string
  keepalive: false
}

function safeProxyDisplay(url: URL): string {
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname}${port}`
}

export function redactXSecret(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(https?|socks5h?):\/\/[^\s/@]+@/gi, '$1://[REDACTED]@')
    .replace(/X_BEARER_TOKEN\s*[=:]\s*[^\s,;]+/gi, 'X_BEARER_TOKEN=[REDACTED]')
}

export function validateXProxyUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('X proxy URL is invalid.')
  }
  if (url.protocol === 'socks5:' || url.protocol === 'socks5h:')
    throw new Error(
      'SOCKS5 is not supported by the current Bun standalone fetch runtime; use an HTTP or HTTPS CONNECT proxy.',
    )
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(
      `Unsupported X proxy protocol ${url.protocol}; use HTTP or HTTPS CONNECT.`,
    )
  if (!url.hostname) throw new Error('X proxy URL has no hostname.')
  url.hash = ''
  return url
}

export function createXTransport(proxyValue?: string): XTransport {
  if (!proxyValue)
    return {
      fetch: globalThis.fetch.bind(globalThis),
      proxyMode: 'direct',
      proxyDisplay: 'direct',
    }
  const proxy = validateXProxyUrl(proxyValue)
  const proxyFetch = ((input: string | URL | Request, init?: RequestInit) =>
    globalThis.fetch(input, {
      ...init,
      proxy: proxy.href,
      keepalive: false,
    } as BunProxyRequestInit)) as typeof fetch
  return {
    fetch: proxyFetch,
    proxyMode: 'http-connect',
    proxyDisplay: safeProxyDisplay(proxy),
  }
}

export function classifyXNetworkError(error: unknown): string {
  const message = redactXSecret(
    error instanceof Error ? error.message : String(error),
  )
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (/407|proxy authentication/i.test(message)) return 'proxy_authentication'
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(`${code} ${message}`)) return 'dns'
  if (/CERT|TLS|SSL/i.test(`${code} ${message}`)) return 'tls'
  if (/timeout|ETIMEDOUT|abort/i.test(`${code} ${message}`)) return 'timeout'
  if (/ECONNREFUSED|ECONNRESET|socket|proxy/i.test(`${code} ${message}`))
    return 'proxy_or_tcp'
  return 'network'
}
