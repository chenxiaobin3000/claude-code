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
import { findUserSettingsEnvName } from '../../plugins/userSettingsEnv.js'
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
}

const secrets = {
  qq: 'qq-secret-fixture',
  wxwork: 'wxwork-secret-fixture',
  telegram: '123456:abcdefghijklmnopqrstuvwx',
  apiId: '12345678',
  apiHash: '0123456789abcdef0123456789abcdef',
  phone: '+8613800000000',
}

function expectFailure(
  action: () => unknown,
  pattern: RegExp,
  message: string,
) {
  try {
    action()
  } catch (error) {
    assert(pattern.test(String(error)), `${message}: unexpected error ${error}`)
    return
  }
  throw new Error(`${message}: expected failure`)
}

process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
process.env.QQ_STATE_DIR = join(root, 'qq')
process.env.WXWORK_STATE_DIR = join(root, 'wxwork')
process.env.TELEGRAM_STATE_DIR = join(root, 'telegram')
process.env.TELEGRAM_USER_STATE_DIR = join(root, 'telegram-user')

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

  assertEqual(
    findUserSettingsEnvName(secrets.qq, 'QQ AppSecret'),
    'QQ_APP_SECRET',
    'finds the exact user settings env name',
  )
  expectFailure(
    () => findUserSettingsEnvName('missing', 'fixture secret'),
    /No user settings env entry matches fixture secret/,
    'rejects a value absent from user settings',
  )

  const settingsPath = join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    env: Record<string, string>
  }
  settings.env.DUPLICATE_QQ_SECRET = secrets.qq
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  expectFailure(
    () => findUserSettingsEnvName(secrets.qq, 'QQ AppSecret'),
    /Multiple user settings env entries match QQ AppSecret/,
    'rejects ambiguous matches',
  )
  delete settings.env.DUPLICATE_QQ_SECRET
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)

  process.env.QQ_APP_SECRET = secrets.qq
  const qqDir = getQqBotStateDir('primary')
  writeFileSync(join(qqDir, 'credentials.json'), '{"legacy":true}\n')
  const qq = saveQqBot({
    alias: 'primary',
    appId: 'qq-app',
    secretEnv: findUserSettingsEnvName(secrets.qq, 'QQ AppSecret'),
  })
  assertEqual(resolveQqSecret(qq), secrets.qq, 'QQ keeps env runtime flow')
  assert(!existsSync(join(qqDir, 'credentials.json')), 'QQ removes legacy file')

  process.env.WXWORK_SECRET = secrets.wxwork
  const wxworkDir = getWxworkBotStateDir('primary')
  writeFileSync(join(wxworkDir, 'credentials.json'), '{"legacy":true}\n')
  const wxwork = saveWxworkBot({
    alias: 'primary',
    botId: 'wxwork-bot',
    secretEnv: findUserSettingsEnvName(secrets.wxwork, 'wxwork Secret'),
  })
  assertEqual(
    resolveBotSecret(wxwork),
    secrets.wxwork,
    'wxwork keeps env runtime flow',
  )
  assert(
    !existsSync(join(wxworkDir, 'credentials.json')),
    'wxwork removes legacy file',
  )

  process.env.TELEGRAM_BOT_TOKEN = secrets.telegram
  const telegramDir = getTelegramBotStateDir('primary')
  writeFileSync(join(telegramDir, 'credentials.json'), '{"legacy":true}\n')
  const telegram = saveTelegramBot({
    alias: 'primary',
    tokenEnv: findUserSettingsEnvName(secrets.telegram, 'Telegram Bot Token'),
  })
  assertEqual(
    resolveTelegramToken(telegram),
    secrets.telegram,
    'Telegram keeps env runtime flow',
  )
  assert(
    !existsSync(join(telegramDir, 'credentials.json')),
    'Telegram removes legacy file',
  )

  process.env.TELEGRAM_API_ID = secrets.apiId
  process.env.TELEGRAM_API_HASH = secrets.apiHash
  process.env.TELEGRAM_PHONE = secrets.phone
  const telegramUserDir = getTelegramUserAccountStateDir('personal')
  writeFileSync(join(telegramUserDir, 'credentials.json'), '{"legacy":true}\n')
  const telegramUser = saveTelegramUserAccount({
    alias: 'personal',
    apiIdEnv: findUserSettingsEnvName(secrets.apiId, 'Telegram API ID'),
    apiHashEnv: findUserSettingsEnvName(secrets.apiHash, 'Telegram API Hash'),
    phoneEnv: findUserSettingsEnvName(secrets.phone, 'Telegram phone number'),
  })
  assertDeepEqual(
    resolveTelegramUserCredentials(telegramUser),
    { apiId: 12345678, apiHash: secrets.apiHash, phone: secrets.phone },
    'Telegram User keeps env runtime flow',
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
    assert(source.includes('add-local'), `${path} exposes add-local`)
    assert(
      source.includes('only matched against user settings'),
      `${path} explains value-only matching`,
    )
  }
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
}

console.log('channel local env matching validation passed')
