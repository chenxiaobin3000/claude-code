export interface ChannelPermissionRequest {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
  channel_context?: { source_server?: string; chat_id?: string }
}

interface ActiveChat {
  botAlias: string
  chatId: string
  senderId: string
  updatedAt: number
}

interface PendingPermission extends ActiveChat {
  request: ChannelPermissionRequest
  expiresAt: number
}

const activeChats = new Map<string, ActiveChat>()
const pending = new Map<string, PendingPermission>()
const TTL_MS = 15 * 60_000

function activeKey(botAlias: string, chatId: string, senderId: string): string {
  return `${botAlias}\u0000${chatId}\u0000${senderId}`
}

function pendingKey(botAlias: string, chatId: string, senderId: string, requestId: string): string {
  return `${activeKey(botAlias, chatId, senderId)}\u0000${requestId.toLowerCase()}`
}

function prune(now = Date.now()): void {
  for (const [key, value] of pending) if (value.expiresAt <= now) pending.delete(key)
}

export function setActivePermissionChat(botAlias: string, chatId: string, senderId: string): void {
  activeChats.set(activeKey(botAlias, chatId, senderId), { botAlias, chatId, senderId, updatedAt: Date.now() })
}

export function resolveActivePermissionChat(chatId?: string): ActiveChat | null {
  const values = [...activeChats.values()].filter(item => !chatId || item.chatId === chatId)
  return values.length === 1 ? values[0]! : null
}

export function savePendingPermission(request: ChannelPermissionRequest, target: ActiveChat): void {
  prune()
  pending.set(pendingKey(target.botAlias, target.chatId, target.senderId, request.request_id), {
    ...target,
    request,
    expiresAt: Date.now() + TTL_MS,
  })
}

export function parsePermissionReply(text: string): { behavior: 'allow' | 'deny'; requestId: string } | null {
  const match = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i.exec(text)
  if (!match) return null
  return {
    behavior: /^y/i.test(match[1]!) ? 'allow' : 'deny',
    requestId: match[2]!.toLowerCase(),
  }
}

export function consumePendingPermission(botAlias: string, chatId: string, senderId: string, requestId: string): ChannelPermissionRequest | null {
  prune()
  const key = pendingKey(botAlias, chatId, senderId, requestId)
  const value = pending.get(key)
  if (!value) return null
  pending.delete(key)
  return value.request
}

export function clearPermissionStateForTests(): void {
  activeChats.clear()
  pending.clear()
}
