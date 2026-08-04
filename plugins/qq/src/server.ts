import { existsSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { createQqPairing, isQqUserAllowed } from './access.js'
import { QqApiClient } from './api.js'
import { listQqBots, resolveQqSecret, type QqBotConfig } from './config.js'
import { rememberQqMessage } from './dedupe.js'
import { QqGateway } from './gateway.js'
import { acquireQqBotLease, type QqBotLease } from './lease.js'
import { downloadQqAttachment } from './media.js'
import {
  consumeQqPermission,
  parseQqPermissionReply,
  resolveQqActiveChat,
  saveQqPermission,
  setQqActiveChat,
  type QqPermissionRequest,
} from './permissions.js'
import { splitQqText } from './protocol.js'
import { formatQqChatId, parseQqChatId } from './routing.js'
import type { QqInboundMessage } from './types.js'

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
  messageId: string
  createdAt: number
}
interface Runtime {
  gateways: Map<string, QqGateway>
  apis: Map<string, QqApiClient>
  contexts: Map<string, ReplyContext[]>
}
const TTL = 15 * 60_000
const log = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

function contextFor(
  contexts: Map<string, ReplyContext[]>,
  chatId: string,
  messageId?: string,
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
          (!messageId || entry.messageId === messageId) &&
          (!senderId || entry.senderId === senderId),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}
function permissionText(request: QqPermissionRequest): string {
  return `Claude Code needs your approval.\n\nTool: ${request.tool_name}\nReason: ${request.description}\nInput: ${request.input_preview}\n\nReply: yes ${request.request_id}\nOr: no ${request.request_id}`
}

export function createQqMcpServer(version: string): Server {
  const server = new Server(
    { name: 'qq', version },
    {
      capabilities: {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: {},
      },
      instructions:
        'Use reply with the exact QQ routed chat_id. All sends are passive and require a live inbound message context.',
    },
  )
  const runtime: Runtime = {
    gateways: new Map(),
    apis: new Map(),
    contexts: new Map(),
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'reply',
        _meta: { 'anthropic/alwaysLoad': true },
        description:
          'Reply to the originating QQ C2C/group message. Proactive sending is not available.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string' },
            message_id: { type: 'string' },
            text: { type: 'string' },
            files: { type: 'array', items: { type: 'string' } },
          },
          required: ['chat_id', 'text'],
        },
      },
    ] as never,
  }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (request.params.name !== 'reply')
        throw new Error(`Unknown QQ tool: ${request.params.name}`)
      const args = request.params.arguments
      const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
      const messageId =
        typeof args?.message_id === 'string' ? args.message_id : undefined
      const text = typeof args?.text === 'string' ? args.text : ''
      const files = Array.isArray(args?.files)
        ? args.files.filter(
            (value): value is string => typeof value === 'string',
          )
        : []
      const route = parseQqChatId(chatId)
      if (!route || !text)
        throw new Error('QQ reply requires a valid chat_id and text.')
      const context = contextFor(runtime.contexts, chatId, messageId)
      const api = runtime.apis.get(route.botAlias)
      if (!context || !api || !runtime.gateways.get(route.botAlias)?.isReady())
        throw new Error(
          'No live QQ reply context or Gateway exists for this target.',
        )
      let part = 0
      for (const chunk of splitQqText(text))
        await api.sendText(
          route.scope,
          route.targetId,
          context.messageId,
          chunk,
          part++,
        )
      for (const path of files) {
        if (!existsSync(path))
          throw new Error(`QQ attachment not found: ${path}`)
        await api.sendMedia(
          route.scope,
          route.targetId,
          context.messageId,
          path,
          part++,
        )
      }
      return {
        content: [
          {
            type: 'text',
            text: files.length
              ? 'QQ reply and attachments sent.'
              : 'QQ reply sent.',
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
    const request = notification.params as QqPermissionRequest
    const target = resolveQqActiveChat(request.channel_context?.chat_id)
    if (!target) {
      log(
        `[qq] Permission ${request.request_id} has no unambiguous active chat.`,
      )
      return
    }
    const route = parseQqChatId(target.chatId)
    const context = contextFor(
      runtime.contexts,
      target.chatId,
      undefined,
      target.senderId,
    )
    const api = runtime.apis.get(target.botAlias)
    if (!route || !context || !api) return
    saveQqPermission(request, target)
    try {
      await api.sendText(
        route.scope,
        route.targetId,
        context.messageId,
        permissionText(request),
        500,
      )
    } catch (error) {
      log(`[qq:${target.botAlias}] Permission relay failed: ${error}`)
    }
  })
  Object.assign(server, { __qqRuntime: runtime })
  return server
}

