import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { EntityLike } from 'telegram/define'
import { z } from 'zod/v4'
import { isTelegramUserRouteAllowed } from './access.js'
import { TelegramUserRuntimeClient } from './client.js'
import { listTelegramUserAccounts, resolveTelegramUserCredentials, type TelegramUserAccountConfig } from './config.js'
import { rememberTelegramUserSentMessage, rememberTelegramUserUpdate } from './dedupe.js'
import { acquireTelegramUserLease, type TelegramUserLease } from './lease.js'
import { saveTelegramUserInboundMedia, validateTelegramUserOutboundFile } from './media.js'
import { consumeTelegramUserPermission, parseTelegramUserPermissionReply, resolveTelegramUserActiveChat, saveTelegramUserPermission, setTelegramUserActiveChat, type TelegramUserPermissionRequest } from './permissions.js'
import { redactTelegramUserError, splitTelegramUserText } from './protocol.js'
import { formatTelegramUserChatId, parseTelegramUserChatId } from './routing.js'
import type { TelegramUserInboundMessage, TelegramUserRoute } from './types.js'

const PermissionSchema = z.object({ method: z.literal('notifications/claude/channel/permission_request'), params: z.object({ request_id: z.string(), tool_name: z.string(), description: z.string(), input_preview: z.string(), channel_context: z.object({ source_server: z.string().optional(), chat_id: z.string().optional() }).optional() }) })
interface ReplyContext { accountAlias: string; chatId: string; senderId: string; messageId: number; route: TelegramUserRoute; inputPeer: EntityLike; createdAt: number }
interface Runtime { clients: Map<string, TelegramUserRuntimeClient>; contexts: Map<string, ReplyContext[]> }
const TTL = 15 * 60_000
const log = (message: string): void => { process.stderr.write(`${message}\n`) }
function contextFor(contexts: Map<string, ReplyContext[]>, chatId: string, messageId?: number, senderId?: string): ReplyContext | null {
  const now = Date.now()
  for (const [id, entries] of contexts) { const valid = entries.filter(entry => now - entry.createdAt <= TTL); if (valid.length) contexts.set(id, valid); else contexts.delete(id) }
  return (contexts.get(chatId) ?? []).filter(entry => (messageId === undefined || entry.messageId === messageId) && (!senderId || entry.senderId === senderId)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}
function numericMessageId(value: unknown): number | undefined { if (value === undefined) return undefined; const result = typeof value === 'number' ? value : Number(value); if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Telegram user message_id is invalid.'); return result }
function permissionText(request: TelegramUserPermissionRequest): string { return `Claude Code needs your approval. This will execute as your Telegram user identity.\n\nTool: ${request.tool_name}\nReason: ${request.description}\nInput: ${request.input_preview}\n\nReply: yes ${request.request_id}\nOr: no ${request.request_id}` }

export function createTelegramUserMcpServer(version: string): Server {
  const server = new Server({ name: 'telegram-user', version }, { capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }, tools: {} }, instructions: 'Use reply with the exact routed chat_id. This executes as the operator Telegram user identity. Proactive sends are unavailable.' })
  const runtime: Runtime = { clients: new Map(), contexts: new Map() }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'reply', description: 'Reply to a live allowlisted Telegram message as your Telegram user identity. Proactive sending is not available.', inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, message_id: { type: ['number', 'string'] }, text: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['chat_id'] } }] as never }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (request.params.name !== 'reply') throw new Error(`Unknown Telegram user tool: ${request.params.name}`)
      const args = request.params.arguments; const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''; const route = parseTelegramUserChatId(chatId)
      const context = route ? contextFor(runtime.contexts, chatId, numericMessageId(args?.message_id)) : null; const client = route ? runtime.clients.get(route.accountAlias) : undefined
      if (!route || !context || !client || context.accountAlias !== route.accountAlias) throw new Error('No live Telegram user reply context exists for this target.')
      const text = typeof args?.text === 'string' ? args.text : ''; const files = Array.isArray(args?.files) ? args.files.filter((value): value is string => typeof value === 'string') : []
      if (!text && !files.length) throw new Error('Telegram user reply requires text or files.')
      let first = true
      for (const chunk of splitTelegramUserText(text)) { const id = await client.sendText(context.inputPeer, chunk, first ? context.messageId : undefined, route.topicId); rememberTelegramUserSentMessage(route.accountAlias, route.peerId, id); first = false }
      for (const file of files) { const id = await client.sendFile(context.inputPeer, validateTelegramUserOutboundFile(file), first ? context.messageId : undefined, route.topicId); rememberTelegramUserSentMessage(route.accountAlias, route.peerId, id); first = false }
      return { content: [{ type: 'text', text: files.length ? 'Telegram user reply and attachments sent.' : 'Telegram user reply sent.' }] }
    } catch (error) { return { content: [{ type: 'text', text: redactTelegramUserError(error) }], isError: true } }
  })
  server.setNotificationHandler(PermissionSchema, async notification => {
    const request = notification.params as TelegramUserPermissionRequest; const target = resolveTelegramUserActiveChat(request.channel_context?.chat_id)
    if (!target) { log(`[telegram-user] Permission ${request.request_id} has no unambiguous active chat.`); return }
    const context = contextFor(runtime.contexts, target.chatId, undefined, target.senderId); const client = runtime.clients.get(target.accountAlias)
    if (!context || !client) return
    saveTelegramUserPermission(request, target)
    try { const id = await client.sendText(context.inputPeer, permissionText(request), context.messageId, context.route.topicId); rememberTelegramUserSentMessage(target.accountAlias, context.route.peerId, id) } catch { log(`[telegram-user:${target.accountAlias}] Permission relay failed.`) }
  })
  Object.assign(server, { __telegramUserRuntime: runtime }); return server
}

