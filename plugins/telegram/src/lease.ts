import { acquireChannelConnectionLease } from '../../shared/connectionLease.js'
import { getTelegramBotStateDir } from './config.js'

export interface TelegramBotLease { release(): void }
export function acquireTelegramBotLease(alias: string): TelegramBotLease {
  return acquireChannelConnectionLease({
    stateDir: getTelegramBotStateDir(alias),
    host: 'telegram-host',
    alias,
    displayName: `Telegram bot ${alias}`,
  })
}
