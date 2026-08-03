export interface TelegramPermissionRequest {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
  channel_context?: { source_server?: string; chat_id?: string }
}
export interface TelegramActiveChat { botAlias: string; chatId: string; senderId: string; updatedAt: number }
interface Pending extends TelegramActiveChat { request: TelegramPermissionRequest; expiresAt: number }
const active = new Map<string, TelegramActiveChat>()
const pending = new Map<string, Pending>()
const key = (bot: string, chat: string, sender: string): string => `${bot}\0${chat}\0${sender}`
const pendingKey = (bot: string, chat: string, sender: string, id: string): string => `${key(bot, chat, sender)}\0${id.toLowerCase()}`
export function setTelegramActiveChat(botAlias: string, chatId: string, senderId: string): void { active.set(key(botAlias, chatId, senderId), { botAlias, chatId, senderId, updatedAt: Date.now() }) }
export function resolveTelegramActiveChat(chatId?: string): TelegramActiveChat | null {
  const values = [...active.values()].filter(value => !chatId || value.chatId === chatId)
  return values.length === 1 ? values[0]! : null
}
export function saveTelegramPermission(request: TelegramPermissionRequest, target: TelegramActiveChat): void { pending.set(pendingKey(target.botAlias, target.chatId, target.senderId, request.request_id), { ...target, request, expiresAt: Date.now() + 15 * 60_000 }) }
export function parseTelegramPermissionReply(text: string): { behavior: 'allow' | 'deny'; requestId: string } | null {
  const match = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i.exec(text)
  return match ? { behavior: /^y/i.test(match[1]!) ? 'allow' : 'deny', requestId: match[2]!.toLowerCase() } : null
}
export function consumeTelegramPermission(bot: string, chat: string, sender: string, id: string): TelegramPermissionRequest | null {
  const lookup = pendingKey(bot, chat, sender, id)
  const value = pending.get(lookup)
  if (!value || value.expiresAt <= Date.now()) { pending.delete(lookup); return null }
  pending.delete(lookup)
  return value.request
}
export function clearTelegramPermissionStateForTests(): void { active.clear(); pending.clear() }
