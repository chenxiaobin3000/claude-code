import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FEATURE_CONFIG,
  loadFeatureConfig,
  saveStateJson,
} from '../../plugins/weixin/src/accounts.js'
import { downloadRemoteToTemp } from '../../plugins/weixin/src/media.js'
import {
  extractEchoCommand,
  extractMessageText,
  processMessage,
} from '../../plugins/weixin/src/monitor.js'
import { saveAccessConfig } from '../../plugins/weixin/src/pairing.js'
import { MessageItemType, MessageType } from '../../plugins/weixin/src/types.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[weixin-channel-features] ${message}`)
}

const stateDir = await mkdtemp(join(tmpdir(), 'weixin-channel-features-'))
const previousStateDir = process.env.WEIXIN_STATE_DIR
const originalFetch = globalThis.fetch
process.env.WEIXIN_STATE_DIR = stateDir

try {
  const defaults = loadFeatureConfig('primary')
  assert(defaults.quotedText, 'quoted text defaults on')
  assert(!defaults.remoteHttpMedia && !defaults.echo, 'network and command features default off')

  saveStateJson(
    'features.json',
    { remoteHttpMedia: true, channelDiagnostics: true, echo: true },
    'primary',
  )
  const configured = loadFeatureConfig('primary')
  assert(configured.remoteHttpMedia && configured.channelDiagnostics && configured.echo, 'supported feature switches')

  saveStateJson('features.json', { streamingMarkdown: true }, 'unsupported')
  let unsupportedRejected = false
  try {
    loadFeatureConfig('unsupported')
  } catch {
    unsupportedRejected = true
  }
  assert(unsupportedRejected, 'unsupported host event capability rejected')

  const items = [{
    type: MessageItemType.TEXT,
    text_item: { text: 'current' },
    ref_msg: {
      title: 'author',
      message_item: { type: MessageItemType.TEXT, text_item: { text: 'quoted' } },
    },
  }]
  assert(extractMessageText(items).includes('[Quoted:'), 'quoted text formatter')
  assert(extractEchoCommand('/echo hello') === 'hello', 'echo command')
  assert(extractEchoCommand('ordinary') === null, 'ordinary message is not echo')

  saveAccessConfig({ policy: 'allowlist', allowFrom: ['sender'] }, 'primary')
  let received = ''
  await processMessage(
    {
      message_type: MessageType.USER,
      from_user_id: 'sender',
      message_id: 7,
      item_list: items,
    },
    {
      accountId: 'primary',
      baseUrl: 'https://example.test',
      cdnBaseUrl: 'https://cdn.example.test',
      token: 'secret',
      features: { ...DEFAULT_FEATURE_CONFIG, quotedText: false },
      onMessage: async message => {
        received = message.text
        assert(message.routedChatId === 'primary::sender', 'account-qualified channel route')
      },
    },
  )
  assert(received === 'current', 'quoted text switch')

  globalThis.fetch = (async () =>
    new Response('remote fixture', {
      status: 200,
      headers: { 'content-length': '14' },
    })) as typeof fetch
  const remotePath = await downloadRemoteToTemp('https://media.example.test/file.txt', stateDir)
  assert(remotePath.endsWith('file.txt'), 'remote HTTP media download')
  let protocolRejected = false
  try {
    await downloadRemoteToTemp('file:///secret.txt', stateDir)
  } catch {
    protocolRejected = true
  }
  assert(protocolRejected, 'non-HTTP remote media rejected')
} finally {
  globalThis.fetch = originalFetch
  if (previousStateDir === undefined) delete process.env.WEIXIN_STATE_DIR
  else process.env.WEIXIN_STATE_DIR = previousStateDir
  await rm(stateDir, { recursive: true, force: true })
}

console.log('[weixin-channel-features] PASS')
