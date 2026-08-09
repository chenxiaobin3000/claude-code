import { resolveOpenAIProxyUrl } from './config.js'

export type OpenAIProxyMode = 'direct' | 'http-connect'
export type OpenAIProxyNetworkFailure =
  | 'proxy_authentication'
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'proxy_or_tcp'
  | 'network'

export interface OpenAIUpstreamFetch {
  fetch: typeof fetch
  proxyMode: OpenAIProxyMode
  proxyDisplay: string
}

interface BunProxyRequestInit extends RequestInit {
  proxy: string
  keepalive: false
}

export class OpenAIProxyNetworkError extends Error {
  constructor(readonly kind: OpenAIProxyNetworkFailure) {
    super(`OpenAI upstream request failed through configured proxy (kind=${kind}).`)
  }
}

function safeProxyDisplay(url: URL): string {
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname}${port}`
}

export function redactOpenAIProxySecret(value: string): string {
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
      /OPENAI_PROXY_URL\s*[=:]\s*[^\s,;]+/gi,
      'OPENAI_PROXY_URL=[REDACTED]',
    )
}

export function validateOpenAIProxyUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('OPENAI_PROXY_URL is invalid.')
  }
  if (url.protocol === 'socks5:' || url.protocol === 'socks5h:') {
    throw new Error(
      'SOCKS5 is not supported by the current Bun standalone runtime; use an HTTP or HTTPS CONNECT proxy.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Unsupported OPENAI_PROXY_URL protocol ${url.protocol}; use HTTP or HTTPS CONNECT.`,
    )
  }
  if (!url.hostname) throw new Error('OPENAI_PROXY_URL has no hostname.')
  if (url.search) throw new Error('OPENAI_PROXY_URL must not contain query parameters.')
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('OPENAI_PROXY_URL must not contain a path.')
  }
  url.hash = ''
  return url
}

export function classifyOpenAIProxyNetworkError(
  error: unknown,
): OpenAIProxyNetworkFailure {
  if (error instanceof OpenAIProxyNetworkError) return error.kind
  const message = redactOpenAIProxySecret(
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
  if (/ECONNREFUSED|ECONNRESET|socket|proxy/i.test(`${code} ${message}`)) {
    return 'proxy_or_tcp'
  }
  return 'network'
}

export function createOpenAIUpstreamFetch(
  proxyValue: string | undefined = resolveOpenAIProxyUrl(),
): OpenAIUpstreamFetch {
  if (!proxyValue) {
    return {
      fetch: globalThis.fetch.bind(globalThis),
      proxyMode: 'direct',
      proxyDisplay: 'direct',
    }
  }
  const proxy = validateOpenAIProxyUrl(proxyValue)
  // Bun applies NO_PROXY even when its explicit per-request proxy option is
  // present. This Host is an isolated process, so clear both spellings once an
  // explicit OPENAI_PROXY_URL is selected; otherwise a broad user bypass could
  // silently turn a required proxy request into a direct connection.
  process.env.NO_PROXY = ''
  process.env.no_proxy = ''
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
      throw new OpenAIProxyNetworkError(
        classifyOpenAIProxyNetworkError(error),
      )
    }
  }) as typeof fetch
  return {
    fetch: proxyFetch,
    proxyMode: 'http-connect',
    proxyDisplay: safeProxyDisplay(proxy),
  }
}
