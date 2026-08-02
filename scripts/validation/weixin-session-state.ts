import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadAccount,
  loadStateJson,
  loadStateText,
  saveAccount,
  saveStateJson,
  saveStateText,
  getAccountStateDir,
} from '../../plugins/weixin/src/accounts.js'
import {
  assertSessionActive,
  getSessionPauseRemaining,
  pauseSession,
  resetSessionPause,
} from '../../plugins/weixin/src/session.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[weixin-session-state] ${message}`)
}

const stateDir = await mkdtemp(join(tmpdir(), 'weixin-session-state-'))
const previousStateDir = process.env.WEIXIN_STATE_DIR
process.env.WEIXIN_STATE_DIR = stateDir

try {
  saveAccount({
    token: 'token-1',
    baseUrl: 'https://example.test',
    userId: 'user',
    savedAt: 'now',
  }, 'primary')
  saveAccount({
    token: 'token-2',
    baseUrl: 'https://example.test',
    userId: 'user',
    savedAt: 'later',
  }, 'primary')
  assert(loadAccount('primary')?.token === 'token-2', 'atomic account replacement')
  saveStateText('cursor.txt', 'cursor-2', 'primary')
  assert(loadStateText('cursor.txt', 'primary') === 'cursor-2', 'cursor persistence')
  saveStateJson('context-tokens.json', { user: 'context-token' }, 'primary')
  assert(
    loadStateJson<Record<string, string>>('context-tokens.json', {}, 'primary').user ===
      'context-token',
    'context token persistence',
  )
  const accountFile = await readFile(join(getAccountStateDir('primary'), 'account.json'), 'utf8')
  assert(accountFile.includes('token-2'), 'account file written')

  resetSessionPause('primary')
  pauseSession(1_000, 'primary')
  assert(getSessionPauseRemaining(2_000, 'primary') > 0, 'stale token pause active')
  let blocked = false
  try {
    assertSessionActive(2_000, 'primary')
  } catch {
    blocked = true
  }
  assert(blocked, 'outbound request blocked while token is stale')
  resetSessionPause('primary')
  assertSessionActive(2_000, 'primary')
} finally {
  if (previousStateDir === undefined) delete process.env.WEIXIN_STATE_DIR
  else process.env.WEIXIN_STATE_DIR = previousStateDir
  await rm(stateDir, { recursive: true, force: true })
}

console.log('[weixin-session-state] PASS')
