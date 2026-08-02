import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAccount,
  DEFAULT_FEATURE_CONFIG,
  formatRoutedChatId,
  listAccounts,
  loadAccount,
  loadStateText,
  parseRoutedChatId,
  saveAccount,
  saveStateText,
} from '../../plugins/weixin/src/accounts.js'
import { startPollLoop } from '../../plugins/weixin/src/monitor.js'
import { saveAccessConfig } from '../../plugins/weixin/src/pairing.js'
import {
  clearPermissionStateForTests,
  consumePendingPermission,
  getActivePermissionChat,
  savePendingPermission,
  setActivePermissionChat,
} from '../../plugins/weixin/src/permissions.js'
import {
  assertSessionActive,
  pauseSession,
  resetSessionPause,
} from '../../plugins/weixin/src/session.js'
import { resolveWeixinToolTarget } from '../../plugins/weixin/src/server.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[weixin-multi-account] ${message}`)
}

const stateDir = await mkdtemp(join(tmpdir(), 'weixin-multi-account-'))
const previous = process.env.WEIXIN_STATE_DIR
const originalFetch = globalThis.fetch
process.env.WEIXIN_STATE_DIR = stateDir

try {
  saveAccount(
    { token: 'primary-secret', baseUrl: 'https://one.example', userId: 'bot-one', savedAt: 'one' },
    'primary',
  )
  saveAccount(
    { token: 'secondary-secret', baseUrl: 'https://two.example', userId: 'bot-two', savedAt: 'two' },
    'secondary',
  )
  assert(
    listAccounts().map(account => account.accountId).join(',') === 'primary,secondary',
    'account index',
  )
  let ambiguous = false
  try {
    loadAccount()
  } catch {
    ambiguous = true
  }
  assert(ambiguous, 'implicit selection fails closed')

  saveStateText('cursor.txt', 'cursor-one', 'primary')
  saveStateText('cursor.txt', 'cursor-two', 'secondary')
  assert(loadStateText('cursor.txt', 'primary') === 'cursor-one', 'primary cursor isolation')
  assert(loadStateText('cursor.txt', 'secondary') === 'cursor-two', 'secondary cursor isolation')

  const routed = formatRoutedChatId('primary', 'user::with-separator')
  const parsed = parseRoutedChatId(routed)
  assert(parsed?.accountId === 'primary', 'routed account')
  assert(parsed?.userId === 'user::with-separator', 'routed user')
  assert(resolveWeixinToolTarget(routed).account.token === 'primary-secret', 'routed tool account')
  assert(
    resolveWeixinToolTarget('plain-user', 'secondary').account.token === 'secondary-secret',
    'explicit tool account',
  )
  ambiguous = false
  try {
    resolveWeixinToolTarget('plain-user')
  } catch {
    ambiguous = true
  }
  assert(ambiguous, 'unqualified tool route fails closed')

  clearPermissionStateForTests()
  setActivePermissionChat('primary', 'user-one')
  setActivePermissionChat('secondary', 'user-two')
  assert(getActivePermissionChat() === null, 'permission fallback refuses multiple accounts')
  assert(getActivePermissionChat('primary')?.chatId === 'user-one', 'scoped active chat')
  savePendingPermission(
    { request_id: 'abcde', tool_name: 'Bash', description: 'fixture', input_preview: 'pwd' },
    'primary',
    'user-one',
  )
  savePendingPermission(
    { request_id: 'abcde', tool_name: 'Read', description: 'fixture two', input_preview: 'README' },
    'secondary',
    'user-two',
  )
  assert(consumePendingPermission('abcde', 'secondary', 'user-one') === null, 'cross-account permission blocked')
  assert(Boolean(consumePendingPermission('abcde', 'primary', 'user-one')), 'same-account permission accepted')
  assert(Boolean(consumePendingPermission('abcde', 'secondary', 'user-two')), 'same request ID isolated per account')

  resetSessionPause('primary')
  resetSessionPause('secondary')
  pauseSession(1_000, 'primary')
  let primaryBlocked = false
  try {
    assertSessionActive(2_000, 'primary')
  } catch {
    primaryBlocked = true
  }
  assert(primaryBlocked, 'primary stale-token pause')
  assertSessionActive(2_000, 'secondary')

  saveAccessConfig({ policy: 'allowlist', allowFrom: ['sender-one'] }, 'primary')
  saveAccessConfig({ policy: 'allowlist', allowFrom: ['sender-two'] }, 'secondary')
  const delivered = new Set<string>()
  const controller = new AbortController()
  globalThis.fetch = (async (_input, init) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization
    const accountId = authorization === 'Bearer primary-secret' ? 'primary' : 'secondary'
    const sender = accountId === 'primary' ? 'sender-one' : 'sender-two'
    return new Response(
      JSON.stringify({
        ret: 0,
        get_updates_buf: `cursor-${accountId}`,
        msgs: delivered.has(accountId)
          ? []
          : [{
              message_type: 1,
              message_id: accountId === 'primary' ? 1 : 2,
              from_user_id: sender,
              context_token: `context-${accountId}`,
              item_list: [{ type: 1, text_item: { text: accountId } }],
            }],
      }),
      { status: 200 },
    )
  }) as typeof fetch
  const poll = (accountId: 'primary' | 'secondary', token: string) =>
    startPollLoop({
      accountId,
      baseUrl: 'https://ilink.example.test',
      cdnBaseUrl: 'https://cdn.example.test',
      token,
      features: { ...DEFAULT_FEATURE_CONFIG },
      onMessage: async message => {
        delivered.add(message.accountId)
        if (delivered.size === 2) controller.abort()
      },
      abortSignal: controller.signal,
    })
  await Promise.all([
    poll('primary', 'primary-secret'),
    poll('secondary', 'secondary-secret'),
  ])
  assert(delivered.has('primary') && delivered.has('secondary'), 'concurrent account polling')
  assert(loadStateText('cursor.txt', 'primary') === 'cursor-primary', 'primary poll cursor')
  assert(loadStateText('cursor.txt', 'secondary') === 'cursor-secondary', 'secondary poll cursor')

  clearAccount('primary')
  assert(loadAccount('primary') === null, 'account removal')
  assert(loadAccount()?.accountId === 'secondary', 'single remaining account resolution')
} finally {
  globalThis.fetch = originalFetch
  clearPermissionStateForTests()
  if (previous === undefined) delete process.env.WEIXIN_STATE_DIR
  else process.env.WEIXIN_STATE_DIR = previous
  await rm(stateDir, { recursive: true, force: true })
}

console.log('[weixin-multi-account] PASS')
