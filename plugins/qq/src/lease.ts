import { acquireChannelConnectionLease } from '../../shared/connectionLease.js'
import { getQqBotStateDir } from './config.js'

export interface QqBotLease { release(): void }
export function acquireQqBotLease(alias: string): QqBotLease {
  return acquireChannelConnectionLease({
    stateDir: getQqBotStateDir(alias),
    host: 'qq-host',
    alias,
    displayName: `QQ bot ${alias}`,
  })
}
