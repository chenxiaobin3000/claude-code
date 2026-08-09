#!/usr/bin/env bun

import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OPENAI_PROXY_URL_ENV,
  resolveOpenAIProxyUrl,
} from '../../plugins/openai-proxy/src/config.js'
import { OpenAIProxyAuth } from '../../plugins/openai-proxy/src/auth/oauth.js'
import { OpenAIProxySessionStore } from '../../plugins/openai-proxy/src/auth/session.js'
import { OpenAIProxyModelService } from '../../plugins/openai-proxy/src/model/service.js'
import {
  createOpenAIUpstreamFetch,
  redactOpenAIProxySecret,
  validateOpenAIProxyUrl,
} from '../../plugins/openai-proxy/src/upstreamProxy.js'
import { assert, assertEqual } from './assertions.js'

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

function assertThrows(operation: () => unknown, includes: string): void {
  try {
    operation()
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(includes),
      `expected error containing ${includes}`,
    )
    return
  }
  throw new Error(`expected error containing ${includes}`)
}

const idToken = jwt({
  exp: Math.floor(Date.now() / 1_000) + 3_600,
  email: 'proxy-fixture@example.test',
  'https://api.openai.com/auth': {
    chatgpt_plan_type: 'plus',
    chatgpt_account_id: 'proxy-workspace',
    chatgpt_account_is_fedramp: false,
  },
})
const accessToken = jwt({ exp: Math.floor(Date.now() / 1_000) + 3_600 })
const originalProxy = process.env[OPENAI_PROXY_URL_ENV]
const originalHttpProxy = process.env.HTTP_PROXY
const originalHttpsProxy = process.env.HTTPS_PROXY
const originalNoProxy = process.env.NO_PROXY
const originalNoProxyLower = process.env.no_proxy
const stateDirectory = await mkdtemp(join(tmpdir(), 'openai-proxy-upstream-'))
let apiRequests = 0
let proxyRequests = 0
let proxyAuthentications = 0
const connectTargets: string[] = []

const api = createHttpServer((request, response) => {
  apiRequests++
  assert(
    request.headers['proxy-authorization'] === undefined,
    'proxy credentials are not forwarded to OpenAI upstream',
  )
  response.setHeader('connection', 'close')
  if (request.url === '/oauth/token') {
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        id_token: idToken,
        access_token: accessToken,
        refresh_token: 'refresh-through-proxy',
      }),
    )
    return
  }
  if (request.url === '/oauth/revoke') {
    response.statusCode = 200
    response.end()
    return
  }
  if (request.url === '/api/accounts/deviceauth/usercode') {
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        device_auth_id: 'proxy-device',
        user_code: 'PROXY-CODE',
        interval: 1,
      }),
    )
    return
  }
  if (request.url?.startsWith('/models')) {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ models: [{ slug: 'gpt-proxy-fixture' }] }))
    return
  }
  if (request.url === '/responses') {
    response.setHeader('content-type', 'text/event-stream')
    response.end(
      [
        { type: 'response.created', response: { id: 'resp_proxy', model: 'gpt-proxy-fixture' } },
        { type: 'response.output_text.delta', delta: 'proxied' },
        {
          type: 'response.completed',
          response: {
            id: 'resp_proxy',
            model: 'gpt-proxy-fixture',
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ]
        .map(event => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    )
    return
  }
  response.statusCode = 404
  response.end()
})
await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
const apiAddress = api.address()
if (!apiAddress || typeof apiAddress === 'string') throw new Error('API fixture failed')

const expectedProxyAuthorization =
  'Basic ' + Buffer.from('fixture-user:fixture-pass').toString('base64')
const proxy = createHttpServer((request, response) => {
  proxyRequests++
  if (request.headers['proxy-authorization'] !== expectedProxyAuthorization) {
    response.writeHead(407, { 'proxy-authenticate': 'Basic realm="fixture"' })
    response.end()
    return
  }
  proxyAuthentications++
  const target = new URL(request.url ?? '')
  delete request.headers['proxy-authorization']
  const upstream = httpRequest(
    target,
    { method: request.method, headers: request.headers },
    upstreamResponse => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      )
      upstreamResponse.pipe(response)
    },
  )
  upstream.on('error', error => response.destroy(error))
  request.pipe(upstream)
})
proxy.on('connect', (request, downstream, head) => {
  proxyRequests++
  connectTargets.push(request.url ?? '')
  if (request.headers['proxy-authorization'] !== expectedProxyAuthorization) {
    downstream.write(
      'HTTP/1.1 407 Proxy Authentication Required\r\n' +
        'Proxy-Authenticate: Basic realm="fixture"\r\n\r\n',
    )
    downstream.destroy()
    return
  }
  proxyAuthentications++
  const [host, rawPort] = (request.url ?? '').split(':')
  if (host === 'unresolvable.invalid') {
    downstream.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    downstream.destroy()
    return
  }
  const upstream = connect(Number(rawPort), host, () => {
    downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    upstream.pipe(downstream)
    downstream.pipe(upstream)
  })
  upstream.on('error', () => downstream.destroy())
})
await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
const proxyAddress = proxy.address()
if (!proxyAddress || typeof proxyAddress === 'string') {
  throw new Error('Proxy fixture failed')
}

