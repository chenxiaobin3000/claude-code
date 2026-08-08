export type TelegramProxyMode = 'direct' | 'http-connect'

export interface TelegramTransport {
  fetch: typeof fetch
  proxyMode: TelegramProxyMode
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

export function redactTelegramTransportSecret(value: string): string {
  return value
    .replace(/(?:https?|socks5h?):\/\/[^\s]+/gi, raw => {
      try {
        const url = new URL(raw)
        if (url.username || url.password) {
          url.username = '[REDACTED]'
          url.password = ''
        }
        url.search = ''
        url.hash = ''
        return url.href
      } catch {
        return '[REDACTED PROXY URL]'
      }
    })
    .replace(
      /TELEGRAM_PROXY_URL\s*[=:]\s*[^\s,;]+/gi,
      'TELEGRAM_PROXY_URL=[REDACTED]',
    )
}

export function validateTelegramProxyUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Telegram Bot proxy URL is invalid.')
  }
  if (url.protocol === 'socks5:' || url.protocol === 'socks5h:') {
    throw new Error(
      'Telegram Bot SOCKS5 proxy is not supported by the current Bun standalone fetch runtime; use an HTTP or HTTPS proxy.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Unsupported Telegram Bot proxy protocol ${url.protocol}; use HTTP or HTTPS.`,
    )
  }
  if (!url.hostname) throw new Error('Telegram Bot proxy URL has no hostname.')
  url.hash = ''
  return url
}

export function createTelegramTransport(
  proxyValue?: string,
): TelegramTransport {
  if (!proxyValue) {
    return {
      fetch: globalThis.fetch.bind(globalThis),
      proxyMode: 'direct',
      proxyDisplay: 'direct',
    }
  }
  const proxy = validateTelegramProxyUrl(proxyValue)
  const proxyFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    try {
      return await globalThis.fetch(input, {
        ...init,
        proxy: proxy.href,
        keepalive: false,
      } as BunProxyRequestInit)
    } catch (error) {
      const kind = classifyTelegramTransportError(error)
      throw Object.assign(
        new Error(`Telegram proxy request failed (kind=${kind}).`),
        { kind },
      )
    }
  }) as typeof fetch
  return {
    fetch: proxyFetch,
    proxyMode: 'http-connect',
    proxyDisplay: safeProxyDisplay(proxy),
  }
}

export function classifyTelegramTransportError(error: unknown): string {
  const message = redactTelegramTransportSecret(
    error instanceof Error ? error.message : String(error),
  )
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (error && typeof error === 'object' && 'kind' in error) {
    const kind = (error as { kind?: unknown }).kind
    if (typeof kind === 'string') return kind
  }
  if (/407|proxy authentication/i.test(message)) return 'proxy_authentication'
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(`${code} ${message}`)) return 'dns'
  if (/CERT|TLS|SSL/i.test(`${code} ${message}`)) return 'tls'
  if (/timeout|ETIMEDOUT|abort/i.test(`${code} ${message}`)) return 'timeout'
  if (/ECONNREFUSED|ECONNRESET|socket|proxy/i.test(`${code} ${message}`)) {
    return 'proxy_or_tcp'
  }
  return 'network'
}