async function inbound(server: Server, account: TelegramUserAccountConfig, client: TelegramUserRuntimeClient, runtime: Runtime, message: TelegramUserInboundMessage): Promise<void> {
  if (!rememberTelegramUserUpdate(account.alias, message.updateKey)) return
  const chatId = formatTelegramUserChatId(account.alias, message.peerType, message.peerId, message.topicId); const route = parseTelegramUserChatId(chatId)!
  if (!isTelegramUserRouteAllowed(account.alias, route, message.senderId)) return
  const permission = parseTelegramUserPermissionReply(message.text)
  if (permission) {
    const request = consumeTelegramUserPermission(account.alias, chatId, message.senderId, permission.requestId)
    if (request) { await server.notification({ method: 'notifications/claude/channel/permission', params: { request_id: permission.requestId, behavior: permission.behavior } }); const id = await client.sendText(message.inputPeer, permission.behavior === 'allow' ? 'Permission approved.' : 'Permission denied.', message.messageId, message.topicId); rememberTelegramUserSentMessage(account.alias, message.peerId, id); return }
  }
  const paths: string[] = []; const textParts = [message.text.trim()]
  if (message.attachments.length && message.downloadMedia) {
    try { const data = await message.downloadMedia(); if (data) paths.push(saveTelegramUserInboundMedia(account.alias, message.peerId, message.messageId, data, message.attachments[0]?.fileName)) }
    catch (error) { textParts.push(`[Attachment download failed: ${redactTelegramUserError(error)}]`) }
  }
  const text = textParts.filter(Boolean).join('\n\n') || (paths.length ? '[Telegram user attachment]' : '[Empty Telegram user message]')
  const entries = runtime.contexts.get(chatId) ?? []; entries.push({ accountAlias: account.alias, chatId, senderId: message.senderId, messageId: message.messageId, route, inputPeer: message.inputPeer, createdAt: Date.now() }); runtime.contexts.set(chatId, entries.slice(-20)); setTelegramUserActiveChat(account.alias, chatId, message.senderId)
  await server.notification({ method: 'notifications/claude/channel', params: { content: text, meta: { chat_id: chatId, sender_id: message.senderId, sender_name: message.senderName, account_alias: account.alias, message_id: String(message.messageId), peer_type: message.peerType, peer_id: message.peerId, identity_mode: 'telegram-user', edited: String(message.edited), ...(message.topicId && { topic_id: String(message.topicId) }), ...(message.replyToMessageId && { reply_to_message_id: String(message.replyToMessageId) }), ...(message.attachments.length && { attachments: JSON.stringify(message.attachments) }), ...(paths[0] && { attachment_path: paths[0] }) } } })
}

export async function runTelegramUserMcpServer(version: string): Promise<void> {
  const accounts = listTelegramUserAccounts(); if (!accounts.length) throw new Error('No Telegram user account configured. Run `telegram-user-host account add <alias> <api-id-env> <api-hash-env> <phone-env>` first.')
  const server = createTelegramUserMcpServer(version); const runtime = (server as unknown as { __telegramUserRuntime: Runtime }).__telegramUserRuntime; await server.connect(new StdioServerTransport())
  const controller = new AbortController(); const stop = (): void => { if (!controller.signal.aborted) controller.abort() }
  process.stdin.on('end', stop); process.stdin.on('error', stop); process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop)
  const parent = setInterval(() => { try { process.kill(process.ppid, 0) } catch { stop() } }, 5_000); const leases = new Map<string, TelegramUserLease>()
  try {
    for (const account of accounts) {
      try {
        const lease = acquireTelegramUserLease(account.alias); leases.set(account.alias, lease)
        const client = new TelegramUserRuntimeClient(account, resolveTelegramUserCredentials(account)); await client.start(message => inbound(server, account, client, runtime, message), error => log(`[telegram-user:${account.alias}] ${redactTelegramUserError(error)}`)); runtime.clients.set(account.alias, client); log(`[telegram-user:${account.alias}] MTProto updates started.`)
      } catch (error) { leases.get(account.alias)?.release(); leases.delete(account.alias); log(`[telegram-user:${account.alias}] Failed to start: ${redactTelegramUserError(error)}`) }
    }
    if (!runtime.clients.size) throw new Error('No configured Telegram user account could start.')
    await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }))
  } finally { clearInterval(parent); await Promise.allSettled([...runtime.clients.values()].map(client => client.stop())); for (const lease of leases.values()) lease.release(); await server.close() }
}

