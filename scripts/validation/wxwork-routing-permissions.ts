#!/usr/bin/env bun

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confirmPairing, createPairing, isUserAllowed } from '../../plugins/wxwork/src/access.js'
import { listBots, resolveBot, saveBot } from '../../plugins/wxwork/src/config.js'
import { rememberWxworkMessage } from '../../plugins/wxwork/src/dedupe.js'
import { acquireWxworkBotLease } from '../../plugins/wxwork/src/lease.js'
import {
  clearPermissionStateForTests,
  consumePendingPermission,
  parsePermissionReply,
  resolveActivePermissionChat,
  savePendingPermission,
  setActivePermissionChat,
} from '../../plugins/wxwork/src/permissions.js'
import { formatWxworkChatId, parseWxworkChatId } from '../../plugins/wxwork/src/routing.js'
import { assert, assertEqual } from './assertions.js'

const state = mkdtempSync(join(tmpdir(), 'wxwork-validation-'))
process.env.WXWORK_STATE_DIR = state
try {
  saveBot({ alias: 'alpha', botId: 'bot-a', secretEnv: 'WXWORK_ALPHA_SECRET' })
  saveBot({ alias: 'beta', botId: 'bot-b', secretEnv: 'WXWORK_BETA_SECRET' })
  assertEqual(listBots().length, 2, 'two independent bots')
  let ambiguous = false
  try { resolveBot() } catch { ambiguous = true }
  assert(ambiguous, 'implicit routing must reject multiple bots')

  const chat = formatWxworkChatId('alpha', 'group', 'room-a')
  assertEqual(parseWxworkChatId(chat)?.botAlias, 'alpha', 'route includes bot alias')
  assertEqual(parseWxworkChatId(chat)?.targetId, 'room-a', 'route includes exact target')

  const code = createPairing('alpha', 'alice', () => 0.123456)
  assertEqual(confirmPairing('beta', code), null, 'pairing code must not cross bots')
  assertEqual(confirmPairing('alpha', code), 'alice', 'pairing succeeds in owning bot')
  assert(isUserAllowed('alpha', 'alice'), 'paired user must be allowed')
  assert(!isUserAllowed('beta', 'alice'), 'access state must not cross bots')
  assert(rememberWxworkMessage('alpha', 'msg-1', 1_000_000), 'first message must be accepted')
  assert(!rememberWxworkMessage('alpha', 'msg-1', 1_000_001), 'duplicate message must be rejected')
  assert(rememberWxworkMessage('beta', 'msg-1', 1_000_001), 'message IDs must be isolated by bot')

  const lease = acquireWxworkBotLease('alpha')
  let duplicateLease = false
  try { acquireWxworkBotLease('alpha') } catch { duplicateLease = true }
  assert(duplicateLease, 'a second Host connection for the same bot must be rejected')
  const otherLease = acquireWxworkBotLease('beta')
  otherLease.release()
  lease.release()

  clearPermissionStateForTests()
  setActivePermissionChat('alpha', chat, 'alice')
  const target = resolveActivePermissionChat(chat)
  assert(target, 'active permission target must resolve')
  savePendingPermission({ request_id: 'abcde', tool_name: 'Bash', description: 'run', input_preview: 'pwd' }, target)
  assertEqual(consumePendingPermission('alpha', chat, 'mallory', 'abcde'), null, 'another group member cannot approve')
  assertEqual(consumePendingPermission('beta', chat, 'alice', 'abcde'), null, 'another bot cannot approve')
  assertEqual(consumePendingPermission('alpha', chat, 'alice', 'abcde')?.tool_name, 'Bash', 'owning sender can approve')
  assertEqual(parsePermissionReply('yes abcde')?.behavior, 'allow', 'permission allow parser')
  assertEqual(parsePermissionReply('no abcde')?.behavior, 'deny', 'permission deny parser')
} finally {
  delete process.env.WXWORK_STATE_DIR
  rmSync(state, { recursive: true, force: true })
}

console.log('[wxwork-routing-permissions] PASS')
