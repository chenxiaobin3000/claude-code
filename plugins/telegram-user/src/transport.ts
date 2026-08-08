import type { ProxyInterface } from 'telegram/network/connection/TCPMTProxy'

export type TelegramUserProxyMode = 'direct' | 'socks5'

export interface TelegramUserTransport {
  proxy?: ProxyInterface
  proxyMode: TelegramUserProxyMode
  proxyDisplay: string
}

function safeProxyDisplay(url: URL): string {
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname}${port}`
}

export function redactTelegramUserProxySecret(value: string): string {
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
      /TELEGRAM_USER_PROXY_URL\s*[=:]\s*[^\s,;]+/gi,
      'TELEGRAM_USER_PROXY_URL=[REDACTED]',
    )
}

export function validateTelegramUserProxyUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Telegram User proxy URL is invalid.')
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    throw new Error(
      'Telegram User HTTP/HTTPS CONNECT proxy is not supported by GramJS; use SOCKS5.',
    )
  }
  if (url.protocol !== 'socks5:' && url.protocol !== 'socks5h:') {
    throw new Error(
      `Unsupported Telegram User proxy protocol ${url.protocol}; use SOCKS5.`,
    )
  }
  if (!url.hostname) throw new Error('Telegram User proxy URL has no hostname.')
  const port = Number(url.port || 1080)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Telegram User proxy port is invalid.')
  }
  if (url.search || url.hash) {
    throw new Error(
      'Telegram User proxy URL must not contain query parameters or a fragment.',
    )
  }
  return url
}

export function createTelegramUserTransport(
  proxyValue?: string,
): TelegramUserTransport {
  if (!proxyValue) {
    return {
      proxyMode: 'direct',
      proxyDisplay: 'direct',
    }
  }
  const url = validateTelegramUserProxyUrl(proxyValue)
  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  return {
    proxy: {
      ip: url.hostname,
      port: Number(url.port || 1080),
      socksType: 5,
      timeout: 10,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    },
    proxyMode: 'socks5',
    proxyDisplay: safeProxyDisplay(url),
  }
}

export function classifyTelegramUserTransportError(error: unknown): string {
  const message = redactTelegramUserProxySecret(
    error instanceof Error ? error.message : String(error),
  )
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (/AUTH_KEY|SESSION_REVOKED|not authorized|PASSWORD_HASH|PHONE_CODE/i.test(message)) {
    return 'telegram_authentication'
  }
  if (/FLOOD_WAIT/i.test(message)) return 'telegram_rate_limit'
  if (/MIGRATE/i.test(message)) return 'telegram_dc_migration'
  if (/407|authentication|auth failed/i.test(message)) {
    return 'proxy_authentication'
  }
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(`${code} ${message}`)) return 'dns'
  if (/CERT|TLS|SSL/i.test(`${code} ${message}`)) return 'tls'
  if (/timeout|ETIMEDOUT|abort/i.test(`${code} ${message}`)) return 'timeout'
  if (/ECONNREFUSED|ECONNRESET|socket|proxy|socks/i.test(`${code} ${message}`)) {
    return 'proxy_or_tcp'
  }
  return 'network'
}
