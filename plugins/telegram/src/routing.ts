import type { TelegramChatScope, TelegramRoute } from './types.js'

const safe = (value: string): boolean => value.length > 0 && value.length <= 64 && !value.includes('::') && ![...value].some(character => character.charCodeAt(0) < 32)

export function formatTelegramChatId(botAlias: string, scope: TelegramChatScope, chatId: string, topicId?: number): string {
  if (!safe(botAlias) || !safe(chatId)) throw new Error('Invalid Telegram route component.')
  if (topicId !== undefined && (!Number.isSafeInteger(topicId) || topicId <= 0)) throw new Error('Invalid Telegram topic ID.')
  return `${botAlias}::${scope}::${chatId}${topicId === undefined ? '' : `::topic::${topicId}`}`
}

export function parseTelegramChatId(value: string): TelegramRoute | null {
  const parts = value.split('::')
  if (parts.length !== 3 && parts.length !== 5) return null
  const [botAlias, scope, chatId, marker, rawTopic] = parts
  if (!botAlias || !chatId || (scope !== 'private' && scope !== 'group')) return null
  if (parts.length === 3) return { botAlias, scope, chatId }
  const topicId = Number(rawTopic)
  return marker === 'topic' && Number.isSafeInteger(topicId) && topicId > 0 ? { botAlias, scope, chatId, topicId } : null
}
