/** Mirrors ChannelPermissionRequestParams from src/services/mcp/channelNotification.ts */
export interface ChannelPermissionRequestParams {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
  channel_context?: {
    source_server?: string
    chat_id?: string
  }
}

export type PendingPermissionRequest = ChannelPermissionRequestParams & {
  accountId: string
  chatId: string
  contextToken?: string
  createdAt: number
  expiresAt: number
}

export type ActivePermissionChat = {
  accountId: string
  chatId: string
  contextToken?: string
  updatedAt: number
}

const PENDING_PERMISSION_TTL_MS = 15 * 60 * 1000

const pendingPermissions = new Map<string, PendingPermissionRequest>()
const activePermissionChats = new Map<string, ActivePermissionChat>()

function pruneExpiredPendingPermissions(now = Date.now()): void {
  for (const [requestId, entry] of pendingPermissions.entries()) {
    if (entry.expiresAt <= now) {
      pendingPermissions.delete(requestId)
    }
  }
}

export function setActivePermissionChat(
  accountId: string,
  chatId: string,
  contextToken?: string,
): void {
  activePermissionChats.set(accountId, {
    accountId,
    chatId,
    contextToken,
    updatedAt: Date.now(),
  })
}

function pendingKey(accountId: string, requestId: string): string {
  return `${accountId}\u0000${requestId.toLowerCase()}`
}

export function getActivePermissionChat(accountId?: string): ActivePermissionChat | null {
  if (accountId) return activePermissionChats.get(accountId) ?? null
  const active = [...activePermissionChats.values()]
  if (active.length !== 1) return null
  return active[0] ?? null
}

export function savePendingPermission(
  request: ChannelPermissionRequestParams,
  accountId: string,
  chatId: string,
  contextToken?: string,
): PendingPermissionRequest {
  pruneExpiredPendingPermissions()
  const entry: PendingPermissionRequest = {
    ...request,
    accountId,
    chatId,
    contextToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_PERMISSION_TTL_MS,
  }
  pendingPermissions.set(pendingKey(accountId, request.request_id), entry)
  return entry
}

export function consumePendingPermission(
  requestId: string,
  accountId: string,
  fromUserId: string,
): PendingPermissionRequest | null {
  pruneExpiredPendingPermissions()
  const key = pendingKey(accountId, requestId)
  const entry = pendingPermissions.get(key)
  if (!entry) return null
  if (entry.accountId !== accountId || entry.chatId !== fromUserId) return null
  pendingPermissions.delete(key)
  return entry
}

export function clearPermissionStateForTests(): void {
  pendingPermissions.clear()
  activePermissionChats.clear()
}
