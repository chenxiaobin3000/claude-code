import {
  normalizeRedirectBaseUrl,
  startLogin,
  waitForLogin,
} from '../../plugins/weixin/src/login.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[weixin-login-state] ${message}`)
}

assert(
  normalizeRedirectBaseUrl('idc.example.test') === 'https://idc.example.test',
  'valid IDC redirect',
)
assert(normalizeRedirectBaseUrl('evil.test/path') === null, 'redirect path rejected')

const originalFetch = globalThis.fetch
const requests: Array<{ url: string; body?: any }> = []
const statuses = [
  { status: 'need_verifycode' },
  { status: 'scaned_but_redirect', redirect_host: 'idc.example.test' },
  {
    status: 'confirmed',
    bot_token: 'token',
    ilink_bot_id: 'bot-id',
    baseurl: 'https://api.example.test',
    ilink_user_id: 'user-id',
  },
]

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  requests.push({ url, body })
  if (url.includes('get_bot_qrcode')) {
    return Response.json({ qrcode: 'qr-1', qrcode_img_content: '' })
  }
  return Response.json(statuses.shift() ?? { status: 'wait' })
}) as typeof fetch

try {
  const qr = await startLogin('https://ilink.example.test', ['old-token'])
  assert(qr.qrcodeId === 'qr-1', 'QR id')
  const result = await waitForLogin({
    qrcodeId: qr.qrcodeId,
    apiBaseUrl: 'https://ilink.example.test',
    pollDelayMs: 0,
    readVerifyCode: async () => '2468',
  })
  assert(result.connected && result.token === 'token', 'confirmed result')
  assert(
    requests[0]?.body?.local_token_list?.[0] === 'old-token',
    'local token list sent',
  )
  assert(
    requests.some(request => request.url.includes('verify_code=2468')),
    'verification code sent',
  )
  assert(
    requests.some(request => request.url.startsWith('https://idc.example.test/')),
    'IDC redirect applied',
  )

  globalThis.fetch = (async () =>
    Response.json({ status: 'binded_redirect' })) as typeof fetch
  const already = await waitForLogin({
    qrcodeId: 'qr-2',
    apiBaseUrl: 'https://ilink.example.test',
    pollDelayMs: 0,
  })
  assert(already.alreadyConnected, 'already-bound login is successful state')
} finally {
  globalThis.fetch = originalFetch
}

console.log('[weixin-login-state] PASS')
