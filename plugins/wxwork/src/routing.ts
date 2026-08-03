import { validateBotAlias } from './config.js'
import type { WxworkChatType } from './types.js'

export interface WxworkRoute {
  botAlias: string
  chatType: WxworkChatType
  targetId: string
}

export function formatWxworkChatId(botAlias: string, chatType: WxworkChatType, targetId: string): string {
  if (!targetId) throw new Error('wxwork route target is empty.')
  return `${validateBotAlias(botAlias)}::${chatType}::${targetId}`
}

export function parseWxworkChatId(chatId: string): WxworkRoute | null {
  const first = chatId.indexOf('::')
  const second = first < 0 ? -1 : chatId.indexOf('::', first + 2)
  if (first <= 0 || second <= first + 2) return null
  const botAlias = chatId.slice(0, first)
  const chatType = chatId.slice(first + 2, second)
  const targetId = chatId.slice(second + 2)
  if ((chatType !== 'single' && chatType !== 'group') || !targetId) return null
  try { return { botAlias: validateBotAlias(botAlias), chatType, targetId } } catch { return null }
}
