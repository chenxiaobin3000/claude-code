#!/usr/bin/env bun
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QqGateway, type QqSocket } from '../../plugins/qq/src/gateway.js'
import { assert, assertEqual } from './assertions.js'
class Socket extends EventEmitter implements QqSocket {
  readyState = 0; sent: string[] = []; terminated = false
  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = 3 }
  terminate(): void { this.terminated = true; this.readyState = 3; this.emit('close', 1006, Buffer.from('terminated')) }
  open(): void { this.readyState = 1; this.emit('open') }
  message(value: unknown): void { this.emit('message', JSON.stringify(value)) }
}
const state = mkdtempSync(join(tmpdir(), 'qq-gateway-'))
process.env.QQ_STATE_DIR = state
try {
  const sockets: Socket[] = []; const messages: string[] = []
  const api = { getToken: async () => 'access', getGatewayUrl: async () => 'wss://gateway.example.test', clearToken: () => {} }
  const gateway = new QqGateway({ alias: 'alpha', api, reconnectBaseMs: 1, reconnectMaxMs: 1, random: () => 0, socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket }, onMessage: message => { messages.push(message.messageId) } })
  gateway.start(); await Bun.sleep(5); const first = sockets[0]!; first.open(); first.message({ op: 10, d: { heartbeat_interval: 100 } })
  assertEqual((JSON.parse(first.sent[0]!) as { op: number }).op, 2, 'first connection identifies')
  first.message({ op: 0, s: 7, t: 'READY', d: { session_id: 'session-a' } }); await gateway.waitUntilReady(100)
  first.message({ op: 0, s: 8, t: 'C2C_MESSAGE_CREATE', d: { id: 'message-a', content: 'hello', timestamp: 'now', author: { user_openid: 'user-a' } } }); await Bun.sleep(1); assertEqual(messages[0], 'message-a', 'C2C dispatch')
  first.message({ op: 11 }); await Bun.sleep(110); assert(first.sent.some(frame => (JSON.parse(frame) as { op: number }).op === 1), 'heartbeat sent')
  first.terminate(); await Bun.sleep(10); const second = sockets.at(-1)!; assert(second !== first, 'network close reconnects'); second.open(); second.message({ op: 10, d: { heartbeat_interval: 100 } })
  assertEqual((JSON.parse(second.sent[0]!) as { op: number }).op, 6, 'saved session resumes')
  second.message({ op: 0, s: 9, t: 'RESUMED', d: {} }); await gateway.waitUntilReady(100)
  const before = messages.length; first.message({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'stale', author: { user_openid: 'x' } } }); assertEqual(messages.length, before, 'stale generation ignored')
  gateway.stop()
} finally { delete process.env.QQ_STATE_DIR; rmSync(state, { recursive: true, force: true }) }
console.log('[qq-gateway] PASS')
