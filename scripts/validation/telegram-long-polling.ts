#!/usr/bin/env bun
import { TelegramClient } from '../../plugins/telegram/src/client.js'
import { parseTelegramChatId } from '../../plugins/telegram/src/routing.js'
import { assert, assertEqual } from './assertions.js'

const token = '123456:abcdefghijklmnopqrstuvwxyz'
const secondToken = '234567:abcdefghijklmnopqrstuvwxyz'
const invalidToken = '999999:abcdefghijklmnopqrstuvwxyz'
let webhook = false
let conflict = false
const delivered = new Set<string>()
let sendAttempts = 0
let allowedUpdates: unknown = null
let deleteWebhookCalls = 0

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    const method = pathname.split('/').at(-1)
    const requestToken = pathname.match(/\/bot([^/]+)\//)?.[1] || ''
    let body: Record<string, unknown> = {}
    try { body = await request.json() as Record<string, unknown> } catch { /* No body. */ }
    if (method === 'getMe') {
      if (requestToken === invalidToken) return Response.json({ ok: false, error_code: 401, description: 'Unauthorized' })
      const second = requestToken === secondToken
      return Response.json({ ok: true, result: { id: second ? 199 : 99, is_bot: true, first_name: second ? 'Second' : 'Helper', username: second ? 'second_bot' : 'helper_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } })
    }
    if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: webhook ? 'https://example.test/hook' : '', has_custom_certificate: false, pending_update_count: 0 } })
    if (method === 'deleteWebhook') { deleteWebhookCalls++; return Response.json({ ok: true, result: true }) }
    if (method === 'getUpdates') {
      allowedUpdates = body.allowed_updates
      await Bun.sleep(5)
      if (conflict) return Response.json({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })
      if (!delivered.has(requestToken)) {
        delivered.add(requestToken)
        if (requestToken === secondToken) return Response.json({ ok: true, result: [{ update_id: 11, message: { message_id: 21, chat: { id: 200, type: 'private' }, from: { id: 8, is_bot: false, first_name: 'Second User' }, text: 'hello', date: 1 } }] })
        return Response.json({ ok: true, result: [{ update_id: 10, message: { message_id: 20, message_thread_id: 42, chat: { id: -100, type: 'supergroup' }, from: { id: 7, is_bot: false, first_name: 'User' }, text: '@helper_bot hello', entities: [{ type: 'mention', offset: 0, length: 11 }], date: 1 } }] })
      }
      return Response.json({ ok: true, result: [] })
    }
    if (method === 'sendMessage') {
      sendAttempts++
      if (sendAttempts === 1) return Response.json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0.001 } })
      return Response.json({ ok: true, result: { message_id: 30, date: 1, chat: { id: -100, type: 'supergroup' }, text: body.text } })
    }
    if (method === 'sendChatAction') return Response.json({ ok: true, result: true })
    return Response.json({ ok: false, error_code: 404, description: `Unknown ${method}` })
  },
})
process.env.TELEGRAM_API_ROOT = `http://127.0.0.1:${server.port}`
try {
  const webhookClient = new TelegramClient('webhook', token)
  webhook = true
  try { await webhookClient.doctor(); throw new Error('expected webhook conflict') } catch (error) { assert(error instanceof Error && error.message.includes('active Webhook'), 'doctor reports webhook conflict') }
  webhook = false

  const invalid = new TelegramClient('invalid', invalidToken)
  try { await invalid.doctor(); throw new Error('expected getMe failure') } catch (error) {
    assert(error instanceof Error && error.message.includes('401'), 'doctor reports getMe authentication failure')
    assert(!error.message.includes(invalidToken), 'getMe failure does not expose Token')
  }

  const client = new TelegramClient('alpha', token)
  const secondClient = new TelegramClient('second', secondToken)
  const doctor = await client.doctor()
  const secondDoctor = await secondClient.doctor()
  assertEqual(doctor.bot.username, 'helper_bot', 'Telegram getMe doctor')
  assertEqual(secondDoctor.bot.username, 'second_bot', 'second Telegram getMe doctor')
  const inbound = new Promise<Parameters<Parameters<typeof client.start>[0]>[0]>(resolve => {
    void client.start(async message => resolve(message), error => { throw error })
  })
  const secondInbound = new Promise<Parameters<Parameters<typeof secondClient.start>[0]>[0]>(resolve => {
    void secondClient.start(async message => resolve(message), error => { throw error })
  })
  const [message, secondMessage] = await Promise.race([
    Promise.all([inbound, secondInbound]),
    Bun.sleep(2000).then(() => { throw new Error('Telegram update timeout') }),
  ])
  assertEqual(message.updateId, 10, 'long polling update ID')
  assertEqual(message.topicId, 42, 'long polling topic')
  assertEqual(secondMessage.updateId, 11, 'second bot long polling update ID')
  assertEqual(secondMessage.chatId, '200', 'second bot chat isolation')
  assert(Array.isArray(allowedUpdates) && allowedUpdates.length === 1 && allowedUpdates[0] === 'message', 'allowed_updates is explicitly message-only')
  assertEqual(deleteWebhookCalls, 0, 'bot.start must not call remote deleteWebhook')
  const route = parseTelegramChatId('alpha::group::-100::topic::42')!
  await client.sendText(route, 'reply', 20)
  assertEqual(sendAttempts, 2, 'explicit 429 retried exactly once')
  await client.sendTyping(route)
  await Promise.all([client.stop(), secondClient.stop()])

  conflict = true
  const conflicting = new TelegramClient('beta', token)
  await conflicting.doctor()
  let conflictError = ''
  await conflicting.start(async () => undefined, error => { conflictError = error.message })
  for (let index = 0; index < 100 && !conflictError; index++) await Bun.sleep(10)
  assert(conflictError.includes('409'), 'getUpdates 409 is explicit')
  assert(!conflictError.includes(token), 'polling diagnostics redact Token')
  await conflicting.stop()
} finally {
  delete process.env.TELEGRAM_API_ROOT
  server.stop(true)
}
console.log('[telegram-long-polling] PASS')
