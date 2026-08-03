#!/usr/bin/env bun

import {
  createFinalReplyBody,
  createMediaReplyBody,
  createPingFrame,
  createSubscribeFrame,
  normalizeWxworkMessage,
  parseWxworkFrame,
} from '../../plugins/wxwork/src/protocol.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

assertDeepEqual(createSubscribeFrame('bot-a', 'secret-a', 'req-auth'), {
  cmd: 'aibot_subscribe',
  headers: { req_id: 'req-auth' },
  body: { bot_id: 'bot-a', secret: 'secret-a' },
}, 'subscribe frame')
assertEqual(createPingFrame('req-ping').cmd, 'ping', 'heartbeat command')
assertEqual(parseWxworkFrame('{"headers":{"req_id":"one"}}').headers.req_id, 'one', 'frame parser')

const single = normalizeWxworkMessage({
  msgid: 'msg-1', aibotid: 'bot-a', chattype: 'single', msgtype: 'text',
  from: { userid: 'user-a' }, text: { content: 'hello' },
})
assertDeepEqual(single, {
  messageId: 'msg-1', botId: 'bot-a', chatType: 'single', targetId: 'user-a',
  senderId: 'user-a', text: 'hello', media: [],
}, 'single-chat normalization')

const group = normalizeWxworkMessage({
  msgid: 'msg-2', aibotid: 'bot-b', chattype: 'group', chatid: 'room-9', msgtype: 'mixed',
  from: { userid: 'user-b' },
  mixed: { msg_item: [
    { msgtype: 'text', text: { content: 'inspect' } },
    { msgtype: 'image', image: { url: 'https://example.invalid/image', aeskey: Buffer.alloc(32).toString('base64') } },
  ] },
})
assertEqual(group.targetId, 'room-9', 'group route target')
assertEqual(group.media.length, 1, 'mixed image extraction')
assertDeepEqual(createMediaReplyBody('image', 'media-1'), { msgtype: 'image', image: { media_id: 'media-1' } }, 'media response')
assertDeepEqual(createFinalReplyBody('stream-1', 'done'), { msgtype: 'stream', stream: { id: 'stream-1', finish: true, content: 'done' } }, 'final response')
let rejected = false
try { createFinalReplyBody('stream-2', '界'.repeat(7_000)) } catch { rejected = true }
assert(rejected, 'reply byte limit must be enforced')

console.log('[wxwork-protocol] PASS')