try {
  const baseUrl = `http://127.0.0.1:${apiAddress.port}`
  const proxyUrl = `http://fixture-user:fixture-pass@127.0.0.1:${proxyAddress.port}`
  assertEqual(
    resolveOpenAIProxyUrl({}, () => ' http://settings-proxy.test:8080 '),
    'http://settings-proxy.test:8080',
    'settings.json env fallback',
  )
  assertEqual(
    resolveOpenAIProxyUrl({ OPENAI_PROXY_URL: ' http://process-proxy.test:8081 ' }, () => 'http://settings-proxy.test'),
    'http://process-proxy.test:8081',
    'process env wins over settings.json env',
  )
  assertThrows(
    () =>
      resolveOpenAIProxyUrl({}, () => {
        throw new Error('malformed settings')
      }),
    'Cannot resolve',
  )
  assertThrows(() => validateOpenAIProxyUrl('socks5://127.0.0.1:1080'), 'SOCKS5')
  assertThrows(() => validateOpenAIProxyUrl('ftp://127.0.0.1'), 'Unsupported')
  assertThrows(() => validateOpenAIProxyUrl('http://127.0.0.1/path'), 'path')
  assert(
    !redactOpenAIProxySecret(proxyUrl).includes('fixture-pass'),
    'proxy password is redacted',
  )

  process.env.HTTP_PROXY = 'http://127.0.0.1:1'
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1'
  delete process.env[OPENAI_PROXY_URL_ENV]
  const beforeDirect = proxyRequests
  const direct = await createOpenAIUpstreamFetch().fetch(`${baseUrl}/models`)
  assertEqual(direct.status, 200, 'generic proxy variables are ignored')
  await direct.text()
  assertEqual(proxyRequests, beforeDirect, 'direct mode does not use generic proxy env')
  if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY
  else process.env.HTTP_PROXY = originalHttpProxy
  if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY
  else process.env.HTTPS_PROXY = originalHttpsProxy

  process.env[OPENAI_PROXY_URL_ENV] = proxyUrl
  process.env.NO_PROXY = '*'
  process.env.no_proxy = '*'
  const proxyProbe = await createOpenAIUpstreamFetch().fetch(
    `${baseUrl}/models`,
  )
  const proxyProbeText = await proxyProbe.text()
  assert(
    proxyProbeText.startsWith('{'),
    'explicit proxy returns the complete upstream response body',
  )
  const auth = new OpenAIProxyAuth({
    issuer: baseUrl,
    store: new OpenAIProxySessionStore({
      directory: stateDirectory,
      securePath: async () => undefined,
    }),
  })
  const session = await auth.exchangeAuthorizationCode(
    'fixture-code',
    'http://localhost:1455/auth/callback',
    'fixture-verifier',
  )
  assertEqual(session.account.accountId, 'proxy-workspace', 'OAuth token exchange through proxy')
  assertEqual(
    (await auth.requestDeviceCode()).deviceAuthId,
    'proxy-device',
    'device-code request through proxy',
  )
  await auth.forceRefreshSession()

  const model = new OpenAIProxyModelService({
    baseUrl,
    auth: {
      getValidSession: async () => session,
      forceRefreshSession: async () => session,
    },
  })
  const models = await model.models(new AbortController().signal)
  assertEqual(models.status, 200, 'model catalog through proxy')
  const completion = await model.chatCompletions(
    new Request('http://127.0.0.1/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-proxy-fixture',
        messages: [{ role: 'user', content: 'proxy fixture' }],
        stream: true,
      }),
    }),
  )
  assert((await completion.text()).includes('proxied'), 'Responses SSE through proxy')
  assert(
    proxyRequests >= 3,
    `OAuth, models and Responses all use proxy (requests=${proxyRequests})`,
  )
  assertEqual(proxyAuthentications, proxyRequests, 'proxy authentication used')

  const beforeProxyAuthFailure = apiRequests
  process.env[OPENAI_PROXY_URL_ENV] =
    `http://fixture-user:wrong@127.0.0.1:${proxyAddress.port}`
  let proxyAuthenticationFailed = false
  try {
    const rejected = await createOpenAIUpstreamFetch().fetch(`${baseUrl}/models`)
    proxyAuthenticationFailed = rejected.status === 407
    await rejected.body?.cancel().catch(() => undefined)
  } catch (error) {
    proxyAuthenticationFailed =
      error instanceof Error && !error.message.includes('wrong')
  }
  assert(proxyAuthenticationFailed, 'proxy authentication rejection fails')
  assertEqual(
    apiRequests,
    beforeProxyAuthFailure,
    'proxy authentication failure never reaches upstream',
  )

  const apiBeforeFailure = apiRequests
  process.env[OPENAI_PROXY_URL_ENV] = 'http://127.0.0.1:1'
  let failedClosed = false
  try {
    await createOpenAIUpstreamFetch().fetch(`${baseUrl}/models`)
  } catch (error) {
    failedClosed =
      error instanceof Error &&
      error.message.includes('configured proxy') &&
      !error.message.includes('127.0.0.1:1')
  }
  assert(failedClosed, 'unavailable explicit proxy fails with sanitized error')
  assertEqual(apiRequests, apiBeforeFailure, 'proxy failure never falls back to direct')

  const hangingProxy = createHttpServer(() => undefined)
  await new Promise<void>(resolve =>
    hangingProxy.listen(0, '127.0.0.1', resolve),
  )
  const hangingAddress = hangingProxy.address()
  if (!hangingAddress || typeof hangingAddress === 'string') {
    throw new Error('Hanging proxy fixture failed')
  }
  process.env[OPENAI_PROXY_URL_ENV] =
    `http://127.0.0.1:${hangingAddress.port}`
  let timedOut = false
  try {
    await createOpenAIUpstreamFetch().fetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(50),
    })
  } catch {
    timedOut = true
  } finally {
    hangingProxy.closeAllConnections()
    await new Promise<void>(resolve => hangingProxy.close(() => resolve()))
  }
  assert(timedOut, 'proxy timeout fails closed')
  assertEqual(apiRequests, apiBeforeFailure, 'proxy timeout never reaches upstream')

  process.env[OPENAI_PROXY_URL_ENV] = proxyUrl
  let connectFailed = false
  try {
    const rejected = await createOpenAIUpstreamFetch().fetch(
      'https://unresolvable.invalid/probe',
      { signal: AbortSignal.timeout(1_000) },
    )
    connectFailed = !rejected.ok
    await rejected.body?.cancel().catch(() => undefined)
  } catch {
    connectFailed = true
  }
  assert(connectFailed, 'rejected HTTPS CONNECT fails closed')
  assert(
    connectTargets.includes('unresolvable.invalid:443'),
    'HTTPS target hostname is delegated to the proxy without local DNS fallback',
  )
  await auth.logout()
} finally {
  api.closeAllConnections()
  proxy.closeAllConnections()
  await Promise.all([
    new Promise<void>(resolve => api.close(() => resolve())),
    new Promise<void>(resolve => proxy.close(() => resolve())),
  ])
  if (originalProxy === undefined) delete process.env[OPENAI_PROXY_URL_ENV]
  else process.env[OPENAI_PROXY_URL_ENV] = originalProxy
  if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY
  else process.env.HTTP_PROXY = originalHttpProxy
  if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY
  else process.env.HTTPS_PROXY = originalHttpsProxy
  if (originalNoProxy === undefined) delete process.env.NO_PROXY
  else process.env.NO_PROXY = originalNoProxy
  if (originalNoProxyLower === undefined) delete process.env.no_proxy
  else process.env.no_proxy = originalNoProxyLower
  await rm(stateDirectory, { recursive: true, force: true })
}

process.stdout.write('openai-proxy upstream proxy validation passed\n')
