import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { createTelegramPairing, isTelegramUserAllowed } from './access.js'
import { TelegramClient } from './client.js'
import {
  listTelegramBots,
  resolveTelegramToken,
  type TelegramBotConfig,
} from './config.js'
import { rememberTelegramUpdate } from './dedupe.js'
import { acquireTelegramBotLease, type TelegramBotLease } from './lease.js'
import { downloadTelegramAttachment } from './media.js'
import {
  consumeTelegramPermission,
  parseTelegramPermissionReply,
  resolveTelegramActiveChat,
  saveTelegramPermission,
  setTelegramActiveChat,
  type TelegramPermissionRequest,
} from './permissions.js'
import { splitTelegramText } from './protocol.js'
import { formatTelegramChatId, parseTelegramChatId } from './routing.js'
import type { TelegramInboundMessage, TelegramRoute } from './types.js'

const PermissionSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
    channel_context: z
      .object({
        source_server: z.string().optional(),
        chat_id: z.string().optional(),
      })
      .optional(),
  }),
})
interface ReplyContext {
  botAlias: string
  chatId: string
  senderId: string
  messageId: number
  route: TelegramRoute
  createdAt: number
}
interface Runtime {
  clients: Map<string, TelegramClient>
  contexts: Map<string, ReplyContext[]>
}
const TTL = 15 * 60_000
const log = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

function contextFor(
  contexts: Map<string, ReplyContext[]>,
  chatId: string,
  messageId?: number,
  senderId?: string,
): ReplyContext | null {
  const now = Date.now()
  for (const [id, entries] of contexts) {
    const valid = entries.filter(entry => now - entry.createdAt <= TTL)
    if (valid.length) contexts.set(id, valid)
    else contexts.delete(id)
  }
  return (
    (contexts.get(chatId) ?? [])
      .filter(
        entry =>
          (messageId === undefined || entry.messageId === messageId) &&
          (!senderId || entry.senderId === senderId),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}
function permissionText(request: TelegramPermissionRequest): string {
  return `Claude Code needs your approval.\n\nTool: ${request.tool_name}\nReason: ${request.description}\nInput: ${request.input_preview}\n\nReply: yes ${request.request_id}\nOr: no ${request.request_id}`
}
function numericMessageId(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error('Telegram message_id is invalid.')
  return result
}

export function createTelegramMcpServer(version: string): Server {
  const server = new Server(
    { name: 'telegram', version },
    {
      capabilities: {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: {},
      },
      instructions:
        'Use reply or send_typing with the exact Telegram routed chat_id. All sends require a live inbound context.',
    },
  )
  const runtime: Runtime = { clients: new Map(), contexts: new Map() }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'reply',
        _meta: { 'anthropic/alwaysLoad': true },
        description:
          'Reply to the originating Telegram message. Proactive sending is not available.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string' },
            message_id: { type: ['number', 'string'] },
            text: { type: 'string' },
            files: { type: 'array', items: { type: 'string' } },
          },
          required: ['chat_id', 'text'],
        },
      },
      {
        name: 'send_typing',
        description:
          'Send a Telegram typing action to the originating live chat.',
        inputSchema: {
          type: 'object',
          properties: { chat_id: { type: 'string' } },
          required: ['chat_id'],
        },
      },
    ] as never,
  }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const args = request.params.arguments
      const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
      const route = parseTelegramChatId(chatId)
      const context = route
        ? contextFor(
            runtime.contexts,
            chatId,
            numericMessageId(args?.message_id),
          )
        : null
      const client = route ? runtime.clients.get(route.botAlias) : undefined
      if (!route || !context || !client)
        throw new Error(
          'No live Telegram reply context exists for this target.',
        )
      if (request.params.name === 'send_typing') {
        await client.sendTyping(route)
        return {
          content: [{ type: 'text', text: 'Telegram typing action sent.' }],
        }
      }
      if (request.params.name !== 'reply')
        throw new Error(`Unknown Telegram tool: ${request.params.name}`)
      const text = typeof args?.text === 'string' ? args.text : ''
      const files = Array.isArray(args?.files)
        ? args.files.filter(
            (value): value is string => typeof value === 'string',
          )
        : []
      if (!text && !files.length)
        throw new Error('Telegram reply requires text or files.')
      let first = true
      for (const chunk of splitTelegramText(text)) {
        await client.sendText(
          route,
          chunk,
          first ? context.messageId : undefined,
        )
        first = false
      }
      for (const path of files) {
        await client.sendFile(
          route,
          path,
          first ? context.messageId : undefined,
        )
        first = false
      }
      return {
        content: [
          {
            type: 'text',
            text: files.length
              ? 'Telegram reply and attachments sent.'
              : 'Telegram reply sent.',
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  })
  server.setNotificationHandler(PermissionSchema, async notification => {
    const request = notification.params as TelegramPermissionRequest
    const target = resolveTelegramActiveChat(request.channel_context?.chat_id)
    if (!target) {
      log(
        `[telegram] Permission ${request.request_id} has no unambiguous active chat.`,
      )
      return
    }
    const route = parseTelegramChatId(target.chatId)
    const context = contextFor(
      runtime.contexts,
      target.chatId,
      undefined,
      target.senderId,
    )
    const client = runtime.clients.get(target.botAlias)
    if (!route || !context || !client) return
    saveTelegramPermission(request, target)
    try {
      await client.sendText(route, permissionText(request), context.messageId)
    } catch {
      log(`[telegram:${target.botAlias}] Permission relay failed.`)
    }
  })
  Object.assign(server, { __telegramRuntime: runtime })
  return server
}

