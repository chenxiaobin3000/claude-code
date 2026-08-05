#!/usr/bin/env bun
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { XReadOnlyClient } from '../../plugins/x/src/client.js'
import { saveXApp } from '../../plugins/x/src/config.js'
import { assert, assertEqual } from './assertions.js'

const state = mkdtempSync(join(tmpdir(), 'x-api-fixture-'))
const originalNoProxy = process.env.NO_PROXY
const originalNoProxyLower = process.env.no_proxy
process.env.X_STATE_DIR = state
process.env.X_BEARER_TOKEN = 'fixture-token'

let apiRequests = 0
let proxyConnections = 0
const api = createHttpServer((request, response) => {
  apiRequests++
  if (!request.url?.includes('/transport-probe'))
    assertEqual(
      request.headers.authorization,
      'Bearer fixture-token',
      'Bearer header',
    )
  response.setHeader('content-type', 'application/json')
  response.setHeader('connection', 'close')
  response.setHeader('x-rate-limit-limit', '450')
  response.setHeader('x-rate-limit-remaining', '449')
  response.setHeader('x-rate-limit-reset', '2000000000')
  if (request.url?.includes('/2/users/by/username/')) {
    response.end(JSON.stringify({ data: { id: '42', username: 'fixture' } }))
    return
  }
  if (request.url?.includes('/2/users/42/tweets')) {
    response.end(
      JSON.stringify({ data: [{ id: '2', text: 'post' }], meta: {} }),
    )
    return
  }
  if (request.url?.includes('/2/users/42/mentions')) {
    response.end(
      JSON.stringify({ data: [{ id: '3', text: 'mention' }], meta: {} }),
    )
    return
  }
  if (request.url?.includes('/2/tweets/search/recent')) {
    response.end(
      JSON.stringify({ data: [{ id: '4', text: 'search' }], meta: {} }),
    )
    return
  }
  if (request.url?.includes('/2/tweets/')) {
    response.end(
      JSON.stringify({
        data: { id: '1', text: 'root', conversation_id: '1' },
      }),
    )
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ message: 'not found' }))
})
await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
const apiAddress = api.address()
if (!apiAddress || typeof apiAddress === 'string')
  throw new Error('API fixture failed')

const proxy = createHttpServer((request, response) => {
  proxyConnections++
  const target = new URL(request.url ?? '')
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
  proxyConnections++
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
if (!proxyAddress || typeof proxyAddress === 'string')
  throw new Error('Proxy fixture failed')

try {
  const app = saveXApp('primary')
  const baseUrl = `http://127.0.0.1:${apiAddress.port}`
  const direct = new XReadOnlyClient(app, { baseUrl, proxyUrl: '' })
  assertEqual(
    (await direct.getPost('1')).rateLimit.remaining,
    449,
    'rate limit',
  )
  assertEqual(
    (await direct.getUser({ username: 'fixture' })).app,
    'primary',
    'user',
  )
  await direct.getUserPosts({ username: 'fixture', maxResults: 5 })
  await direct.getMentions({ userId: '42', maxResults: 5 })
  await direct.searchRecent({ query: 'fixture', maxResults: 10 })
  const thread = await direct.getThread('1')
  assert(thread.partial, 'thread must disclose partial recent-search coverage')

  process.env.NO_PROXY = ''
  process.env.no_proxy = ''
  const throughHttpProxy = new XReadOnlyClient(app, {
    baseUrl,
    proxyUrl: `http://127.0.0.1:${proxyAddress.port}`,
  })
  assertEqual(throughHttpProxy.proxyMode, 'http-connect', 'HTTP proxy mode')
  await throughHttpProxy.getPost('1')
  assert(proxyConnections > 0, 'HTTP proxy transport used')

  const requestsBeforeFailure = apiRequests
  let proxyFailure = false
  try {
    await new XReadOnlyClient(app, {
      baseUrl,
      proxyUrl: 'http://127.0.0.1:1',
    }).getPost('1')
  } catch {
    proxyFailure = true
  }
  assert(proxyFailure, 'unavailable explicit proxy fails')
  assertEqual(
    apiRequests,
    requestsBeforeFailure,
    'proxy failure never falls back to direct API access',
  )

  assert(apiRequests >= 9, 'direct and proxy API requests reached fixture')
} finally {
  api.closeAllConnections()
  proxy.closeAllConnections()
  await Promise.all([
    new Promise<void>(resolve => api.close(() => resolve())),
    new Promise<void>(resolve => proxy.close(() => resolve())),
  ])
  for (const name of ['X_STATE_DIR', 'X_BEARER_TOKEN']) delete process.env[name]
  if (originalNoProxy === undefined) delete process.env.NO_PROXY
  else process.env.NO_PROXY = originalNoProxy
  if (originalNoProxyLower === undefined) delete process.env.no_proxy
  else process.env.no_proxy = originalNoProxyLower
  rmSync(state, { recursive: true, force: true })
}
console.log('[x-api-fixture] PASS')
