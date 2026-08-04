export interface TelegramUserPermissionRequest { request_id: string; tool_name: string; description: string; input_preview: string; channel_context?: { source_server?: string; chat_id?: string } }
export interface TelegramUserActiveChat { accountAlias: string; chatId: string; senderId: string; updatedAt: number }
interface Pending extends TelegramUserActiveChat { request: TelegramUserPermissionRequest; expiresAt: number }
const active = new Map<string, TelegramUserActiveChat>(); const pending = new Map<string, Pending>()
const key = (account: string, chat: string, sender: string): string => `${account}\0${chat}\0${sender}`
const pendingKey = (account: string, chat: string, sender: string, id: string): string => `${key(account, chat, sender)}\0${id.toLowerCase()}`
export function setTelegramUserActiveChat(accountAlias: string, chatId: string, senderId: string): void { active.set(key(accountAlias, chatId, senderId), { accountAlias, chatId, senderId, updatedAt: Date.now() }) }
export function resolveTelegramUserActiveChat(chatId?: string): TelegramUserActiveChat | null { const values = [...active.values()].filter(value => !chatId || value.chatId === chatId); return values.length === 1 ? values[0]! : null }
export function saveTelegramUserPermission(request: TelegramUserPermissionRequest, target: TelegramUserActiveChat): void { pending.set(pendingKey(target.accountAlias, target.chatId, target.senderId, request.request_id), { ...target, request, expiresAt: Date.now() + 15 * 60_000 }) }
export function parseTelegramUserPermissionReply(text: string): { behavior: 'allow' | 'deny'; requestId: string } | null { const match = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i.exec(text); return match ? { behavior: /^y/i.test(match[1]!) ? 'allow' : 'deny', requestId: match[2]!.toLowerCase() } : null }
export function consumeTelegramUserPermission(account: string, chat: string, sender: string, id: string): TelegramUserPermissionRequest | null { const lookup = pendingKey(account, chat, sender, id); const value = pending.get(lookup); if (!value || value.expiresAt <= Date.now()) { pending.delete(lookup); return null }; pending.delete(lookup); return value.request }
export function clearTelegramUserPermissionStateForTests(): void { active.clear(); pending.clear() }

