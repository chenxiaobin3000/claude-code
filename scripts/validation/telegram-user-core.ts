#!/usr/bin/env bun
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTelegramUserRouteAllowed, loadTelegramUserAccess, setTelegramUserRouteAllowed } from '../../plugins/telegram-user/src/access.js'
import { classifyTelegramUserError, createGramJsClient, loginTelegramUserAccount, selectTelegramUserGroups, type TelegramUserLoginTransport } from '../../plugins/telegram-user/src/client.js'
import { listTelegramUserAccounts, loadTelegramUserSession, resolveTelegramUserCredentials, saveTelegramUserAccount, saveTelegramUserSession } from '../../plugins/telegram-user/src/config.js'
import { rememberTelegramUserSentMessage, rememberTelegramUserUpdate } from '../../plugins/telegram-user/src/dedupe.js'
import { acquireTelegramUserLease } from '../../plugins/telegram-user/src/lease.js'
import { validateTelegramUserOutboundFile } from '../../plugins/telegram-user/src/media.js'
import { clearTelegramUserPermissionStateForTests, consumeTelegramUserPermission, parseTelegramUserPermissionReply, resolveTelegramUserActiveChat, saveTelegramUserPermission, setTelegramUserActiveChat } from '../../plugins/telegram-user/src/permissions.js'
import { redactTelegramUserError, splitTelegramUserText } from '../../plugins/telegram-user/src/protocol.js'
import { formatTelegramUserChatId, parseTelegramUserChatId } from '../../plugins/telegram-user/src/routing.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

