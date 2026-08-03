#!/usr/bin/env bun

import { EventEmitter } from 'node:events'
import { WxworkClient, type WxworkSocket } from '../../plugins/wxwork/src/client.js'
import { assert, assertEqual } from './assertions.js'

class FakeSocket extends EventEmitter implements WxworkSocket {
  readyState = 0
  sent: string[] = []
  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = 3 }
  terminate(): void { this.readyState = 3; this.emit('close', 1006, Buffer.from('terminated')) }
  open(): void { this.readyState = 1; this.emit('open') }
  message(frame: unknown): void { this.emit('message', JSON.stringify(frame)) }
}

const sockets: FakeSocket[] = []
let authenticated = 0
let kickedFrames = 0
const client = new WxworkClient({
  botId: 'bot-a', secret: 'secret-a', wsUrl: 'wss://example.invalid',
  heartbeatMs: 20, reconnectBaseMs: 1, reconnectMaxMs: 1, random: () => 0,
  socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
  callbacks: { onAuthenticated: () => authenticated++, onFrame: () => { kickedFrames++ } },
})
client.connect()
const first = sockets[0]!
first.open()
const subscribe = JSON.parse(first.sent[0]!) as { cmd: string; headers: { req_id: string }; body: { bot_id: string; secret: string } }
assertEqual(subscribe.cmd, 'aibot_subscribe', 'subscribe command')
assertEqual(subscribe.body.secret, 'secret-a', 'subscribe secret')
first.message({ headers: { req_id: subscribe.headers.req_id }, errcode: 0 })
await client.waitForAuthentication(100)
assertEqual(authenticated, 1, 'authentication callback')

first.message({
  cmd: 'aibot_event_callback', headers: { req_id: 'event-kick' },
  body: { event: { eventtype: 'disconnected_event' } },
})
await Bun.sleep(10)
assertEqual(kickedFrames, 1, 'kick event callback')
assertEqual(sockets.length, 1, 'kick event must disable reconnect')
client.disconnect()

const parallelSockets: FakeSocket[] = []
const parallelClients = ['bot-alpha', 'bot-beta'].map(botId => new WxworkClient({
  botId,
  secret: `${botId}-secret`,
  wsUrl: 'wss://example.invalid',
  socketFactory: () => { const socket = new FakeSocket(); parallelSockets.push(socket); return socket },
}))
for (const parallel of parallelClients) parallel.connect()
for (const socket of parallelSockets) socket.open()
for (const socket of parallelSockets) {
  const frame = JSON.parse(socket.sent[0]!) as { headers: { req_id: string } }
  socket.message({ headers: { req_id: frame.headers.req_id }, errcode: 0 })
}
await Promise.all(parallelClients.map(parallel => parallel.waitForAuthentication(100)))
assert(parallelClients.every(parallel => parallel.isAuthenticated()), 'two distinct bots must authenticate independently')
for (const parallel of parallelClients) parallel.disconnect()

let diagnostic = ''
const secretSocket = new FakeSocket()
const secretClient = new WxworkClient({
  botId: 'bot-secret', secret: 'never-log-this', wsUrl: 'wss://example.invalid',
  maxAuthFailures: 1,
  socketFactory: () => secretSocket,
  callbacks: { onError: error => { diagnostic = error.message } },
})
secretClient.connect()
secretSocket.open()
const secretSubscribe = JSON.parse(secretSocket.sent[0]!) as { headers: { req_id: string } }
secretSocket.message({ headers: { req_id: secretSubscribe.headers.req_id }, errcode: 40001, errmsg: 'bad never-log-this' })
assert(!diagnostic.includes('never-log-this'), 'authentication diagnostics must redact the configured secret')
secretClient.disconnect()

const staleSockets: FakeSocket[] = []
const reconnecting = new WxworkClient({
  botId: 'bot-b', secret: 'secret-b', wsUrl: 'wss://example.invalid',
  reconnectBaseMs: 1, reconnectMaxMs: 1, random: () => 0,
  socketFactory: () => { const socket = new FakeSocket(); staleSockets.push(socket); return socket },
})
reconnecting.connect()
const stale = staleSockets[0]!
stale.open()
stale.emit('close', 1006, Buffer.from('network'))
await Bun.sleep(10)
assert(staleSockets.length >= 2, 'network close must reconnect')
const replacement = staleSockets.at(-1)!
replacement.open()
const sentBefore = replacement.sent.length
stale.message({ cmd: 'aibot_msg_callback', headers: { req_id: 'stale' }, body: {} })
assertEqual(replacement.sent.length, sentBefore, 'stale socket frames must be isolated')
reconnecting.disconnect()

console.log('[wxwork-connection] PASS')
