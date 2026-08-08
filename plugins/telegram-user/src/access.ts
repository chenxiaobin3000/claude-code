import { loadTelegramUserState, saveTelegramUserState } from './config.js'
import type { TelegramUserPeerType } from './types.js'
export interface TelegramUserAccessEntry { peerType: TelegramUserPeerType; peerId: string; topicId?: number; allowSenders?: string[] }
export interface TelegramUserAccessConfig { version: 1; allowPeers: TelegramUserAccessEntry[] }
export function loadTelegramUserAccess(alias: string): TelegramUserAccessConfig { return loadTelegramUserState(alias, 'access.json', { version: 1, allowPeers: [] }) }
export function isTelegramUserHistoryAllowed(
  alias: string,
  peerType: TelegramUserPeerType,
  peerId: string,
): boolean {
  return loadTelegramUserAccess(alias).allowPeers.some(
    entry =>
      entry.peerType === peerType &&
      entry.peerId === peerId &&
      entry.topicId === undefined &&
      !entry.allowSenders?.length,
  )
}
export function setTelegramUserRouteAllowed(alias: string, entry: TelegramUserAccessEntry, allowed: boolean): void {
  if (!['user', 'group', 'channel'].includes(entry.peerType) || !/^-?\d+$/.test(entry.peerId)) throw new Error('Invalid Telegram Peer allowlist entry.')
  if (entry.topicId !== undefined && (!Number.isSafeInteger(entry.topicId) || entry.topicId <= 0)) throw new Error('Invalid Telegram Topic allowlist entry.')
  const config = loadTelegramUserAccess(alias)
  const same = (candidate: TelegramUserAccessEntry): boolean => candidate.peerType === entry.peerType && candidate.peerId === entry.peerId && candidate.topicId === entry.topicId
  config.allowPeers = config.allowPeers.filter(candidate => !same(candidate))
  if (allowed) config.allowPeers.push({ ...entry, allowSenders: entry.allowSenders?.slice().sort() })
  saveTelegramUserState(alias, 'access.json', config)
}
