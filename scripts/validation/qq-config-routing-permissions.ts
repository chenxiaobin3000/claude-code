#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confirmQqPairing, createQqPairing, isQqUserAllowed } from '../../plugins/qq/src/access.js'
import { listQqBots, resolveQqBot, saveQqBot } from '../../plugins/qq/src/config.js'
import { rememberQqMessage } from '../../plugins/qq/src/dedupe.js'
import { acquireQqBotLease } from '../../plugins/qq/src/lease.js'
import { clearQqPermissionStateForTests, consumeQqPermission, parseQqPermissionReply, resolveQqActiveChat, saveQqPermission, setQqActiveChat } from '../../plugins/qq/src/permissions.js'
import { formatQqChatId, parseQqChatId } from '../../plugins/qq/src/routing.js'
import { assert, assertEqual } from './assertions.js'
const state = mkdtempSync(join(tmpdir(), 'qq-validation-'))
process.env.QQ_STATE_DIR = state
try {
  saveQqBot({ alias: 'alpha', appId: 'app-a', secretEnv: 'QQ_ALPHA_SECRET' }); saveQqBot({ alias: 'beta', appId: 'app-b', secretEnv: 'QQ_BETA_SECRET' })
  assertEqual(listQqBots().length, 2, 'two QQ bots')
  let ambiguous = false; try { resolveQqBot() } catch { ambiguous = true }; assert(ambiguous, 'implicit multi-bot resolution must fail')
  const chat = formatQqChatId('alpha', 'group', 'group-a'); assertEqual(parseQqChatId(chat)?.targetId, 'group-a', 'QQ group route')
  const code = createQqPairing('alpha', 'alice', () => 0.123456); assertEqual(confirmQqPairing('beta', code), null, 'pairing must not cross bots'); assertEqual(confirmQqPairing('alpha', code), 'alice', 'pairing owner'); assert(isQqUserAllowed('alpha', 'alice') && !isQqUserAllowed('beta', 'alice'), 'access isolation')
  assert(rememberQqMessage('alpha', 'm1', 1_000_000)); assert(!rememberQqMessage('alpha', 'm1', 1_000_001)); assert(rememberQqMessage('beta', 'm1', 1_000_001))
  const lease = acquireQqBotLease('alpha'); let duplicate = false; try { acquireQqBotLease('alpha') } catch { duplicate = true }; assert(duplicate, 'duplicate QQ Host must fail'); const other = acquireQqBotLease('beta'); other.release(); lease.release()
  clearQqPermissionStateForTests(); setQqActiveChat('alpha', chat, 'alice'); const target = resolveQqActiveChat(chat); assert(target); saveQqPermission({ request_id: 'abcde', tool_name: 'Bash', description: 'run', input_preview: 'pwd' }, target)
  assertEqual(consumeQqPermission('alpha', chat, 'mallory', 'abcde'), null, 'other member cannot approve'); assertEqual(consumeQqPermission('alpha', chat, 'alice', 'abcde')?.tool_name, 'Bash', 'owner approval'); assertEqual(parseQqPermissionReply('no abcde')?.behavior, 'deny', 'deny parser')
} finally { delete process.env.QQ_STATE_DIR; rmSync(state, { recursive: true, force: true }) }
console.log('[qq-config-routing-permissions] PASS')
