import type { XAppConfig } from './config.js'
import { resolveXBearerToken, resolveXProxyUrl } from './config.js'
import {
  classifyXNetworkError,
  createXTransport,
  redactXSecret,
  type XProxyMode,
} from './transport.js'

const POST_FIELDS = [
  'id',
  'text',
  'conversation_id',
  'created_at',
  'lang',
  'public_metrics',
  'attachments',
]
const USER_FIELDS = [
  'id',
  'name',
  'username',
  'description',
  'created_at',
  'location',
  'profile_image_url',
  'protected',
  'public_metrics',
  'url',
  'verified',
  'verified_type',
]
const EXPANSIONS = ['author_id', 'attachments.media_keys', 'referenced_posts']
const MEDIA_FIELDS = [
  'media_key',
  'type',
  'url',
  'preview_image_url',
  'alt_text',
  'width',
  'height',
  'duration_ms',
]
const MAX_OUTPUT_BYTES = 512 * 1024
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGES = 2

interface RateLimit {
  limit?: number
  remaining?: number
  reset?: number
}

export interface XResult {
  app: string
  data: unknown
  includes?: unknown
  errors?: unknown
  meta?: unknown
  rateLimit: RateLimit
  partial: boolean
  partialReason?: string
}

interface RawPage {
  body: Record<string, unknown>
  rateLimit: RateLimit
}

function integerHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rateLimit(headers: Headers): RateLimit {
  return {
    limit: integerHeader(headers, 'x-rate-limit-limit'),
    remaining: integerHeader(headers, 'x-rate-limit-remaining'),
    reset: integerHeader(headers, 'x-rate-limit-reset'),
  }
}

function pageSize(value?: number): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(value) || value < 5 || value > 100)
    throw new Error('max_results must be an integer from 5 to 100.')
  return value
}

function pageCount(value?: number): number {
  if (value === undefined) return 1
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGES)
    throw new Error(`pages must be an integer from 1 to ${MAX_PAGES}.`)
  return value
}

function ensureOutputSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_OUTPUT_BYTES)
    throw new Error('X API result exceeds the 512 KiB output limit.')
}

function nextToken(body: Record<string, unknown>): string | undefined {
  const meta = body.meta
  if (!meta || typeof meta !== 'object') return undefined
  const record = meta as Record<string, unknown>
  const raw = record.next_token ?? record.nextToken
  return typeof raw === 'string' ? raw : undefined
}

function addCommonPostFields(params: URLSearchParams): void {
  params.set('post.fields', POST_FIELDS.join(','))
  params.set('expansions', EXPANSIONS.join(','))
  params.set('user.fields', USER_FIELDS.join(','))
  params.set('media.fields', MEDIA_FIELDS.join(','))
}

function errorKind(status: number): string {
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission_or_plan'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'x_service'
  return 'x_api'
}

export class XReadOnlyClient {
  readonly proxyMode: XProxyMode
  readonly proxyDisplay: string
  private readonly token: string
  private readonly baseUrl: string
  private readonly transportFetch: typeof fetch

  constructor(
    readonly app: XAppConfig,
    options: { baseUrl?: string; proxyUrl?: string } = {},
  ) {
    const transport = createXTransport(options.proxyUrl ?? resolveXProxyUrl())
    this.proxyMode = transport.proxyMode
    this.proxyDisplay = transport.proxyDisplay
    this.transportFetch = transport.fetch
    this.token = resolveXBearerToken(app)
    this.baseUrl = (options.baseUrl ?? 'https://api.x.com').replace(/\/$/, '')
  }

