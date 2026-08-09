import { timingSafeEqual } from 'node:crypto'
import {
  OPENAI_AUTH_ISSUER,
  OPENAI_AUTH_SCOPES,
  OPENAI_BROWSER_LOGIN_PORTS,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_DEVICE_LOGIN_TIMEOUT_MS,
  OPENAI_TOKEN_REFRESH_WINDOW_MS,
} from './constants.js'
import {
  parseJwtExpiration,
  parseOpenAIAccountClaims,
} from './jwt.js'
import {
  challengeForVerifier,
  generateOAuthState,
  generatePkce,
} from './pkce.js'
import {
  OpenAIProxySessionStore,
  type OpenAIProxySession,
} from './session.js'
import {
  authRequest,
  type AuthTransport,
  createConfiguredAuthTransport,
  readBoundedJson,
} from './transport.js'

interface OAuthTokenResponse {
  id_token?: string
  access_token?: string
  refresh_token?: string
}

interface DeviceUserCodeResponse {
  device_auth_id?: string
  user_code?: string
  usercode?: string
  interval?: string | number
}

interface DeviceTokenResponse {
  authorization_code?: string
  code_challenge?: string
  code_verifier?: string
}

export interface OpenAIAuthOptions {
  store?: OpenAIProxySessionStore
  transport?: AuthTransport
  issuer?: string
  clientId?: string
  now?: () => number
}

export class OpenAIProxyAuth {
  readonly store: OpenAIProxySessionStore
  private readonly transport: AuthTransport
  private readonly issuer: string
  private readonly clientId: string
  private readonly now: () => number

  constructor(options: OpenAIAuthOptions = {}) {
    this.store = options.store ?? new OpenAIProxySessionStore()
    this.transport = options.transport ?? createConfiguredAuthTransport()
    this.issuer = (options.issuer ?? OPENAI_AUTH_ISSUER).replace(/\/$/, '')
    this.clientId = options.clientId ?? OPENAI_CODEX_CLIENT_ID
    this.now = options.now ?? Date.now
  }

