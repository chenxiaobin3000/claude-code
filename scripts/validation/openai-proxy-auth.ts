#!/usr/bin/env bun
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OpenAIProxyAuth,
  startBrowserLogin,
} from '../../plugins/openai-proxy/src/auth/oauth.js'
import {
  challengeForVerifier,
  generatePkce,
} from '../../plugins/openai-proxy/src/auth/pkce.js'
import { OpenAIProxySessionStore } from '../../plugins/openai-proxy/src/auth/session.js'
import type { AuthTransport } from '../../plugins/openai-proxy/src/auth/transport.js'
import { assert, assertEqual } from './assertions.js'

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.${Buffer.from('sig').toString('base64url')}`
}

const accountPayload = {
  exp: Math.floor(Date.now() / 1_000) + 3_600,
  email: 'fixture@example.test',
  'https://api.openai.com/auth': {
    chatgpt_plan_type: 'plus',
    chatgpt_user_id: 'user-fixture',
    chatgpt_account_id: 'workspace-fixture',
    chatgpt_account_is_fedramp: false,
  },
}
const idToken = jwt(accountPayload)
const accessToken = jwt({ exp: Math.floor(Date.now() / 1_000) + 3_600 })

async function fixtureStore(prefix: string): Promise<{
  directory: string
  store: OpenAIProxySessionStore
}> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  return {
    directory,
    store: new OpenAIProxySessionStore({
      directory,
      securePath: async () => undefined,
    }),
  }
}

const pkce = generatePkce()
assert(pkce.codeVerifier.length >= 43, 'PKCE verifier minimum length')
assertEqual(
  pkce.codeChallenge,
  challengeForVerifier(pkce.codeVerifier),
  'PKCE S256 challenge',
)

const securityDirectory = await mkdtemp(join(tmpdir(), 'openai-proxy-security-'))
try {
  const store = new OpenAIProxySessionStore({ directory: securityDirectory })
  await store.save({
    version: 1,
    authMode: 'chatgpt',
    tokens: {
      idToken,
      accessToken,
      refreshToken: 'refresh-security',
    },
    account: {
      email: 'fixture@example.test',
      isFedramp: false,
    },
    updatedAt: new Date(0).toISOString(),
  })
  assert((await store.load()) !== undefined, 'secured session round trip')
  if (process.platform !== 'win32') {
    assertEqual((await stat(store.path)).mode & 0o777, 0o600, 'POSIX auth mode')
  }
} finally {
  await rm(securityDirectory, { recursive: true, force: true })
}

const browserFixture = await fixtureStore('openai-proxy-browser-')
try {
  let exchangeCount = 0
  const transport: AuthTransport = async request => {
    assert(request.url.endsWith('/oauth/token'), 'browser token endpoint')
    const body = new URLSearchParams(request.body)
    assertEqual(body.get('grant_type'), 'authorization_code', 'browser grant')
    assertEqual(body.get('code'), 'fixture-code', 'browser authorization code')
    assert(
      body.get('redirect_uri')?.startsWith('http://localhost:') === true,
      'browser loopback redirect',
    )
    exchangeCount++
    return Response.json({
      id_token: idToken,
      access_token: accessToken,
      refresh_token: 'refresh-browser',
    })
  }
  const auth = new OpenAIProxyAuth({
    store: browserFixture.store,
    transport,
    issuer: 'https://auth.fixture.test',
  })
  const login = startBrowserLogin(auth, { ports: [0], timeoutMs: 10_000 })
  const authorize = new URL(login.authUrl)
  assertEqual(authorize.hostname, 'auth.fixture.test', 'authorize issuer')
  assertEqual(authorize.searchParams.get('response_type'), 'code', 'OAuth response type')
  assertEqual(authorize.searchParams.get('code_challenge_method'), 'S256', 'OAuth PKCE method')
  assert(authorize.searchParams.get('scope')?.includes('offline_access'), 'OAuth offline scope')
  const redirect = authorize.searchParams.get('redirect_uri')!
  const callbackAddress = redirect.replace('localhost', '127.0.0.1')
  const wrong = await fetch(
    `${callbackAddress}?code=fixture-code&state=wrong-state`,
  )
  assertEqual(wrong.status, 400, 'browser state mismatch')
  const suffixedState = `${authorize.searchParams.get('state')!}.onboarding_entrypoint=life_sciences`
  const callback = await fetch(
    `${callbackAddress}?code=fixture-code&state=${encodeURIComponent(suffixedState)}`,
  )
  assertEqual(callback.status, 200, 'browser callback success')
  const session = await login.completion
  assertEqual(exchangeCount, 1, 'single browser token exchange')
  assertEqual(session.account.planType, 'plus', 'plan claim')
  assertEqual(session.account.accountId, 'workspace-fixture', 'workspace claim')
  assertEqual((await browserFixture.store.load())?.tokens.refreshToken, 'refresh-browser', 'stored browser refresh token')
  const files = await readdir(browserFixture.directory)
  assertEqual(files.join(','), 'auth.json', 'atomic session leaves no temporary file')
} finally {
  await rm(browserFixture.directory, { recursive: true, force: true })
}

const deviceFixture = await fixtureStore('openai-proxy-device-')
try {
  const verifier = 'device-verifier-with-enough-entropy-for-the-fixture'
  let devicePolls = 0
  const transport: AuthTransport = async request => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/deviceauth/usercode')) {
      return Response.json({
        device_auth_id: 'device-auth-fixture',
        user_code: 'ABCD-1234',
        interval: '1',
      })
    }
    if (url.pathname.endsWith('/deviceauth/token')) {
      devicePolls++
      return Response.json({
        authorization_code: 'device-code-fixture',
        code_challenge: challengeForVerifier(verifier),
        code_verifier: verifier,
      })
    }
    if (url.pathname.endsWith('/oauth/token')) {
      const body = new URLSearchParams(request.body)
      assertEqual(body.get('code'), 'device-code-fixture', 'device authorization code')
      assertEqual(
        body.get('redirect_uri'),
        'https://auth.fixture.test/deviceauth/callback',
        'device redirect URI',
      )
      return Response.json({
        id_token: idToken,
        access_token: accessToken,
        refresh_token: 'refresh-device',
      })
    }
    return new Response('unexpected', { status: 500 })
  }
  const auth = new OpenAIProxyAuth({
    store: deviceFixture.store,
    transport,
    issuer: 'https://auth.fixture.test',
  })
  const device = await auth.requestDeviceCode()
  assertEqual(device.userCode, 'ABCD-1234', 'device user code')
  assertEqual(device.verificationUrl, 'https://auth.fixture.test/codex/device', 'device verification URL')
  const session = await auth.completeDeviceCode(device)
  assertEqual(devicePolls, 1, 'device polling count')
  assertEqual(session.tokens.refreshToken, 'refresh-device', 'device session')
} finally {
  await rm(deviceFixture.directory, { recursive: true, force: true })
}

const refreshFixture = await fixtureStore('openai-proxy-refresh-')
try {
  const expiredAccess = jwt({ exp: Math.floor(Date.now() / 1_000) - 60 })
  await refreshFixture.store.save({
    version: 1,
    authMode: 'chatgpt',
    tokens: {
      idToken,
      accessToken: expiredAccess,
      refreshToken: 'refresh-old',
      accessTokenExpiresAt: Date.now() - 60_000,
    },
    account: {
      email: 'fixture@example.test',
      planType: 'plus',
      accountId: 'workspace-fixture',
      userId: 'user-fixture',
      isFedramp: false,
    },
    updatedAt: new Date(0).toISOString(),
  })
  let refreshCount = 0
  let revokeCount = 0
  const transport: AuthTransport = async request => {
    if (request.url.endsWith('/oauth/revoke')) {
      revokeCount++
      return new Response(null, { status: 200 })
    }
    const body = new URLSearchParams(request.body)
    assertEqual(body.get('grant_type'), 'refresh_token', 'refresh grant')
    assertEqual(body.get('refresh_token'), 'refresh-old', 'refresh credential')
    refreshCount++
    return Response.json({
      access_token: accessToken,
      refresh_token: 'refresh-new',
    })
  }
  const auth = new OpenAIProxyAuth({
    store: refreshFixture.store,
    transport,
    issuer: 'https://auth.fixture.test',
  })
  const [first, second] = await Promise.all([
    auth.getValidSession(),
    auth.getValidSession(),
  ])
  assertEqual(refreshCount, 1, 'concurrent refresh is serialized')
  assertEqual(first.tokens.refreshToken, 'refresh-new', 'first refresh result')
  assertEqual(second.tokens.refreshToken, 'refresh-new', 'second refresh result')
  const logout = await auth.logout()
  assert(logout.removed, 'logout removes local session')
  assertEqual(logout.revokeFailures, 0, 'logout revocation result')
  assertEqual(revokeCount, 2, 'refresh and access token revocation')
  assertEqual(await refreshFixture.store.load(), undefined, 'session removed')
} finally {
  await rm(refreshFixture.directory, { recursive: true, force: true })
}

const invalidRefreshFixture = await fixtureStore('openai-proxy-invalid-refresh-')
try {
  const expired = jwt({ exp: Math.floor(Date.now() / 1_000) - 60 })
  await invalidRefreshFixture.store.save({
    version: 1,
    authMode: 'chatgpt',
    tokens: {
      idToken,
      accessToken: expired,
      refreshToken: 'invalid-refresh',
      accessTokenExpiresAt: Date.now() - 60_000,
    },
    account: { isFedramp: false },
    updatedAt: new Date(0).toISOString(),
  })
  const auth = new OpenAIProxyAuth({
    store: invalidRefreshFixture.store,
    issuer: 'https://auth.fixture.test',
    transport: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
  })
  let rejected = false
  try {
    await auth.getValidSession()
  } catch (error) {
    rejected =
      error instanceof Error && error.message.includes('rejected the request')
  }
  assert(rejected, 'invalid refresh fails explicitly')
  assertEqual(
    (await invalidRefreshFixture.store.load())?.tokens.refreshToken,
    'invalid-refresh',
    'failed refresh does not corrupt the stored session',
  )
} finally {
  await rm(invalidRefreshFixture.directory, { recursive: true, force: true })
}

console.log('[openai-proxy-auth] PASS')
