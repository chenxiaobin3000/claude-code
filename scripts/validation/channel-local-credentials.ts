#!/usr/bin/env bun

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getQqBotStateDir,
  listQqBots,
  removeQqBot,
  resolveQqSecret,
  saveLocalQqBot,
  saveQqBot,
} from '../../plugins/qq/src/config.js'
import {
  getBotStateDir as getWxworkBotStateDir,
  listBots as listWxworkBots,
  removeBot as removeWxworkBot,
  resolveBotSecret,
  saveBot as saveWxworkBot,
  saveLocalBot as saveLocalWxworkBot,
} from '../../plugins/wxwork/src/config.js'
import {
  getTelegramBotStateDir,
  listTelegramBots,
  removeTelegramBot,
  resolveTelegramToken,
  saveLocalTelegramBot,
  saveTelegramBot,
} from '../../plugins/telegram/src/config.js'
import {
  getTelegramUserAccountStateDir,
  listTelegramUserAccounts,
  removeTelegramUserAccount,
  resolveTelegramUserCredentials,
  saveLocalTelegramUserAccount,
  saveTelegramUserAccount,
} from '../../plugins/telegram-user/src/config.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = mkdtempSync(join(tmpdir(), 'channel-local-credentials-'))
const previous = {
  QQ_STATE_DIR: process.env.QQ_STATE_DIR,
  WXWORK_STATE_DIR: process.env.WXWORK_STATE_DIR,
  TELEGRAM_STATE_DIR: process.env.TELEGRAM_STATE_DIR,
  TELEGRAM_USER_STATE_DIR: process.env.TELEGRAM_USER_STATE_DIR,
}

process.env.QQ_STATE_DIR = join(root, 'qq')
process.env.WXWORK_STATE_DIR = join(root, 'wxwork')
process.env.TELEGRAM_STATE_DIR = join(root, 'telegram')
process.env.TELEGRAM_USER_STATE_DIR = join(root, 'telegram-user')

