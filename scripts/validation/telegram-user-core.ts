#!/usr/bin/env bun
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTelegramUserHistoryAllowed, loadTelegramUserAccess, setTelegramUserRouteAllowed } from '../../plugins/telegram-user/src/access.js'
import { classifyTelegramUserError, createGramJsClient, listTelegramUserHistory, loginTelegramUserAccount, selectTelegramUserGroups, selectTelegramUserHistory, type TelegramUserDialogTransport, type TelegramUserLoginTransport } from '../../plugins/telegram-user/src/client.js'
import { listTelegramUserAccounts, loadTelegramUserSession, resolveTelegramUserCredentials, saveTelegramUserAccount, saveTelegramUserSession } from '../../plugins/telegram-user/src/config.js'
import { createTelegramUserChatRef, createTelegramUserControlMcpServer, TelegramUserControlService, type TelegramUserControlDependencies } from '../../plugins/telegram-user/src/control.js'
import { redactTelegramUserError } from '../../plugins/telegram-user/src/protocol.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const state = mkdtempSync(join(tmpdir(), 'telegram-user-core-'))
process.env.TELEGRAM_USER_STATE_DIR = state
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
  assertDeepEqual(selectTelegramUserHistory([
    { id: 7, date: 1_700_000_000, senderId: { toString: () => '300' }, message: 'hello' },
    { id: 8, date: 1_700_000_001, message: '', media: {} },
  ]), [
    { messageId: 7, date: '2023-11-14T22:13:20.000Z', senderId: '300', text: 'hello', hasMedia: false },
    { messageId: 8, date: '2023-11-14T22:13:21.000Z', text: '', hasMedia: true },
  ], 'history projection contains bounded metadata without media payloads')
  saveTelegramUserSession('alpha', 'alpha-session'); saveTelegramUserSession('beta', 'beta-session'); assertEqual(loadTelegramUserSession('alpha'), 'alpha-session', 'alpha session isolated'); assertEqual(loadTelegramUserSession('beta'), 'beta-session', 'beta session isolated')
  if (process.platform !== 'win32') assertEqual(statSync(join(state, 'accounts', 'alpha', 'session.txt')).mode & 0o777, 0o600, 'private session mode')
  let observedSession = ''; let observedCode = ''; let observedPassword = ''
  const factory = (_credentials: unknown, session: string): TelegramUserLoginTransport => { observedSession = session; return { session: { save: () => 'new-alpha-session' }, async start(params) { observedCode = await params.phoneCode(true); observedPassword = await params.password('fixture hint') }, async getMe() { return { id: { toString: () => '9001' }, username: 'fixture_user' } }, async disconnect() {} } }
  const login = await loginTelegramUserAccount(alpha, resolveTelegramUserCredentials(alpha), { code: async () => '654321', password: async () => 'not-persisted-password' }, factory)
  assertEqual(observedSession, 'alpha-session', 'StringSession restore'); assertEqual(login.userId, '9001', 'login identity'); assertEqual(loadTelegramUserSession('alpha'), 'new-alpha-session', 'StringSession save'); assertEqual(observedCode, '654321', 'code callback'); assertEqual(observedPassword, 'not-persisted-password', '2FA callback')
  const persisted = readFileSync(join(state, 'accounts', 'alpha', 'session.txt'), 'utf8') + readFileSync(join(state, 'accounts', 'alpha', 'identity.json'), 'utf8')
  assert(!persisted.includes('654321') && !persisted.includes('not-persisted-password') && !persisted.includes(process.env.TU_ALPHA_PHONE!), 'ephemeral login secrets not persisted')
  setTelegramUserRouteAllowed('alpha', { peerType: 'user', peerId: '100' }, true); assert(isTelegramUserHistoryAllowed('alpha', 'user', '100'), 'exact Peer allowed'); assert(!isTelegramUserHistoryAllowed('beta', 'user', '100'), 'account access isolation')
  setTelegramUserRouteAllowed('alpha', { peerType: 'group', peerId: '-200', topicId: 42 }, true); assertEqual(loadTelegramUserAccess('alpha').allowPeers.length, 2, 'allowlist persisted')
  assert(!isTelegramUserHistoryAllowed('alpha', 'group', '-200'), 'topic-scoped rule cannot authorize whole-peer history'); setTelegramUserRouteAllowed('alpha', { peerType: 'group', peerId: '-201' }, true); assert(isTelegramUserHistoryAllowed('alpha', 'group', '-201'), 'unrestricted peer authorizes history')
  let historyLimit = 0; let historyDisconnected = false
  const historyFactory = (): TelegramUserDialogTransport => ({ async connect() {}, async checkAuthorization() { return true }, async getDialogs() { return [{ id: { toString: () => '-201' }, title: 'History', isGroup: true, isChannel: true, inputEntity: {} as never }] }, async getMessages(_entity, params) { historyLimit = params.limit; return [{ id: 8, date: 1_700_000_001, message: 'new' }, { id: 7, date: 1_700_000_000, message: 'old' }] }, async disconnect() { historyDisconnected = true } })
  const history = await listTelegramUserHistory(alpha, resolveTelegramUserCredentials(alpha), 'group', '-201', 12, historyFactory); assertDeepEqual(history.map(message => message.messageId), [7, 8], 'history returned oldest to newest'); assertEqual(historyLimit, 12, 'history limit forwarded'); assert(historyDisconnected, 'history client disconnected')
  const controlAllowed = new Set<string>(); let controlHistoryPeer = ''; let controlAccessPeer = ''
  const controlDependencies: TelegramUserControlDependencies = { resolveAccount: () => alpha, resolveCredentials: resolveTelegramUserCredentials, loadSession: () => 'private-session-material', async listGroups() { return [{ type: 'supergroup', id: '-1001234567890', name: 'Trading' }, { type: 'channel', id: '-1009876543210', name: 'News' }] }, async listHistory(_account, _credentials, _peerType, peerId) { controlHistoryPeer = peerId; return [{ messageId: 1, date: '2023-11-14T22:13:20.000Z', text: 'fixture', hasMedia: false }] }, isHistoryAllowed(_alias, peerType, peerId) { return controlAllowed.has(`${peerType}:${peerId}`) }, setAccess(_alias, entry, enabled) { controlAccessPeer = entry.peerId; const key = `${entry.peerType}:${entry.peerId}`; if (enabled) controlAllowed.add(key); else controlAllowed.delete(key) } }
  const control = new TelegramUserControlService(controlDependencies); const controlChats = await control.listChats('alpha', 'all'); const serializedChats = JSON.stringify(controlChats)
  assertEqual(controlChats.length, 2, 'control lists groups and channels'); assert(!serializedChats.includes('-1001234567890') && !serializedChats.includes('-1009876543210'), 'control output hides Peer IDs'); assert(controlChats[0]!.chatRef.startsWith('chat_') && controlChats[0]!.chatRef !== controlChats[1]!.chatRef, 'opaque chat refs are distinct'); assertEqual(createTelegramUserChatRef('alpha', 'supergroup', '-1001234567890', 'private-session-material'), controlChats[0]!.chatRef, 'chat ref is stable')
  const enabledChat = await control.setChatAccess('alpha', controlChats[0]!.chatRef, true); assert(enabledChat.allowed, 'control enables access'); assertEqual(controlAccessPeer, '-1001234567890', 'control resolves hidden Peer ID internally'); const controlHistory = await control.getChatHistory('alpha', controlChats[0]!.chatRef, 20); assertEqual(controlHistory[0]?.text, 'fixture', 'control returns allowlisted history'); assertEqual(controlHistoryPeer, '-1001234567890', 'history resolves hidden Peer ID internally')
  const controlServer = createTelegramUserControlMcpServer('1.0.0', control); const controlClient = new Client({ name: 'telegram-user-control-validation', version: '1.0.0' }); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await Promise.all([controlServer.connect(serverTransport), controlClient.connect(clientTransport)])
  try { const tools = await controlClient.listTools(); assertDeepEqual(tools.tools.map(tool => tool.name), ['list_chats', 'set_chat_access', 'get_chat_history'], 'control MCP tool surface'); assert(tools.tools.every(tool => !tool._meta?.['anthropic/alwaysLoad']), 'control tools are not always loaded'); const listed = await controlClient.callTool({ name: 'list_chats', arguments: { account: 'alpha', type: 'all' } }); const listedText = 'content' in listed && Array.isArray(listed.content) && listed.content[0]?.type === 'text' ? listed.content[0].text : ''; assert(listedText.includes('Trading') && !listedText.includes('-1001234567890'), 'MCP list response hides Peer ID') } finally { await controlClient.close(); await controlServer.close() }
  const sensitive = `bad +15551234567 ${process.env.TU_ALPHA_HASH}`; assert(!redactTelegramUserError(sensitive).includes('+15551234567') && !redactTelegramUserError(sensitive).includes(process.env.TU_ALPHA_HASH!), 'secret redaction'); assert(classifyTelegramUserError(new Error('FLOOD_WAIT_30')).includes('FloodWait'), 'FloodWait classified'); assert(classifyTelegramUserError(new Error('PHONE_MIGRATE_2')).includes('migration'), 'DC migration classified')
} finally {
  for (const key of ['TELEGRAM_USER_STATE_DIR', 'TU_ALPHA_ID', 'TU_ALPHA_HASH', 'TU_ALPHA_PHONE', 'TU_BETA_ID', 'TU_BETA_HASH', 'TU_BETA_PHONE']) delete process.env[key]
  try { chmodSync(state, 0o700) } catch {}; rmSync(state, { recursive: true, force: true })
}
console.log('[telegram-user-core] PASS')
