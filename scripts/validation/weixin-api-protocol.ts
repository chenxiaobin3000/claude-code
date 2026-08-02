import {
  buildClientVersion,
  buildHeaders,
  classifyFetchError,
  getUpdates,
  notifyStart,
  notifyStop,
  sendMessage,
} from '../../plugins/weixin/src/api.js'
import { resetSessionPause } from '../../plugins/weixin/src/session.js'
import { resolveNextLongPollTimeout } from '../../plugins/weixin/src/monitor.js'
import pluginPackage from '../../plugins/weixin/package.json'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[weixin-api-protocol] ${message}`)
}

assert(buildClientVersion('1.2.3') === 0x010203, 'client version encoding')
const headers = buildHeaders(' secret ')
assert(headers['iLink-App-Id'] === 'bot', 'iLink-App-Id header')
assert(
  headers['iLink-App-ClientVersion'] === String(buildClientVersion(pluginPackage.version)),
  'client version header',
)
assert(headers.Authorization === 'Bearer secret', 'trimmed authorization')
const decodedUin = Buffer.from(headers['X-WECHAT-UIN']!, 'base64').toString('utf8')
assert(/^\d+$/.test(decodedUin), 'X-WECHAT-UIN must encode a decimal uint32')

const dnsError = Object.assign(new Error('fetch failed'), {
  cause: Object.assign(new Error('lookup'), { code: 'ENOTFOUND' }),
})
assert(classifyFetchError(dnsError).type === 'dns', 'DNS classification')
assert(
  resolveNextLongPollTimeout(35_000, 12_345) === 12_345 &&
    resolveNextLongPollTimeout(12_345, 0) === 12_345,
  'dynamic long-poll timeout',
)

const originalFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit; body: any }> = []
let sendRet = 0
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  requests.push({ url, init, body })
  if (url.endsWith('/ilink/bot/getupdates')) {
    return Response.json({
      ret: 0,
      msgs: [],
      get_updates_buf: 'next',
      longpolling_timeout_ms: 12_345,
    })
  }
  if (url.endsWith('/ilink/bot/sendmessage')) {
    return Response.json({ ret: sendRet, errmsg: sendRet ? 'rejected' : '' })
  }
  return Response.json({ ret: 0 })
}) as typeof fetch

try {
  resetSessionPause()
  const updates = await getUpdates('https://example.test', 'token', 'cursor')
  assert(updates.longpolling_timeout_ms === 12_345, 'server poll timeout preserved')
  await sendMessage('https://example.test', 'token', {
    to_user_id: 'user',
    item_list: [],
  })
  sendRet = 7
  let rejected = false
  try {
    await sendMessage('https://example.test', 'token', {
      to_user_id: 'user',
      item_list: [],
    })
  } catch (error) {
    rejected = String(error).includes('ret=7')
  }
  assert(rejected, 'sendMessage business failure must throw')
  await notifyStart('https://example.test', 'token')
  await notifyStop('https://example.test', 'token')

  const first = requests[0]!
  assert(
    first.body.base_info.channel_version === pluginPackage.version,
    'dynamic channel version',
  )
  assert(
    first.body.base_info.bot_agent === `ClaudeCode/${pluginPackage.version}`,
    'bot agent',
  )
  assert(
    requests.some(request => request.url.endsWith('/ilink/bot/msg/notifystart')),
    'notifyStart endpoint',
  )
  assert(
    requests.some(request => request.url.endsWith('/ilink/bot/msg/notifystop')),
    'notifyStop endpoint',
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('[weixin-api-protocol] PASS')
