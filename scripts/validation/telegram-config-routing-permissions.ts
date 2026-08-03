#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confirmTelegramPairing, createTelegramPairing, isTelegramUserAllowed } from '../../plugins/telegram/src/access.js'
import { listTelegramBots, resolveTelegramToken, saveTelegramBot } from '../../plugins/telegram/src/config.js'
import { rememberTelegramUpdate } from '../../plugins/telegram/src/dedupe.js'
import { acquireTelegramBotLease } from '../../plugins/telegram/src/lease.js'
import { clearTelegramPermissionStateForTests, consumeTelegramPermission, parseTelegramPermissionReply, resolveTelegramActiveChat, saveTelegramPermission, setTelegramActiveChat } from '../../plugins/telegram/src/permissions.js'
import { formatTelegramChatId, parseTelegramChatId } from '../../plugins/telegram/src/routing.js'
import { assert, assertEqual } from './assertions.js'

function assertThrows(operation: () => unknown, includes: string): void {
  try { operation() } catch (error) {
    assert(error instanceof Error && error.message.includes(includes), `expected error containing ${includes}`)
    return
  }
  throw new Error(`expected error containing ${includes}`)
}

const state = mkdtempSync(join(tmpdir(), 'telegram-config-'))
process.env.TELEGRAM_STATE_DIR = state
process.env.TELEGRAM_ALPHA_TOKEN = '123456:abcdefghijklmnopqrstuvwxyz'
process.env.TELEGRAM_BETA_TOKEN = '234567:abcdefghijklmnopqrstuvwxyz'
try {
  saveTelegramBot({ alias: 'alpha', tokenEnv: 'TELEGRAM_ALPHA_TOKEN' })
  saveTelegramBot({ alias: 'beta', tokenEnv: 'TELEGRAM_BETA_TOKEN' })
  assertEqual(listTelegramBots().length, 2, 'two Telegram bots')
  assertEqual(resolveTelegramToken(listTelegramBots()[0]!), process.env.TELEGRAM_ALPHA_TOKEN, 'token env resolution')
  assertThrows(() => saveTelegramBot({ alias: 'duplicate', tokenEnv: 'TELEGRAM_ALPHA_TOKEN' }), 'already configured')
  const privateId = formatTelegramChatId('alpha', 'private', '100')
  const topicId = formatTelegramChatId('beta', 'group', '-200', 42)
  assertEqual(parseTelegramChatId(privateId)?.scope, 'private', 'private route')
  assertEqual(parseTelegramChatId(topicId)?.topicId, 42, 'topic route')
  assert(!parseTelegramChatId('alpha::group::-200::topic::bad'), 'invalid topic rejected')
  assert(rememberTelegramUpdate('alpha', 1, 1000), 'first update accepted')
  assert(!rememberTelegramUpdate('alpha', 1, 1001), 'duplicate update rejected')
  assert(rememberTelegramUpdate('beta', 1, 1001), 'update isolated by bot')
  const code = createTelegramPairing('alpha', 'user-a', () => 0)
  assert(!isTelegramUserAllowed('alpha', 'user-a'), 'pairing required by default')
  assertEqual(confirmTelegramPairing('alpha', code), 'user-a', 'pairing confirmation')
  assert(isTelegramUserAllowed('alpha', 'user-a') && !isTelegramUserAllowed('beta', 'user-a'), 'access isolated by bot')
  clearTelegramPermissionStateForTests()
  setTelegramActiveChat('alpha', privateId, 'user-a')
  assertEqual(resolveTelegramActiveChat()?.chatId, privateId, 'single active Telegram target')
  const request = { request_id: 'abcde', tool_name: 'Bash', description: 'run', input_preview: 'echo ok' }
  saveTelegramPermission(request, { botAlias: 'alpha', chatId: privateId, senderId: 'user-a', updatedAt: Date.now() })
  assertEqual(parseTelegramPermissionReply('yes abcde')?.behavior, 'allow', 'permission allow parsing')
  assert(!consumeTelegramPermission('beta', privateId, 'user-a', 'abcde'), 'cross-bot approval rejected')
  assert(!consumeTelegramPermission('alpha', privateId, 'user-b', 'abcde'), 'cross-user approval rejected')
  assertEqual(consumeTelegramPermission('alpha', privateId, 'user-a', 'abcde')?.tool_name, 'Bash', 'scoped approval consumed')
  const lease = acquireTelegramBotLease('alpha')
  assertThrows(() => acquireTelegramBotLease('alpha'), 'active Host connection')
  const other = acquireTelegramBotLease('beta'); other.release(); lease.release()
} finally {
  delete process.env.TELEGRAM_STATE_DIR; delete process.env.TELEGRAM_ALPHA_TOKEN; delete process.env.TELEGRAM_BETA_TOKEN
  rmSync(state, { recursive: true, force: true })
}
console.log('[telegram-config-routing-permissions] PASS')
