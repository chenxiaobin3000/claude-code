import { acquireChannelConnectionLease } from '../../shared/connectionLease.js'
import { join } from 'node:path'
import { getBotStateDir } from './config.js'

export interface WxworkBotLease {
  alias: string
  path: string
  release(): void
}

export function acquireWxworkBotLease(alias: string): WxworkBotLease {
  const stateDir = getBotStateDir(alias)
  const lease = acquireChannelConnectionLease({
    stateDir,
    host: 'wxwork-host',
    alias,
    displayName: `wxwork bot ${alias}`,
  })
  return {
    alias,
    path: join(stateDir, 'connection.lock'),
    release: lease.release,
  }
}
