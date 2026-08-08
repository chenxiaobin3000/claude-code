import { acquireChannelConnectionLease } from '../../shared/connectionLease.js'
import { getTelegramUserAccountStateDir } from './config.js'
export interface TelegramUserLease { release(): void }
export function acquireTelegramUserLease(alias: string): TelegramUserLease {
  return acquireChannelConnectionLease({
    stateDir: getTelegramUserAccountStateDir(alias),
    host: 'telegram-user-host',
    alias,
    displayName: `Telegram user account ${alias}`,
  })
}