function assertThrows(operation: () => unknown, includes: string): void { try { operation() } catch (error) { assert(error instanceof Error && error.message.includes(includes), `expected error containing ${includes}`); return }; throw new Error(`expected error containing ${includes}`) }
const state = mkdtempSync(join(tmpdir(), 'telegram-user-core-')); const allowed = mkdtempSync(join(tmpdir(), 'telegram-user-files-'))
process.env.TELEGRAM_USER_STATE_DIR = state; process.env.TELEGRAM_USER_ALLOWED_FILE_ROOTS = allowed
process.env.TU_ALPHA_ID = '12345'; process.env.TU_ALPHA_HASH = '0123456789abcdef0123456789abcdef'; process.env.TU_ALPHA_PHONE = '+15551234567'
process.env.TU_BETA_ID = '23456'; process.env.TU_BETA_HASH = 'fedcba9876543210fedcba9876543210'; process.env.TU_BETA_PHONE = '+15557654321'
try {
  const alpha = saveTelegramUserAccount({ alias: 'alpha', apiIdEnv: 'TU_ALPHA_ID', apiHashEnv: 'TU_ALPHA_HASH', phoneEnv: 'TU_ALPHA_PHONE' }); const beta = saveTelegramUserAccount({ alias: 'beta', apiIdEnv: 'TU_BETA_ID', apiHashEnv: 'TU_BETA_HASH', phoneEnv: 'TU_BETA_PHONE' })
  assertEqual(listTelegramUserAccounts().length, 2, 'two user accounts'); assertEqual(resolveTelegramUserCredentials(alpha).apiId, 12345, 'API ID env resolution')
  const gramClient = createGramJsClient(resolveTelegramUserCredentials(alpha), ''); assertEqual((gramClient as unknown as { _requestRetries: number })._requestRetries, 3, 'GramJS allows login data-center migration and a transient reconnect')
  assertDeepEqual(selectTelegramUserGroups([
    { id: { toString: () => '-10' }, title: 'Basic\tGroup', isGroup: true, isChannel: false },
    { id: { toString: () => '-10020' }, title: 'Super\nGroup', isGroup: true, isChannel: true },
    { id: { toString: () => '-10030' }, name: 'News', isGroup: false, isChannel: true },
    { id: { toString: () => '40' }, name: 'Person', isGroup: false, isChannel: false },
  ]), [
    { type: 'group', id: '-10', name: 'Basic Group' },
    { type: 'supergroup', id: '-10020', name: 'Super Group' },
    { type: 'channel', id: '-10030', name: 'News' },
  ], 'group dialog classification and safe tabular names')
  saveTelegramUserSession('alpha', 'alpha-session'); saveTelegramUserSession('beta', 'beta-session'); assertEqual(loadTelegramUserSession('alpha'), 'alpha-session', 'alpha session isolated'); assertEqual(loadTelegramUserSession('beta'), 'beta-session', 'beta session isolated')
  if (process.platform !== 'win32') assertEqual(statSync(join(state, 'accounts', 'alpha', 'session.txt')).mode & 0o777, 0o600, 'private session mode')
  let observedSession = ''; let observedCode = ''; let observedPassword = ''
  const factory = (_credentials: unknown, session: string): TelegramUserLoginTransport => { observedSession = session; return { session: { save: () => 'new-alpha-session' }, async start(params) { observedCode = await params.phoneCode(true); observedPassword = await params.password('fixture hint') }, async getMe() { return { id: { toString: () => '9001' }, username: 'fixture_user' } }, async disconnect() {} } }
  const login = await loginTelegramUserAccount(alpha, resolveTelegramUserCredentials(alpha), { code: async () => '654321', password: async () => 'not-persisted-password' }, factory)
  assertEqual(observedSession, 'alpha-session', 'StringSession restore'); assertEqual(login.userId, '9001', 'login identity'); assertEqual(loadTelegramUserSession('alpha'), 'new-alpha-session', 'StringSession save'); assertEqual(observedCode, '654321', 'code callback'); assertEqual(observedPassword, 'not-persisted-password', '2FA callback')
  const persisted = readFileSync(join(state, 'accounts', 'alpha', 'session.txt'), 'utf8') + readFileSync(join(state, 'accounts', 'alpha', 'identity.json'), 'utf8')
  assert(!persisted.includes('654321') && !persisted.includes('not-persisted-password') && !persisted.includes(process.env.TU_ALPHA_PHONE!), 'ephemeral login secrets not persisted')
  const privateRoute = parseTelegramUserChatId(formatTelegramUserChatId('alpha', 'user', '100'))!; const topicRoute = parseTelegramUserChatId(formatTelegramUserChatId('alpha', 'group', '-200', 42))!
  assertEqual(topicRoute.topicId, 42, 'topic route'); assert(!parseTelegramUserChatId('alpha::group::-200::topic::bad'), 'invalid topic rejected')
  assert(!isTelegramUserRouteAllowed('alpha', privateRoute, '100'), 'default deny'); setTelegramUserRouteAllowed('alpha', { peerType: 'user', peerId: '100', allowSenders: ['100'] }, true); assert(isTelegramUserRouteAllowed('alpha', privateRoute, '100'), 'exact Peer/sender allowed'); assert(!isTelegramUserRouteAllowed('alpha', privateRoute, '101'), 'sender isolation'); assert(!isTelegramUserRouteAllowed('beta', { ...privateRoute, accountAlias: 'beta' }, '100'), 'account access isolation')
  setTelegramUserRouteAllowed('alpha', { peerType: 'group', peerId: '-200', topicId: 42 }, true); assert(isTelegramUserRouteAllowed('alpha', topicRoute, '300'), 'topic allowed'); assert(!isTelegramUserRouteAllowed('alpha', { ...topicRoute, topicId: 43 }, '300'), 'topic isolation'); assertEqual(loadTelegramUserAccess('alpha').allowPeers.length, 2, 'allowlist persisted')
  assert(rememberTelegramUserUpdate('alpha', '100:1:0', 1000), 'first update accepted'); assert(!rememberTelegramUserUpdate('alpha', '100:1:0', 1001), 'duplicate update rejected'); assert(rememberTelegramUserUpdate('beta', '100:1:0', 1001), 'update isolated by account'); rememberTelegramUserSentMessage('alpha', '100', 2, 1002); assert(!rememberTelegramUserUpdate('alpha', '100:2', 1003), 'plugin reply echo suppressed')
  clearTelegramUserPermissionStateForTests(); const chatId = formatTelegramUserChatId('alpha', 'user', '100'); setTelegramUserActiveChat('alpha', chatId, '100'); assertEqual(resolveTelegramUserActiveChat()?.accountAlias, 'alpha', 'single active target')
  const request = { request_id: 'abcde', tool_name: 'Bash', description: 'run', input_preview: 'echo ok' }; saveTelegramUserPermission(request, { accountAlias: 'alpha', chatId, senderId: '100', updatedAt: Date.now() }); assertEqual(parseTelegramUserPermissionReply('yes abcde')?.behavior, 'allow', 'permission parsing'); assert(!consumeTelegramUserPermission('beta', chatId, '100', 'abcde'), 'cross-account permission rejected'); assert(!consumeTelegramUserPermission('alpha', chatId, '101', 'abcde'), 'cross-sender permission rejected'); assertEqual(consumeTelegramUserPermission('alpha', chatId, '100', 'abcde')?.tool_name, 'Bash', 'scoped permission consumed')
  const lease = acquireTelegramUserLease('alpha'); assertThrows(() => acquireTelegramUserLease('alpha'), 'active Host'); const betaLease = acquireTelegramUserLease('beta'); betaLease.release(); lease.release()
  assertDeepEqual(splitTelegramUserText('😀'.repeat(4097)).map(chunk => [...chunk].length), [4096, 1], 'Unicode deterministic chunks')
  const file = join(allowed, 'ok.txt'); writeFileSync(file, 'ok'); assertEqual(validateTelegramUserOutboundFile(file), file, 'allowed media path'); const outside = join(state, 'outside.txt'); writeFileSync(outside, 'no'); assertThrows(() => validateTelegramUserOutboundFile(outside), 'outside')
  const sensitive = `bad +15551234567 ${process.env.TU_ALPHA_HASH}`; assert(!redactTelegramUserError(sensitive).includes('+15551234567') && !redactTelegramUserError(sensitive).includes(process.env.TU_ALPHA_HASH!), 'secret redaction'); assert(classifyTelegramUserError(new Error('FLOOD_WAIT_30')).includes('FloodWait'), 'FloodWait classified'); assert(classifyTelegramUserError(new Error('PHONE_MIGRATE_2')).includes('migration'), 'DC migration classified')
} finally {
  for (const key of ['TELEGRAM_USER_STATE_DIR', 'TELEGRAM_USER_ALLOWED_FILE_ROOTS', 'TU_ALPHA_ID', 'TU_ALPHA_HASH', 'TU_ALPHA_PHONE', 'TU_BETA_ID', 'TU_BETA_HASH', 'TU_BETA_PHONE']) delete process.env[key]
  try { chmodSync(state, 0o700) } catch {}; rmSync(state, { recursive: true, force: true }); rmSync(allowed, { recursive: true, force: true })
}
console.log('[telegram-user-core] PASS')