  buildAuthorizeUrl(
    redirectUri: string,
    pkce: { codeChallenge: string },
    state: string,
  ): string {
    const url = new URL(`${this.issuer}/oauth/authorize`)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: OPENAI_AUTH_SCOPES,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: 'codex_cli_rs',
    }).toString()
    return url.toString()
  }

  private async tokenRequest(body: URLSearchParams): Promise<OAuthTokenResponse> {
    const response = await authRequest(this.transport, {
      url: `${this.issuer}/oauth/token`,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!response.ok) {
      throw new Error(`OpenAI token endpoint rejected the request (${response.status}).`)
    }
    return readBoundedJson<OAuthTokenResponse>(response, 'OpenAI token endpoint')
  }

  private sessionFromTokens(
    tokens: OAuthTokenResponse,
    previous?: OpenAIProxySession,
  ): OpenAIProxySession {
    const idToken = tokens.id_token ?? previous?.tokens.idToken
    const accessToken = tokens.access_token ?? previous?.tokens.accessToken
    const refreshToken = tokens.refresh_token ?? previous?.tokens.refreshToken
    if (!idToken || !accessToken || !refreshToken) {
      throw new Error('OpenAI token response omitted required credentials.')
    }
    return {
      version: 1,
      authMode: 'chatgpt',
      tokens: {
        idToken,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: parseJwtExpiration(accessToken),
      },
      account: parseOpenAIAccountClaims(idToken),
      updatedAt: new Date(this.now()).toISOString(),
    }
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<OpenAIProxySession> {
    const tokens = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        code_verifier: codeVerifier,
      }),
    )
    const session = this.sessionFromTokens(tokens)
    await this.store.withLock(() => this.store.save(session))
    return session
  }

  async getValidSession(): Promise<OpenAIProxySession> {
    return this.store.withLock(async () => {
      const current = await this.store.load()
      if (!current) throw new Error('openai-proxy is not logged in.')
      const expiresAt =
        current.tokens.accessTokenExpiresAt ??
        parseJwtExpiration(current.tokens.accessToken)
      if (
        expiresAt !== undefined &&
        expiresAt - this.now() > OPENAI_TOKEN_REFRESH_WINDOW_MS
      ) {
        return current
      }
      return this.refreshSession(current)
    })
  }

  private async refreshSession(
    current: OpenAIProxySession,
  ): Promise<OpenAIProxySession> {
    const tokens = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: current.tokens.refreshToken,
        client_id: this.clientId,
      }),
    )
    const refreshed = this.sessionFromTokens(tokens, current)
    await this.store.save(refreshed)
    return refreshed
  }

  async forceRefreshSession(): Promise<OpenAIProxySession> {
    return this.store.withLock(async () => {
      const current = await this.store.load()
      if (!current) throw new Error('openai-proxy is not logged in.')
      return this.refreshSession(current)
    })
  }

  async logout(): Promise<{ removed: boolean; revokeFailures: number }> {
    return this.store.withLock(async () => {
      const current = await this.store.load()
      let revokeFailures = 0
      if (current) {
        for (const [token, tokenTypeHint] of [
          [current.tokens.refreshToken, 'refresh_token'],
          [current.tokens.accessToken, 'access_token'],
        ] as const) {
          try {
            const response = await authRequest(this.transport, {
              url: `${this.issuer}/oauth/revoke`,
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                token,
                token_type_hint: tokenTypeHint,
                client_id: this.clientId,
              }),
            })
            if (!response.ok) revokeFailures++
          } catch {
            revokeFailures++
          }
        }
      }
      return { removed: await this.store.delete(), revokeFailures }
    })
  }

  async requestDeviceCode(): Promise<{
    verificationUrl: string
    userCode: string
    deviceAuthId: string
    intervalMs: number
  }> {
    const response = await authRequest(this.transport, {
      url: `${this.issuer}/api/accounts/deviceauth/usercode`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId }),
    })
    if (response.status === 404) {
      throw new Error('Device-code login is not enabled for this OpenAI account.')
    }
    if (!response.ok) {
      throw new Error(`OpenAI device-code request failed (${response.status}).`)
    }
    const body = await readBoundedJson<DeviceUserCodeResponse>(
      response,
      'OpenAI device-code endpoint',
    )
    const userCode = body.user_code ?? body.usercode
    const interval = Number(body.interval ?? 5)
    if (!body.device_auth_id || !userCode || !Number.isFinite(interval)) {
      throw new Error('OpenAI device-code response was incomplete.')
    }
    return {
      verificationUrl: `${this.issuer}/codex/device`,
      userCode,
      deviceAuthId: body.device_auth_id,
      intervalMs: Math.max(1, interval) * 1_000,
    }
  }

  async completeDeviceCode(
    device: Awaited<ReturnType<OpenAIProxyAuth['requestDeviceCode']>>,
    options: { sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
  ): Promise<OpenAIProxySession> {
    const sleep = options.sleep ?? Bun.sleep
    const deadline = this.now() + (options.timeoutMs ?? OPENAI_DEVICE_LOGIN_TIMEOUT_MS)
    let codeResponse: DeviceTokenResponse | undefined
    while (this.now() < deadline) {
      const response = await authRequest(this.transport, {
        url: `${this.issuer}/api/accounts/deviceauth/token`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          device_auth_id: device.deviceAuthId,
          user_code: device.userCode,
        }),
      })
      if (response.ok) {
        codeResponse = await readBoundedJson<DeviceTokenResponse>(
          response,
          'OpenAI device token endpoint',
        )
        break
      }
      if (response.status !== 403 && response.status !== 404) {
        throw new Error(`OpenAI device login failed (${response.status}).`)
      }
      await sleep(Math.min(device.intervalMs, Math.max(0, deadline - this.now())))
    }
    if (!codeResponse) throw new Error('OpenAI device login timed out after 15 minutes.')
    const { authorization_code, code_challenge, code_verifier } = codeResponse
    if (!authorization_code || !code_challenge || !code_verifier) {
      throw new Error('OpenAI device token response was incomplete.')
    }
    const expected = Buffer.from(challengeForVerifier(code_verifier), 'utf8')
    const supplied = Buffer.from(code_challenge, 'utf8')
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new Error('OpenAI device token PKCE verification failed.')
    }
    return this.exchangeAuthorizationCode(
      authorization_code,
      `${this.issuer}/deviceauth/callback`,
      code_verifier,
    )
  }
}

