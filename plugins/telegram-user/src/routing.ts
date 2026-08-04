import type { TelegramUserPeerType, TelegramUserRoute } from './types.js'
const safe = (value: string): boolean => value.length > 0 && value.length <= 64 && /^-?\d+$/.test(value)
export function formatTelegramUserChatId(accountAlias: string, peerType: TelegramUserPeerType, peerId: string, topicId?: number): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(accountAlias) || !safe(peerId)) throw new Error('Invalid Telegram user route component.')
  if (topicId !== undefined && (!Number.isSafeInteger(topicId) || topicId <= 0)) throw new Error('Invalid Telegram topic ID.')
  return `${accountAlias}::${peerType}::${peerId}${topicId === undefined ? '' : `::topic::${topicId}`}`
}
export function parseTelegramUserChatId(value: string): TelegramUserRoute | null {
  const parts = value.split('::'); if (parts.length !== 3 && parts.length !== 5) return null
  const [accountAlias, peerType, peerId, marker, rawTopic] = parts
  if (!accountAlias || !peerId || !safe(peerId) || !['user', 'group', 'channel'].includes(peerType ?? '')) return null
  if (parts.length === 3) return { accountAlias, peerType: peerType as TelegramUserPeerType, peerId }
  const topicId = Number(rawTopic)
  return marker === 'topic' && Number.isSafeInteger(topicId) && topicId > 0 ? { accountAlias, peerType: peerType as TelegramUserPeerType, peerId, topicId } : null
}