try {
  const qqSecret = 'qq-local-secret-fixture'
  let qq = saveLocalQqBot({
    alias: 'primary',
    appId: 'qq-app',
    secret: qqSecret,
  })
  assertEqual(resolveQqSecret(qq), qqSecret, 'QQ resolves stored credential')
  assertEqual(
    listQqBots()[0]?.credentialSource,
    'local',
    'QQ records local source',
  )
  assert(
    !readFileSync(join(process.env.QQ_STATE_DIR, 'bots.json'), 'utf8').includes(
      qqSecret,
    ),
    'QQ index excludes secret',
  )
  process.env.QQ_ENV_SECRET = 'qq-env-secret'
  qq = saveQqBot({
    alias: 'primary',
    appId: 'qq-app',
    secretEnv: 'QQ_ENV_SECRET',
  })
  assertEqual(
    resolveQqSecret(qq),
    'qq-env-secret',
    'QQ can switch back to environment source',
  )
  assert(
    !existsSync(join(getQqBotStateDir('primary'), 'credentials.json')),
    'QQ removes stale local credential',
  )
  const qqBotDir = getQqBotStateDir('primary')
  removeQqBot('primary')
  assert(!existsSync(qqBotDir), 'QQ remove deletes credential directory')

  const wxworkSecret = 'wxwork-local-secret-fixture'
  let wxwork = saveLocalWxworkBot({
    alias: 'primary',
    botId: 'wxwork-bot',
    secret: wxworkSecret,
  })
  assertEqual(
    resolveBotSecret(wxwork),
    wxworkSecret,
    'wxwork resolves stored credential',
  )
  assertEqual(
    listWxworkBots()[0]?.credentialSource,
    'local',
    'wxwork records local source',
  )
  assert(
    !readFileSync(
      join(process.env.WXWORK_STATE_DIR, 'bots.json'),
      'utf8',
    ).includes(wxworkSecret),
    'wxwork index excludes secret',
  )
  process.env.WXWORK_ENV_SECRET = 'wxwork-env-secret'
  wxwork = saveWxworkBot({
    alias: 'primary',
    botId: 'wxwork-bot',
    secretEnv: 'WXWORK_ENV_SECRET',
  })
  assertEqual(
    resolveBotSecret(wxwork),
    'wxwork-env-secret',
    'wxwork can switch back to environment source',
  )
  assert(
    !existsSync(join(getWxworkBotStateDir('primary'), 'credentials.json')),
    'wxwork removes stale local credential',
  )
  const wxworkBotDir = getWxworkBotStateDir('primary')
  removeWxworkBot('primary')
  assert(
    !existsSync(wxworkBotDir),
    'wxwork remove deletes credential directory',
  )

  const telegramToken = '123456:abcdefghijklmnopqrstuvwx'
  let telegram = saveLocalTelegramBot({
    alias: 'primary',
    token: telegramToken,
  })
  assertEqual(
    resolveTelegramToken(telegram),
    telegramToken,
    'Telegram resolves stored token',
  )
  assertEqual(
    listTelegramBots()[0]?.credentialSource,
    'local',
    'Telegram records local source',
  )
  assert(
    !readFileSync(
      join(process.env.TELEGRAM_STATE_DIR, 'bots.json'),
      'utf8',
    ).includes(telegramToken),
    'Telegram index excludes token',
  )
  process.env.TELEGRAM_ENV_TOKEN = '654321:zyxwvutsrqponmlkjihgfedc'
  telegram = saveTelegramBot({
    alias: 'primary',
    tokenEnv: 'TELEGRAM_ENV_TOKEN',
  })
  assertEqual(
    resolveTelegramToken(telegram),
    process.env.TELEGRAM_ENV_TOKEN,
    'Telegram can switch back to environment source',
  )
  assert(
    !existsSync(join(getTelegramBotStateDir('primary'), 'credentials.json')),
    'Telegram removes stale local credential',
  )
  const telegramBotDir = getTelegramBotStateDir('primary')
  removeTelegramBot('primary')
  assert(
    !existsSync(telegramBotDir),
    'Telegram remove deletes credential directory',
  )

  const telegramUserSecret = {
    apiId: '12345678',
    apiHash: '0123456789abcdef0123456789abcdef',
    phone: '+8613800000000',
  }
  let telegramUser = saveLocalTelegramUserAccount({
    alias: 'personal',
    ...telegramUserSecret,
  })
  assertDeepEqual(
    resolveTelegramUserCredentials(telegramUser),
    { ...telegramUserSecret, apiId: 12345678 },
    'Telegram User resolves stored credentials',
  )
  assertEqual(
    listTelegramUserAccounts()[0]?.credentialSource,
    'local',
    'Telegram User records local source',
  )
  const telegramUserIndex = readFileSync(
    join(process.env.TELEGRAM_USER_STATE_DIR, 'accounts.json'),
    'utf8',
  )
  assert(
    !telegramUserIndex.includes(telegramUserSecret.apiHash),
    'Telegram User index excludes API hash',
  )
  assert(
    !telegramUserIndex.includes(telegramUserSecret.phone),
    'Telegram User index excludes phone',
  )
  process.env.TU_ID = '87654321'
  process.env.TU_HASH = 'abcdef0123456789abcdef0123456789'
  process.env.TU_PHONE = '+15555550123'
  telegramUser = saveTelegramUserAccount({
    alias: 'personal',
    apiIdEnv: 'TU_ID',
    apiHashEnv: 'TU_HASH',
    phoneEnv: 'TU_PHONE',
  })
  assertDeepEqual(
    resolveTelegramUserCredentials(telegramUser),
    {
      apiId: 87654321,
      apiHash: process.env.TU_HASH,
      phone: process.env.TU_PHONE,
    },
    'Telegram User can switch back to environment source',
  )
  assert(
    !existsSync(
      join(getTelegramUserAccountStateDir('personal'), 'credentials.json'),
    ),
    'Telegram User removes stale local credentials',
  )
  const telegramUserAccountDir = getTelegramUserAccountStateDir('personal')
  removeTelegramUserAccount('personal')
  assert(
    !existsSync(telegramUserAccountDir),
    'Telegram User remove deletes credential directory',
  )

  for (const path of [
    'plugins/qq/src/cli.ts',
    'plugins/wxwork/src/cli.ts',
    'plugins/telegram/src/cli.ts',
    'plugins/telegram-user/src/cli.ts',
  ]) {
    const source = readFileSync(join(import.meta.dir, '..', '..', path), 'utf8')
    assert(source.includes('add-local'), `${path} exposes add-local`)
    assert(
      source.includes('may be retained in shell history'),
      `${path} warns about command history`,
    )
  }
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
}

console.log('channel local credentials validation passed')
