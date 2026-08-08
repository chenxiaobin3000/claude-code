#!/usr/bin/env bun
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { TelegramClient } from '../../plugins/telegram/src/client.js'
import {
  createTelegramTransport,
  redactTelegramTransportSecret,
} from '../../plugins/telegram/src/transport.js'
import { assert, assertEqual } from './assertions.js'

function assertThrows(operation: () => unknown, includes: string): void {
  try {
    operation()
  } catch (error) {
    assert(error instanceof Error && error.message.includes(includes), `expected error containing ${includes}`)
    return
  }
  throw new Error(`expected error containing ${includes}`)
}

const token = '123456:fixture_token_that_is_long_enough'
const originalNoProxy = process.env.NO_PROXY
const originalNoProxyLower = process.env.no_proxy
let apiRequests = 0
let fileRequests = 0
let proxyConnections = 0
let proxyAuthentications = 0

const api = createHttpServer((request, response) => {
  apiRequests++
  response.setHeader('content-type', 'application/json')
  response.setHeader('connection', 'close')
  const method = request.url?.split('/').at(-1)
  if (request.url?.includes(`/file/bot${token}/documents/fixture.txt`)) {
    fileRequests++
    response.setHeader('content-type', 'text/plain')
    response.end('fixture-media')
    return
  }
  if (method === 'getMe') {
    response.end(JSON.stringify({ ok: true, result: { id: 99, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' } }))
    return
  }
  if (method === 'getWebhookInfo') {
    response.end(JSON.stringify({ ok: true, result: { url: '', has_custom_certificate: false, pending_update_count: 0 } }))
    return
  }
  if (method === 'sendMessage') {
    response.end(JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, text: 'ok' } }))
    return
  }
  if (method === 'getFile') {
    response.end(JSON.stringify({ ok: true, result: { file_id: 'fixture', file_unique_id: 'fixture', file_path: 'documents/fixture.txt' } }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ ok: false, error_code: 404, description: 'not found' }))
})
await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
const apiAddress = api.address()
if (!apiAddress || typeof apiAddress === 'string') throw new Error('Telegram API fixture failed')

const proxy = createHttpServer((request, response) => {
  proxyConnections++
  if (request.headers['proxy-authorization'] !== 'Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzcw==') {
    response.writeHead(407, { 'proxy-authenticate': 'Basic realm="fixture"' })
    response.end()
    return
  }
  proxyAuthentications++
  const target = new URL(request.url ?? '')
  const upstream = httpRequest(target, { method: request.method, headers: request.headers }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', error => response.destroy(error))
  request.pipe(upstream)
})
proxy.on('connect', (request, downstream, head) => {
  proxyConnections++
  if (request.headers['proxy-authorization'] !== 'Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzcw==') {
    downstream.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\n\r\n')
    downstream.destroy()
    return
  }
  proxyAuthentications++
  const [host, rawPort] = (request.url ?? '').split(':')
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
if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('Telegram proxy fixture failed')

try {
  const baseUrl = `http://127.0.0.1:${apiAddress.port}`
  assertEqual(createTelegramTransport().proxyMode, 'direct', 'direct mode')
  assertThrows(() => createTelegramTransport('socks5://127.0.0.1:1080'), 'not supported')
  assert(!redactTelegramTransportSecret('https://user:pass@example.test:8443').includes('pass'), 'proxy password redacted')
  assert(!redactTelegramTransportSecret('https://example.test:8443?token=secret').includes('secret'), 'proxy query redacted')

  const direct = new TelegramClient('direct', token, { apiRoot: baseUrl, proxyUrl: '' })
  assertEqual((await direct.doctor()).bot.username, 'fixture_bot', 'direct doctor')

  process.env.NO_PROXY = ''
  process.env.no_proxy = ''
  const proxied = new TelegramClient('proxied', token, {
    apiRoot: baseUrl,
    proxyUrl: `http://fixture-user:fixture-pass@127.0.0.1:${proxyAddress.port}`,
  })
  assertEqual(proxied.proxyMode, 'http-connect', 'HTTP proxy mode')
  await proxied.doctor()
  await proxied.sendText({ chatId: '1' }, 'hello')
  await proxied.getFile('fixture')
  const response = await proxied.transportFetch(`${baseUrl}/file/bot${token}/documents/fixture.txt`)
  assertEqual(await response.text(), 'fixture-media', 'file body')
  assert(proxyConnections >= 5, 'doctor, send, getFile, and file download used proxy')
  assertEqual(proxyAuthentications, proxyConnections, 'HTTP proxy authentication used')
  assertEqual(fileRequests, 1, 'file endpoint reached once')

  const requestsBeforeFailure = apiRequests
  let failed = false
  try {
    await new TelegramClient('failed', token, { apiRoot: baseUrl, proxyUrl: 'http://127.0.0.1:1' }).doctor()
  } catch {
    failed = true
  }
  assert(failed, 'unavailable explicit proxy fails')
  assertEqual(apiRequests, requestsBeforeFailure, 'proxy failure never falls back to direct API access')

  const requestsBeforeAuthFailure = apiRequests
  let authenticationFailed = false
  try {
    await new TelegramClient('auth-failed', token, {
      apiRoot: baseUrl,
      proxyUrl: `http://fixture-user:wrong@127.0.0.1:${proxyAddress.port}`,
    }).doctor()
  } catch {
    authenticationFailed = true
  }
  assert(authenticationFailed, 'proxy authentication rejection fails')
  assertEqual(apiRequests, requestsBeforeAuthFailure, 'proxy authentication failure never reaches API directly')

  const requestsBeforeCancellation = apiRequests
  const cancelled = new AbortController()
  cancelled.abort()
  let cancellationFailed = false
  try {
    await proxied.transportFetch(`${baseUrl}/cancelled`, { signal: cancelled.signal })
  } catch {
    cancellationFailed = true
  }
  assert(cancellationFailed, 'cancelled proxy request fails')
  assertEqual(apiRequests, requestsBeforeCancellation, 'cancelled request never reaches API')

  const hangingProxy = createHttpServer(() => undefined)
  await new Promise<void>(resolve => hangingProxy.listen(0, '127.0.0.1', resolve))
  const hangingAddress = hangingProxy.address()
  if (!hangingAddress || typeof hangingAddress === 'string') throw new Error('hanging proxy fixture failed')
  let timedOut = false
  try {
    await createTelegramTransport(`http://127.0.0.1:${hangingAddress.port}`).fetch(baseUrl, { signal: AbortSignal.timeout(50) })
  } catch {
    timedOut = true
  } finally {
    hangingProxy.closeAllConnections()
    await new Promise<void>(resolve => hangingProxy.close(() => resolve()))
  }
  assert(timedOut, 'proxy timeout fails')
  assertEqual(apiRequests, requestsBeforeCancellation, 'timed out proxy request never reaches API directly')
} finally {
  api.closeAllConnections()
  proxy.closeAllConnections()
  await Promise.all([
    new Promise<void>(resolve => api.close(() => resolve())),
    new Promise<void>(resolve => proxy.close(() => resolve())),
  ])
  if (originalNoProxy === undefined) delete process.env.NO_PROXY
  else process.env.NO_PROXY = originalNoProxy
  if (originalNoProxyLower === undefined) delete process.env.no_proxy
  else process.env.no_proxy = originalNoProxyLower
}
console.log('[telegram-proxy] PASS')