async function inbound(
  server: Server,
  bot: TelegramBotConfig,
  token: string,
  client: TelegramClient,
  runtime: Runtime,
  message: TelegramInboundMessage,
): Promise<void> {
  if (!rememberTelegramUpdate(bot.alias, message.updateId)) return
  const chatId = formatTelegramChatId(
    bot.alias,
    message.scope,
    message.chatId,
    message.topicId,
  )
  const route = parseTelegramChatId(chatId)!
  if (!isTelegramUserAllowed(bot.alias, message.senderId)) {
    const code = createTelegramPairing(bot.alias, message.senderId)
    await client.sendText(
      route,
      `Access is not enabled. Ask the operator to run:\ntelegram-host access pair ${bot.alias} ${code}`,
      message.messageId,
    )
    return
  }
  const permission = parseTelegramPermissionReply(message.text)
  if (permission) {
    const request = consumeTelegramPermission(
      bot.alias,
      chatId,
      message.senderId,
      permission.requestId,
    )
    if (request) {
      await server.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: permission.requestId,
          behavior: permission.behavior,
        },
      })
      await client.sendText(
        route,
        permission.behavior === 'allow'
          ? 'Permission approved.'
          : 'Permission denied.',
        message.messageId,
      )
      return
    }
  }
  const paths: string[] = []
  const textParts = [message.text.trim()]
  for (const attachment of message.attachments) {
    try {
      paths.push(
        await downloadTelegramAttachment(
          token,
          attachment,
          bot.alias,
          message.chatId,
          message.messageId,
          fileId => client.getFile(fileId),
          client.transportFetch,
        ),
      )
    } catch (error) {
      textParts.push(
        `[Attachment download failed: ${error instanceof Error ? error.message : String(error)}]`,
      )
    }
  }
  const text =
    textParts.filter(Boolean).join('\n\n') ||
    (paths.length ? '[Telegram attachment]' : '[Empty Telegram message]')
  const entries = runtime.contexts.get(chatId) ?? []
  entries.push({
    botAlias: bot.alias,
    chatId,
    senderId: message.senderId,
    messageId: message.messageId,
    route,
    createdAt: Date.now(),
  })
  runtime.contexts.set(chatId, entries.slice(-20))
  setTelegramActiveChat(bot.alias, chatId, message.senderId)
  await server.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: {
        chat_id: chatId,
        sender_id: message.senderId,
        sender_name: message.senderName,
        bot_alias: bot.alias,
        message_id: String(message.messageId),
        update_id: String(message.updateId),
        chat_type: message.scope,
        ...(message.topicId && { topic_id: String(message.topicId) }),
        ...(message.replyToMessageId && {
          reply_to_message_id: String(message.replyToMessageId),
        }),
        ...(message.attachments.length && {
          attachments: JSON.stringify(
            message.attachments.map(({ kind, fileName, mimeType, size }) => ({
              kind,
              fileName,
              mimeType,
              size,
            })),
          ),
        }),
        ...(paths[0] && { attachment_path: paths[0] }),
        ...(paths.length > 1 && { attachment_paths: JSON.stringify(paths) }),
      },
    },
  })
}

export async function runTelegramMcpServer(version: string): Promise<void> {
  const bots = listTelegramBots()
  if (!bots.length)
    throw new Error(
      'No Telegram bot configured. Run `telegram-host bot add <alias> <token-env>` first.',
    )
  const resolved = bots.map(bot => ({ bot, token: resolveTelegramToken(bot) }))
  const duplicateTokens = new Set<string>()
  for (const item of resolved) {
    if (duplicateTokens.has(item.token))
      throw new Error(
        'The same Telegram Bot Token is configured more than once.',
      )
    duplicateTokens.add(item.token)
  }
  const server = createTelegramMcpServer(version)
  const runtime = (server as unknown as { __telegramRuntime: Runtime })
    .__telegramRuntime
  await server.connect(new StdioServerTransport())
  const controller = new AbortController()
  const stop = (): void => {
    if (!controller.signal.aborted) controller.abort()
  }
  process.stdin.on('end', stop)
  process.stdin.on('error', stop)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('SIGHUP', stop)
  const parent = setInterval(() => {
    try {
      process.kill(process.ppid, 0)
    } catch {
      stop()
    }
  }, 5_000)
  const leases = new Map<string, TelegramBotLease>()
  try {
    for (const { bot, token } of resolved) {
      try {
        const lease = acquireTelegramBotLease(bot.alias)
        leases.set(bot.alias, lease)
        const client = new TelegramClient(bot.alias, token)
        await client.doctor()
        runtime.clients.set(bot.alias, client)
        await client.start(
          message => inbound(server, bot, token, client, runtime, message),
          error => log(`[telegram:${bot.alias}] ${error.message}`),
          () => {
            runtime.clients.delete(bot.alias)
            leases.get(bot.alias)?.release()
            leases.delete(bot.alias)
            if (!runtime.clients.size) stop()
          },
        )
        log(`[telegram:${bot.alias}] Long polling started.`)
      } catch (error) {
        leases.get(bot.alias)?.release()
        leases.delete(bot.alias)
        log(
          `[telegram:${bot.alias}] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (!runtime.clients.size)
      throw new Error('No configured Telegram Bot could start long polling.')
    await new Promise<void>(resolve =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    )
  } finally {
    clearInterval(parent)
    await Promise.allSettled(
      [...runtime.clients.values()].map(client => client.stop()),
    )
    for (const lease of leases.values()) lease.release()
    await server.close()
  }
}
