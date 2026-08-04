#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getQqBotStateDir,
  resolveQqSecret,
  saveQqBot,
} from '../../plugins/qq/src/config.js'
import {
  getBotStateDir as getWxworkBotStateDir,
  resolveBotSecret,
  saveBot as saveWxworkBot,
} from '../../plugins/wxwork/src/config.js'
import {
  getTelegramBotStateDir,
  resolveTelegramToken,
  saveTelegramBot,
} from '../../plugins/telegram/src/config.js'
import {
  getTelegramUserAccountStateDir,
  resolveTelegramUserCredentials,
  saveTelegramUserAccount,
} from '../../plugins/telegram-user/src/config.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = mkdtempSync(join(tmpdir(), 'channel-local-env-'))
const previous = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  QQ_STATE_DIR: process.env.QQ_STATE_DIR,
  WXWORK_STATE_DIR: process.env.WXWORK_STATE_DIR,
  TELEGRAM_STATE_DIR: process.env.TELEGRAM_STATE_DIR,
  TELEGRAM_USER_STATE_DIR: process.env.TELEGRAM_USER_STATE_DIR,
  QQ_APP_SECRET: process.env.QQ_APP_SECRET,
  WXWORK_SECRET: process.env.WXWORK_SECRET,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_API_ID: process.env.TELEGRAM_API_ID,
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH,
  TELEGRAM_PHONE: process.env.TELEGRAM_PHONE,
}

const secrets = {
  qq: 'qq-secret-fixture',
  wxwork: 'wxwork-secret-fixture',
  telegram: '123456:abcdefghijklmnopqrstuvwx',
  apiId: '12345678',
  apiHash: '0123456789abcdef0123456789abcdef',
  phone: '+8613800000000',
}

process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
process.env.QQ_STATE_DIR = join(root, 'qq')
process.env.WXWORK_STATE_DIR = join(root, 'wxwork')
process.env.TELEGRAM_STATE_DIR = join(root, 'telegram')
process.env.TELEGRAM_USER_STATE_DIR = join(root, 'telegram-user')
delete process.env.QQ_APP_SECRET
delete process.env.WXWORK_SECRET
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_API_ID
delete process.env.TELEGRAM_API_HASH
delete process.env.TELEGRAM_PHONE

try {
  mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
  writeFileSync(
    join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'),
    `${JSON.stringify(
      {
        env: {
          QQ_APP_SECRET: secrets.qq,
          WXWORK_SECRET: secrets.wxwork,
          TELEGRAM_BOT_TOKEN: secrets.telegram,
          TELEGRAM_API_ID: secrets.apiId,
          TELEGRAM_API_HASH: secrets.apiHash,
          TELEGRAM_PHONE: secrets.phone,
        },
      },
      null,
      2,
    )}\n`,
  )

  const qqDir = getQqBotStateDir('primary')
  writeFileSync(join(qqDir, 'credentials.json'), '{"legacy":true}\n')
  const qq = saveQqBot({
    alias: 'primary',
    appId: 'qq-app',
    secretEnv: 'QQ_APP_SECRET',
  })
  assertEqual(
    resolveQqSecret(qq),
    secrets.qq,
    'QQ standalone runtime falls back to user settings env',
  )
  process.env.QQ_APP_SECRET = 'process-env-wins'
  assertEqual(
    resolveQqSecret(qq),
    'process-env-wins',
    'QQ process environment takes precedence',
  )
  delete process.env.QQ_APP_SECRET
  assert(!existsSync(join(qqDir, 'credentials.json')), 'QQ removes legacy file')

  const wxworkDir = getWxworkBotStateDir('primary')
  writeFileSync(join(wxworkDir, 'credentials.json'), '{"legacy":true}\n')
  const wxwork = saveWxworkBot({
    alias: 'primary',
    botId: 'wxwork-bot',
    secretEnv: 'WXWORK_SECRET',
  })
  assertEqual(
    resolveBotSecret(wxwork),
    secrets.wxwork,
    'wxwork standalone runtime falls back to user settings env',
  )
  assert(
    !existsSync(join(wxworkDir, 'credentials.json')),
    'wxwork removes legacy file',
  )

  const telegramDir = getTelegramBotStateDir('primary')
  writeFileSync(join(telegramDir, 'credentials.json'), '{"legacy":true}\n')
  const telegram = saveTelegramBot({
    alias: 'primary',
    tokenEnv: 'TELEGRAM_BOT_TOKEN',
  })
  assertEqual(
    resolveTelegramToken(telegram),
    secrets.telegram,
    'Telegram standalone runtime falls back to user settings env',
  )
  assert(
    !existsSync(join(telegramDir, 'credentials.json')),
    'Telegram removes legacy file',
  )

  const telegramUserDir = getTelegramUserAccountStateDir('personal')
  writeFileSync(join(telegramUserDir, 'credentials.json'), '{"legacy":true}\n')
  const telegramUser = saveTelegramUserAccount({
    alias: 'personal',
    apiIdEnv: 'TELEGRAM_API_ID',
    apiHashEnv: 'TELEGRAM_API_HASH',
    phoneEnv: 'TELEGRAM_PHONE',
  })
  assertDeepEqual(
    resolveTelegramUserCredentials(telegramUser),
    { apiId: 12345678, apiHash: secrets.apiHash, phone: secrets.phone },
    'Telegram User standalone runtime falls back to user settings env',
  )
  assert(
    !existsSync(join(telegramUserDir, 'credentials.json')),
    'Telegram User removes legacy file',
  )

  for (const index of [
    join(process.env.QQ_STATE_DIR, 'bots.json'),
    join(process.env.WXWORK_STATE_DIR, 'bots.json'),
    join(process.env.TELEGRAM_STATE_DIR, 'bots.json'),
    join(process.env.TELEGRAM_USER_STATE_DIR, 'accounts.json'),
  ]) {
    const source = readFileSync(index, 'utf8')
    for (const secret of Object.values(secrets)) {
      assert(
        !source.includes(secret),
        `${index} must not contain secret values`,
      )
    }
  }

  for (const path of [
    'plugins/qq/src/cli.ts',
    'plugins/wxwork/src/cli.ts',
    'plugins/telegram/src/cli.ts',
    'plugins/telegram-user/src/cli.ts',
  ]) {
    const source = readFileSync(join(import.meta.dir, '..', '..', path), 'utf8')
    const removedCommand = ['add', 'local'].join('-')
    assert(
      !source.includes(removedCommand),
      `${path} does not expose the removed local-add command`,
    )
  }
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
}

console.log('channel environment resolution validation passed')
