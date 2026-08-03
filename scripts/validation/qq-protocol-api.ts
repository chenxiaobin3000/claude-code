#!/usr/bin/env bun
import { QqApiClient, QqApiError } from '../../plugins/qq/src/api.js'
import { deterministicMsgSeq, heartbeatPayload, identifyPayload, normalizeQqDispatch, resumePayload, splitQqText } from '../../plugins/qq/src/protocol.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'
assertEqual((identifyPayload('token').d as { token: string }).token, 'QQBot token', 'identify token prefix')
assertEqual((identifyPayload('token').d as { intents: number }).intents, 1 << 25, 'C2C/group-only intent')
assertEqual(resumePayload('token', 'session', 9).op, 6, 'resume opcode'); assertDeepEqual(heartbeatPayload(9), { op: 1, d: 9 }, 'heartbeat')
const group = normalizeQqDispatch('alpha', 'GROUP_AT_MESSAGE_CREATE', { id: 'm1', content: 'hello', timestamp: 'now', group_openid: 'g1', author: { member_openid: 'u1', username: 'Alice' }, attachments: [{ content_type: 'image/png', url: 'https://gchat.qpic.cn/a.png' }] })
assertEqual(group?.targetId, 'g1', 'group target'); assertEqual(group?.attachments.length, 1, 'attachment mapping')
assertEqual(normalizeQqDispatch('alpha', 'GROUP_MESSAGE_CREATE', {},), null, 'non-mention group messages excluded')
assertEqual(deterministicMsgSeq('m1', 0), deterministicMsgSeq('m1', 0), 'stable msg_seq'); assert(deterministicMsgSeq('m1', 0) !== deterministicMsgSeq('m1', 1), 'part msg_seq differs')
assert(splitQqText('界'.repeat(1000), 1000).length > 1, 'UTF-8 text splitting')
const calls: Array<{ url: string; init?: RequestInit }> = []
let apiFailure = false
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input); calls.push({ url, init })
  if (url.includes('getAppAccessToken')) return new Response(JSON.stringify({ access_token: 'access-secret', expires_in: 7200 }), { status: 200 })
  if (url.endsWith('/gateway')) return new Response(JSON.stringify({ url: 'wss://gateway.example.test' }), { status: 200 })
  if (apiFailure) return new Response(JSON.stringify({ code: 112, message: 'limited' }), { status: 429, headers: { 'retry-after': '3' } })
  return new Response(JSON.stringify({ id: 'sent', timestamp: 1 }), { status: 200 })
}
const api = new QqApiClient({ alias: 'alpha', appId: 'app-a', secretEnv: 'QQ_SECRET', savedAt: '' }, 'app-secret', fakeFetch, 'https://api.example.test', 'https://token.example.test')
assertEqual(await api.getToken(), 'access-secret', 'access token'); assertEqual(await api.getGatewayUrl(), 'wss://gateway.example.test', 'gateway URL')
await api.sendText('c2c', 'user-a', 'message-a', 'hello', 0)
assert(calls.some(call => call.url.endsWith('/v2/users/user-a/messages')), 'C2C REST route')
const body = JSON.parse(String(calls.at(-1)?.init?.body)) as { msg_id: string; msg_seq: number }; assertEqual(body.msg_id, 'message-a', 'reply binding'); assertEqual(body.msg_seq, deterministicMsgSeq('message-a', 0), 'deterministic REST sequence')
apiFailure = true; let error: unknown; try { await api.sendText('group', 'g1', 'm2', 'x', 0) } catch (caught) { error = caught }
assert(error instanceof QqApiError && error.httpStatus === 429 && error.retryAfterMs === 3000, '429 structured error without unsafe replay')
assert(!JSON.stringify(calls.slice(1)).includes('app-secret'), 'AppSecret must only appear in token request')
console.log('[qq-protocol-api] PASS')
