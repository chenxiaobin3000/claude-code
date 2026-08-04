import { existsSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { createPairing, isUserAllowed } from './access.js'
import {
  listBots,
  resolveBot,
  resolveBotSecret,
  type WxworkBotConfig,
} from './config.js'
import { WxworkClient } from './client.js'
import { rememberWxworkMessage } from './dedupe.js'
import { acquireWxworkBotLease, type WxworkBotLease } from './lease.js'
import { downloadWxworkMedia, inferWxworkMediaType } from './media.js'
import {
  consumePendingPermission,
  parsePermissionReply,
  resolveActivePermissionChat,
  savePendingPermission,
  setActivePermissionChat,
  type ChannelPermissionRequest,
} from './permissions.js'
import { formatWxworkChatId, parseWxworkChatId } from './routing.js'
import { normalizeWxworkMessage } from './protocol.js'
import {
  WxworkCommand,
  type WxworkFrame,
  type WxworkMessageBody,
} from './types.js'

const ChannelPermissionRequestSchema = z.object({
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
  requestId: string
  createdAt: number
}

const REPLY_CONTEXT_TTL_MS = 15 * 60_000

function log(message: string): void {
  process.stderr.write(`${message}\n`)
}

function formatPermissionRequest(request: ChannelPermissionRequest): string {
  return [
    'Claude Code needs your approval.',
    '',
    `Tool: ${request.tool_name}`,
    `Reason: ${request.description}`,
    `Input: ${request.input_preview}`,
    '',
    `Reply with: yes ${request.request_id}`,
    `Or deny with: no ${request.request_id}`,
  ].join('\n')
}

function pruneReplyContexts(
  contexts: Map<string, ReplyContext[]>,
  now = Date.now(),
): void {
  for (const [chatId, values] of contexts) {
    const active = values.filter(
      value => now - value.createdAt <= REPLY_CONTEXT_TTL_MS,
    )
    if (active.length) contexts.set(chatId, active)
    else contexts.delete(chatId)
  }
}

function resolveReplyContext(
  contexts: Map<string, ReplyContext[]>,
  chatId: string,
  messageId?: string,
  senderId?: string,
): ReplyContext | null {
  pruneReplyContexts(contexts)
  const matches = (contexts.get(chatId) ?? []).filter(
    item =>
      (!messageId || item.messageId === messageId) &&
      (!senderId || item.senderId === senderId),
  )
  return matches.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

function toolDefinitions(): Array<Record<string, unknown>> {
  return [
    {
      name: 'reply',
      _meta: { 'anthropic/alwaysLoad': true },
      description:
        'Reply to the originating WeCom API-mode bot message. Proactive sending is not supported.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'Exact routed chat_id from the Channel notification',
          },
          message_id: {
            type: 'string',
            description:
              'Optional originating message ID when several messages share a chat',
          },
          text: { type: 'string', description: 'Final Markdown reply' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional absolute local file paths',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
  ]
}

export function createWxworkMcpServer(version: string): Server {
  const server = new Server(
    { name: 'wxwork', version },
    {
      capabilities: {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: {},
      },
      instructions:
        'Use reply with the exact routed chat_id. Replies are passive and bound to the latest unexpired inbound request. Never guess a bot or chat.',
    },
  )
  const clients = new Map<string, WxworkClient>()
  const contexts = new Map<string, ReplyContext[]>()

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions() as never,
  }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (request.params.name !== 'reply')
        throw new Error(`Unknown wxwork tool: ${request.params.name}`)
      const args = request.params.arguments
      const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
      const text = typeof args?.text === 'string' ? args.text : ''
      const messageId =
        typeof args?.message_id === 'string' ? args.message_id : undefined
      const files = Array.isArray(args?.files)
        ? args.files.filter(
            (value): value is string => typeof value === 'string',
          )
        : []
      if (!chatId || !text)
        throw new Error('wxwork reply requires chat_id and text.')
      const route = parseWxworkChatId(chatId)
      if (!route) throw new Error('Invalid wxwork routed chat_id.')
      const client = clients.get(route.botAlias)
      if (!client?.isAuthenticated())
        throw new Error(`wxwork bot ${route.botAlias} is not authenticated.`)
      const context = resolveReplyContext(contexts, chatId, messageId)
      if (!context)
        throw new Error(
          'No unexpired wxwork reply context exists for this chat/message.',
        )
      for (const path of files) {
        if (!existsSync(path))
          throw new Error(`wxwork attachment not found: ${path}`)
        const type = inferWxworkMediaType(path)
        const uploaded = await client.uploadMedia(path, type)
        await client.replyMedia(context.requestId, type, uploaded.mediaId)
      }
      await client.replyFinal(context.requestId, text)
      return {
        content: [
          {
            type: 'text',
            text: files.length
              ? 'WeCom reply and attachments sent.'
              : 'WeCom reply sent.',
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

  server.setNotificationHandler(
    ChannelPermissionRequestSchema,
    async notification => {
      const request = notification.params as ChannelPermissionRequest
      const target = resolveActivePermissionChat(
        request.channel_context?.chat_id,
      )
      if (!target) {
        log(
          `[wxwork] Permission request ${request.request_id} has no unambiguous active chat.`,
        )
        return
      }
      const context = resolveReplyContext(
        contexts,
        target.chatId,
        undefined,
        target.senderId,
      )
      const client = clients.get(target.botAlias)
      if (!context || !client?.isAuthenticated()) {
        log(
          `[wxwork:${target.botAlias}] Permission request ${request.request_id} has no live reply context.`,
        )
        return
      }
      savePendingPermission(request, target)
      try {
        await client.replyFinal(
          context.requestId,
          formatPermissionRequest(request),
        )
      } catch (error) {
        log(
          `[wxwork:${target.botAlias}] Failed to relay permission request ${request.request_id}: ${error}`,
        )
      }
    },
  )

  Object.assign(server, { __wxworkRuntime: { clients, contexts } })
  return server
}

async function handleInbound(
  server: Server,
  bot: WxworkBotConfig,
  client: WxworkClient,
  contexts: Map<string, ReplyContext[]>,
  frame: WxworkFrame,
): Promise<void> {
  if (frame.cmd !== WxworkCommand.MessageCallback) return
  const message = normalizeWxworkMessage(frame.body as WxworkMessageBody)
  if (message.botId !== bot.botId)
    throw new Error(
      `Callback bot ID does not match configured bot ${bot.alias}.`,
    )
  if (!rememberWxworkMessage(bot.alias, message.messageId)) return
  const chatId = formatWxworkChatId(
    bot.alias,
    message.chatType,
    message.targetId,
  )

  if (!isUserAllowed(bot.alias, message.senderId)) {
    const code = createPairing(bot.alias, message.senderId)
    await client.replyFinal(
      frame.headers.req_id,
      `Access is not enabled. Ask the operator to run:\nwxwork-host access pair ${bot.alias} ${code}`,
    )
    return
  }

  const permission = parsePermissionReply(message.text)
  if (permission) {
    const accepted = consumePendingPermission(
      bot.alias,
      chatId,
      message.senderId,
      permission.requestId,
    )
    if (accepted) {
      await server.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: permission.requestId,
          behavior: permission.behavior,
        },
      })
      await client.replyFinal(
        frame.headers.req_id,
        permission.behavior === 'allow'
          ? 'Permission approved.'
          : 'Permission denied.',
      )
      return
    }
  }

  const attachmentPaths: string[] = []
  for (const reference of message.media) {
    try {
      attachmentPaths.push(
        await downloadWxworkMedia(reference, bot.alias, message.messageId),
      )
    } catch (error) {
      message.text += `\n\n[Attachment download failed: ${error instanceof Error ? error.message : String(error)}]`
    }
  }
  const context: ReplyContext = {
    botAlias: bot.alias,
    chatId,
    senderId: message.senderId,
    messageId: message.messageId,
    requestId: frame.headers.req_id,
    createdAt: Date.now(),
  }
  const entries = contexts.get(chatId) ?? []
  entries.push(context)
  contexts.set(chatId, entries.slice(-20))
  setActivePermissionChat(bot.alias, chatId, message.senderId)
  await server.notification({
    method: 'notifications/claude/channel',
    params: {
      content: message.text,
      meta: {
        chat_id: chatId,
        sender_id: message.senderId,
        bot_alias: bot.alias,
        message_id: message.messageId,
        chat_type: message.chatType,
        ...(attachmentPaths[0] && { attachment_path: attachmentPaths[0] }),
        ...(attachmentPaths.length > 1 && {
          attachment_paths: JSON.stringify(attachmentPaths),
        }),
      },
    },
  })
}

export async function runWxworkMcpServer(version: string): Promise<void> {
  const bots = listBots()
  if (bots.length === 0)
    throw new Error(
      'No wxwork bot configured. Run `wxwork-host bot add <alias> <bot-id> <secret-env>` first.',
    )
  const server = createWxworkMcpServer(version)
  const runtime = (
    server as unknown as {
      __wxworkRuntime: {
        clients: Map<string, WxworkClient>
        contexts: Map<string, ReplyContext[]>
      }
    }
  ).__wxworkRuntime
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
  const ppid = process.ppid
  const parentCheck = setInterval(() => {
    try {
      process.kill(ppid, 0)
    } catch {
      stop()
    }
  }, 5_000)
  const leases: WxworkBotLease[] = []

  try {
    for (const bot of bots) leases.push(acquireWxworkBotLease(bot.alias))
    for (const bot of bots) {
      let client: WxworkClient
      client = new WxworkClient({
        botId: bot.botId,
        secret: resolveBotSecret(bot),
        wsUrl: bot.wsUrl,
        callbacks: {
          onAuthenticated: () => log(`[wxwork:${bot.alias}] Authenticated.`),
          onDisconnected: reason =>
            log(`[wxwork:${bot.alias}] Disconnected: ${reason}`),
          onError: error => log(`[wxwork:${bot.alias}] ${error.message}`),
          onFrame: async (frame): Promise<void> => {
            await handleInbound(server, bot, client, runtime.contexts, frame)
          },
        },
      })
      runtime.clients.set(bot.alias, client)
      client.connect()
    }
    await new Promise<void>(resolve =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    )
  } finally {
    clearInterval(parentCheck)
    for (const client of runtime.clients.values()) client.disconnect()
    for (const lease of leases) lease.release()
    await server.close()
  }
}