export interface BrowserLoginHandle {
  authUrl: string
  port: number
  completion: Promise<OpenAIProxySession>
  cancel(): void
}

function stateMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false
  const suffix = '.onboarding_entrypoint=life_sciences'
  const normalized = actual.endsWith(suffix) ? actual.slice(0, -suffix.length) : actual
  const actualBytes = Buffer.from(normalized, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}

function loginHtml(message: string): Response {
  const escaped = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>openai-proxy</title><p>${escaped}</p>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', connection: 'close' } },
  )
}

function bindCallbackServer(
  ports: readonly number[],
  fetchHandler: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  let lastError: unknown
  for (const port of ports) {
    try {
      return Bun.serve({ hostname: '127.0.0.1', port, fetch: fetchHandler })
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `Unable to bind the OpenAI login callback server: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

export function startBrowserLogin(
  auth: OpenAIProxyAuth,
  options: { ports?: readonly number[]; timeoutMs?: number } = {},
): BrowserLoginHandle {
  const pkce = generatePkce()
  const state = generateOAuthState()
  let resolveCompletion!: (session: OpenAIProxySession) => void
  let rejectCompletion!: (error: Error) => void
  let settled = false
  const completion = new Promise<OpenAIProxySession>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  let redirectUri = ''
  const server = bindCallbackServer(
    options.ports ?? OPENAI_BROWSER_LOGIN_PORTS,
    async request => {
      const url = new URL(request.url)
      if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
        return new Response('Not Found', { status: 404 })
      }
      if (!stateMatches(url.searchParams.get('state'), state)) {
        return new Response('State mismatch', { status: 400 })
      }
      const error = url.searchParams.get('error')
      if (error) {
        const failure = new Error(`OpenAI login was rejected: ${error}.`)
        settled = true
        rejectCompletion(failure)
        queueMicrotask(() => server.stop(false))
        return loginHtml(failure.message)
      }
      const code = url.searchParams.get('code')
      if (!code) return new Response('Missing authorization code', { status: 400 })
      try {
        const session = await auth.exchangeAuthorizationCode(
          code,
          redirectUri,
          pkce.codeVerifier,
        )
        settled = true
        resolveCompletion(session)
        queueMicrotask(() => server.stop(false))
        return loginHtml('Sign-in completed. You can close this window.')
      } catch (exchangeError) {
        const failure =
          exchangeError instanceof Error
            ? exchangeError
            : new Error(String(exchangeError))
        settled = true
        rejectCompletion(failure)
        queueMicrotask(() => server.stop(false))
        return loginHtml('Sign-in could not be completed. Return to the terminal.')
      }
    },
  )
  const port = server.port
  if (port === undefined) {
    server.stop(true)
    throw new Error('Unable to determine the OpenAI login callback port.')
  }
  redirectUri = `http://localhost:${port}/auth/callback`
  const timeout = setTimeout(() => {
    if (settled) return
    settled = true
    server.stop(true)
    rejectCompletion(new Error('OpenAI browser login timed out.'))
  }, options.timeoutMs ?? OPENAI_DEVICE_LOGIN_TIMEOUT_MS)
  void completion.finally(() => clearTimeout(timeout)).catch(() => undefined)
  return {
    authUrl: auth.buildAuthorizeUrl(redirectUri, pkce, state),
    port,
    completion,
    cancel() {
      if (settled) return
      settled = true
      server.stop(true)
      rejectCompletion(new Error('OpenAI browser login was cancelled.'))
    },
  }
}

export async function openSystemBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'win32'
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url]
  const child = Bun.spawn(command, {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true,
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error('Unable to open the system browser.')
}