async function inbound(
  server: Server,
  bot: QqBotConfig,
  api: QqApiClient,
  runtime: Runtime,
  message: QqInboundMessage,
): Promise<void> {
  if (!rememberQqMessage(bot.alias, message.messageId)) return
  const chatId = formatQqChatId(bot.alias, message.scope, message.targetId)
  if (!isQqUserAllowed(bot.alias, message.senderId)) {
    const code = createQqPairing(bot.alias, message.senderId)
    await api.sendText(
      message.scope,
      message.targetId,
      message.messageId,
      `Access is not enabled. Ask the operator to run:\nqq-host access pair ${bot.alias} ${code}`,
      0,
    )
    return
  }
  const permission = parseQqPermissionReply(message.content)
  if (permission) {
    const request = consumeQqPermission(
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
      await api.sendText(
        message.scope,
        message.targetId,
        message.messageId,
        permission.behavior === 'allow'
          ? 'Permission approved.'
          : 'Permission denied.',
        0,
      )
      return
    }
  }
  const paths: string[] = []
  const textParts = [message.content.trim()]
  for (const attachment of message.attachments) {
    if (attachment.asr_refer_text?.trim())
      textParts.push(`[Voice recognition] ${attachment.asr_refer_text.trim()}`)
    try {
      paths.push(
        await downloadQqAttachment(attachment, bot.alias, message.messageId),
      )
    } catch (error) {
      textParts.push(
        `[Attachment download failed: ${error instanceof Error ? error.message : String(error)}]`,
      )
    }
  }
  const text =
    textParts.filter(Boolean).join('\n\n') ||
    (paths.length ? '[QQ attachment]' : '[Empty QQ message]')
  const entries = runtime.contexts.get(chatId) ?? []
  entries.push({
    botAlias: bot.alias,
    chatId,
    senderId: message.senderId,
    messageId: message.messageId,
    createdAt: Date.now(),
  })
  runtime.contexts.set(chatId, entries.slice(-20))
  setQqActiveChat(bot.alias, chatId, message.senderId)
  await server.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: {
        chat_id: chatId,
        sender_id: message.senderId,
        bot_alias: bot.alias,
        message_id: message.messageId,
        chat_type: message.scope,
        ...(paths[0] && { attachment_path: paths[0] }),
        ...(paths.length > 1 && { attachment_paths: JSON.stringify(paths) }),
      },
    },
  })
}

export async function runQqMcpServer(version: string): Promise<void> {
  const bots = listQqBots()
  if (!bots.length)
    throw new Error(
      'No QQ bot configured. Run `qq-host bot add <alias> <app-id> <secret-env>` first.',
    )
  const server = createQqMcpServer(version)
  const runtime = (server as unknown as { __qqRuntime: Runtime }).__qqRuntime
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
  const leases: QqBotLease[] = []
  try {
    for (const bot of bots) leases.push(acquireQqBotLease(bot.alias))
    for (const bot of bots) {
      const secret = resolveQqSecret(bot)
      const api = new QqApiClient(bot, secret)
      const gateway = new QqGateway({
        alias: bot.alias,
        api,
        onReady: () => log(`[qq:${bot.alias}] Gateway ready.`),
        onError: error =>
          log(
            `[qq:${bot.alias}] ${error.message.split(secret).join('[REDACTED]')}`,
          ),
        onDisconnected: reason =>
          log(`[qq:${bot.alias}] Disconnected: ${reason}`),
        onMessage: message => inbound(server, bot, api, runtime, message),
      })
      runtime.apis.set(bot.alias, api)
      runtime.gateways.set(bot.alias, gateway)
      gateway.start()
    }
    await new Promise<void>(resolve =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    )
  } finally {
    clearInterval(parent)
    for (const gateway of runtime.gateways.values()) gateway.stop()
    for (const lease of leases) lease.release()
    await server.close()
  }
}