  private async request(
    path: string,
    params: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<RawPage> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const query = params.toString()
      const response = await this.transportFetch(
        `${this.baseUrl}${path}${query ? `?${query}` : ''}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
            'User-Agent': 'claude-code-x-plugin/1.0',
          },
          signal: controller.signal,
        },
      )
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES)
        throw new Error('X API response exceeds the 512 KiB limit.')
      if (!response.ok) {
        const reset = integerHeader(response.headers, 'x-rate-limit-reset')
        throw new Error(
          `X API ${errorKind(response.status)} error (${response.status})${reset ? `; rate limit resets at ${new Date(reset * 1000).toISOString()}` : ''}.`,
        )
      }
      return {
        body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
        rateLimit: rateLimit(response.headers),
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('X API '))
        throw error
      throw new Error(
        `X API ${classifyXNetworkError(error)} error: ${redactXSecret(error instanceof Error ? error.message : String(error))}`,
      )
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private result(
    page: RawPage,
    partial = false,
    partialReason?: string,
  ): XResult {
    const result: XResult = {
      app: this.app.alias,
      data: page.body.data,
      includes: page.body.includes,
      errors: page.body.errors,
      meta: page.body.meta,
      rateLimit: page.rateLimit,
      partial,
      ...(partialReason ? { partialReason } : {}),
    }
    ensureOutputSize(result)
    return result
  }

  async doctor(signal?: AbortSignal): Promise<XResult> {
    const params = new URLSearchParams({
      'user.fields': 'id,name,username',
    })
    return this.result(
      await this.request('/2/users/by/username/XDevelopers', params, signal),
    )
  }

  async getPost(id: string, signal?: AbortSignal): Promise<XResult> {
    const params = new URLSearchParams()
    addCommonPostFields(params)
    return this.result(
      await this.request(`/2/tweets/${encodeURIComponent(id)}`, params, signal),
    )
  }

  async getUser(
    input: { userId?: string; username?: string },
    signal?: AbortSignal,
  ): Promise<XResult> {
    const params = new URLSearchParams({ 'user.fields': USER_FIELDS.join(',') })
    const path = input.userId
      ? `/2/users/${encodeURIComponent(input.userId)}`
      : `/2/users/by/username/${encodeURIComponent(input.username ?? '')}`
    return this.result(await this.request(path, params, signal))
  }

  private async userId(
    id?: string,
    username?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (id) return id
    if (!username) throw new Error('Either user_id or username is required.')
    const result = await this.getUser({ username }, signal)
    const data = result.data as { id?: unknown } | undefined
    if (typeof data?.id !== 'string')
      throw new Error('X user lookup returned no user ID.')
    return data.id
  }

  private async paginated(
    requestedPages: number | undefined,
    call: (token?: string) => Promise<RawPage>,
  ): Promise<XResult> {
    const maximumPages = pageCount(requestedPages)
    const data: unknown[] = []
    const includes: unknown[] = []
    const errors: unknown[] = []
    let token: string | undefined
    let latest: RawPage | undefined
    let fetched = 0
    for (let index = 0; index < maximumPages; index++) {
      const page = await call(token)
      fetched++
      latest = page
      const pageData = page.body.data
      if (Array.isArray(pageData)) data.push(...pageData)
      else if (pageData !== undefined) data.push(pageData)
      if (page.body.includes !== undefined) includes.push(page.body.includes)
      if (Array.isArray(page.body.errors)) errors.push(...page.body.errors)
      token = nextToken(page.body)
      ensureOutputSize({ data, includes, errors })
      if (!token) break
    }
    if (!latest) throw new Error('X API returned no pages.')
    const partial = Boolean(token)
    return this.result(
      {
        body: {
          data,
          ...(includes.length ? { includes } : {}),
          ...(errors.length ? { errors } : {}),
          meta: { next_token: token, pages_fetched: fetched },
        },
        rateLimit: latest.rateLimit,
      },
      partial,
      partial ? 'page_limit' : undefined,
    )
  }

  async getUserPosts(
    input: {
      userId?: string
      username?: string
      maxResults?: number
      pages?: number
    },
    signal?: AbortSignal,
  ): Promise<XResult> {
    const id = await this.userId(input.userId, input.username, signal)
    return this.paginated(input.pages, token => {
      const params = new URLSearchParams({
        max_results: String(pageSize(input.maxResults)),
      })
      if (token) params.set('pagination_token', token)
      addCommonPostFields(params)
      return this.request(
        `/2/users/${encodeURIComponent(id)}/tweets`,
        params,
        signal,
      )
    })
  }

  async searchRecent(
    input: { query: string; maxResults?: number; pages?: number },
    signal?: AbortSignal,
  ): Promise<XResult> {
    const query = input.query.trim()
    if (!query || query.length > 512)
      throw new Error('query must contain 1-512 characters.')
    return this.paginated(input.pages, token => {
      const params = new URLSearchParams({
        query,
        max_results: String(pageSize(input.maxResults)),
      })
      if (token) params.set('next_token', token)
      addCommonPostFields(params)
      return this.request('/2/tweets/search/recent', params, signal)
    })
  }

  async getThread(id: string, signal?: AbortSignal): Promise<XResult> {
    const root = await this.getPost(id, signal)
    const post = root.data as
      | { conversation_id?: unknown; id?: unknown }
      | undefined
    const conversationId =
      typeof post?.conversation_id === 'string'
        ? post.conversation_id
        : typeof post?.id === 'string'
          ? post.id
          : id
    const replies = await this.searchRecent(
      {
        query: `conversation_id:${conversationId}`,
        maxResults: 100,
        pages: 2,
      },
      signal,
    )
    const result: XResult = {
      app: this.app.alias,
      data: { root: root.data, posts: replies.data },
      includes: [root.includes, replies.includes].filter(Boolean),
      errors: [root.errors, replies.errors].filter(Boolean),
      meta: { conversation_id: conversationId, recent_search_only: true },
      rateLimit: replies.rateLimit,
      partial: true,
      partialReason: 'recent_search_window',
    }
    ensureOutputSize(result)
    return result
  }

  async getMentions(
    input: {
      userId?: string
      username?: string
      maxResults?: number
      pages?: number
    },
    signal?: AbortSignal,
  ): Promise<XResult> {
    const id = await this.userId(input.userId, input.username, signal)
    return this.paginated(input.pages, token => {
      const params = new URLSearchParams({
        max_results: String(pageSize(input.maxResults)),
      })
      if (token) params.set('pagination_token', token)
      addCommonPostFields(params)
      return this.request(
        `/2/users/${encodeURIComponent(id)}/mentions`,
        params,
        signal,
      )
    })
  }
}
