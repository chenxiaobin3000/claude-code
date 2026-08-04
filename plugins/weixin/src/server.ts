import { existsSync, rmSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import {
  CDN_BASE_URL,
  DEFAULT_BASE_URL,
  downloadRemoteToTemp,
  formatRoutedChatId,
  getActivePermissionChat,
  getConfig,
  getContextToken,
  listAccounts,
  listAccountStateFiles,
  loadAccount,
  loadAllAccounts,
  loadFeatureConfig,
  notifyStart,
  notifyStop,
  parseRoutedChatId,
  resolveAccountId,
  savePendingPermission,
  sendMediaFile,
  sendText,
  sendTyping,
  startPollLoop,
  TypingStatus,
  type AccountData,
} from './index.js'
import type { ParsedMessage } from './monitor.js'
import type { ChannelPermissionRequestParams } from './permissions.js'

const ChannelPermissionRequestNotificationSchema = z.object({
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

function log(message: string): void {
  process.stderr.write(`${message}\n`)
}

function formatPermissionRequestMessage(
  request: ChannelPermissionRequestParams,
): string {
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

export function resolveWeixinToolTarget(
  chatId: string,
  requestedAccountId?: string,
): { account: AccountData; userId: string } {
  const routed = parseRoutedChatId(chatId)
  if (routed && requestedAccountId && routed.accountId !== requestedAccountId) {
    throw new Error('account_id does not match the routed chat_id.')
  }
  const accountId = routed?.accountId ?? resolveAccountId(requestedAccountId)
  if (!accountId) throw new Error('No WeChat account is configured.')
  const account = loadAccount(accountId)
  if (!account) throw new Error(`WeChat account is not connected: ${accountId}`)
  return { account, userId: routed?.userId ?? chatId }
}

function toolDefinitions(): Array<Record<string, unknown>> {
  const commonAccountProperty = {
    type: 'string',
    description:
      'Account ID. Required with an unqualified chat_id when multiple accounts exist.',
  }
  const tools: Array<Record<string, unknown>> = [
    {
      name: 'reply',
      _meta: { 'anthropic/alwaysLoad': true },
      description: 'Reply to a WeChat message using its routed chat_id.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The chat_id from the channel notification',
          },
          account_id: commonAccountProperty,
          text: { type: 'string', description: 'The reply text' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional absolute paths, or HTTP(S) URLs when remoteHttpMedia is enabled',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'send_typing',
      description: 'Send a typing indicator to a WeChat user.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'The routed chat_id' },
          account_id: commonAccountProperty,
        },
        required: ['chat_id'],
      },
    },
  ]
  if (
    listAccounts().some(
      account => loadFeatureConfig(account.accountId).channelDiagnostics,
    )
  ) {
    tools.push({
      name: 'diagnostics',
      description: 'Show redacted WeChat account and local state diagnostics.',
      inputSchema: {
        type: 'object',
        properties: { account_id: commonAccountProperty },
      },
    })
  }
  return tools
}

export function createWeixinMcpServer(version: string): Server {
  const server = new Server(
    { name: 'weixin', version },
    {
      capabilities: {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: {},
      },
      instructions:
        'Messages arrive with a routed chat_id formatted as account::user. Reply with that exact chat_id. Never guess an account when routing is ambiguous. Use absolute paths for local attachments.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions() as never,
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params
    try {
      if (name === 'diagnostics') {
        const requested =
          typeof args?.account_id === 'string' ? args.account_id : undefined
        const accountId = resolveAccountId(requested)
        if (!accountId) throw new Error('No WeChat account is configured.')
        const account = loadAccount(accountId)
        if (!account)
          throw new Error(`WeChat account is not connected: ${accountId}`)
        const features = loadFeatureConfig(accountId)
        if (!features.channelDiagnostics)
          throw new Error('channelDiagnostics is disabled for this account.')
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId,
                  userId: account.userId ?? null,
                  baseUrl: new URL(account.baseUrl).origin,
                  savedAt: account.savedAt,
                  features,
                  stateFiles: listAccountStateFiles(accountId).filter(
                    file => file !== 'account.json',
                  ),
                },
                null,
                2,
              ),
            },
          ],
        }
      }

      const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
      const requestedAccountId =
        typeof args?.account_id === 'string' ? args.account_id : undefined
      if (!chatId) throw new Error('Missing chat_id parameter.')
      const { account, userId } = resolveWeixinToolTarget(
        chatId,
        requestedAccountId,
      )
      const accountId = account.accountId
      const baseUrl = account.baseUrl || DEFAULT_BASE_URL
      const contextToken = getContextToken(userId, accountId) || ''

      if (name === 'reply') {
        const text = typeof args?.text === 'string' ? args.text : ''
        const files = Array.isArray(args?.files)
          ? args.files.filter(
              (value): value is string => typeof value === 'string',
            )
          : []
        if (!text) throw new Error('Missing text parameter.')
        const features = loadFeatureConfig(accountId)
        const temporaryFiles: string[] = []
        try {
          for (const [index, source] of files.entries()) {
            const isRemote = /^https?:\/\//i.test(source)
            if (isRemote && !features.remoteHttpMedia) {
              throw new Error(
                `Remote HTTP media is disabled for account ${accountId}.`,
              )
            }
            const filePath = isRemote
              ? await downloadRemoteToTemp(source)
              : source
            if (isRemote) temporaryFiles.push(filePath)
            if (!existsSync(filePath))
              throw new Error(`File not found: ${filePath}`)
            await sendMediaFile({
              filePath,
              to: userId,
              text: index === 0 ? text : '',
              baseUrl,
              token: account.token,
              contextToken,
              cdnBaseUrl: CDN_BASE_URL,
              accountId,
            })
          }
          if (files.length === 0) {
            await sendText({
              to: userId,
              text,
              baseUrl,
              token: account.token,
              contextToken,
              accountId,
            })
          }
        } finally {
          for (const path of temporaryFiles) rmSync(path, { force: true })
        }
        return {
          content: [
            {
              type: 'text',
              text: files.length
                ? 'Message sent with attachments.'
                : 'Message sent.',
            },
          ],
        }
      }

      if (name === 'send_typing') {
        const config = await getConfig(
          baseUrl,
          account.token,
          userId,
          contextToken,
          accountId,
        )
        if (config.typing_ticket) {
          await sendTyping(
            baseUrl,
            account.token,
            {
              ilink_user_id: userId,
              typing_ticket: config.typing_ticket,
              status: TypingStatus.TYPING,
            },
            accountId,
          )
        }
        return { content: [{ type: 'text', text: 'Typing indicator sent.' }] }
      }

      throw new Error(`Unknown tool: ${name}`)
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

  return server
}

export async function runWeixinMcpServer(version: string): Promise<void> {
  const accounts = loadAllAccounts()
  if (accounts.length === 0) {
    throw new Error(
      'No WeChat account configured. Run `weixin-host login [account-id]` first.',
    )
  }
  const featuresByAccount = new Map(
    accounts.map(account => [
      account.accountId,
      loadFeatureConfig(account.accountId),
    ]),
  )
  const server = createWeixinMcpServer(version)
  const transport = new StdioServerTransport()

  server.setNotificationHandler(
    ChannelPermissionRequestNotificationSchema,
    async notification => {
      const request: ChannelPermissionRequestParams = notification.params
      const requestedChatId = request.channel_context?.chat_id
      const routed = requestedChatId ? parseRoutedChatId(requestedChatId) : null
      const target = routed
        ? {
            accountId: routed.accountId,
            chatId: routed.userId,
            contextToken: getContextToken(routed.userId, routed.accountId),
          }
        : getActivePermissionChat()
      if (!target) {
        log(
          `[weixin] Permission request ${request.request_id} has no unambiguous account/chat target.`,
        )
        return
      }
      const account = loadAccount(target.accountId)
      if (!account) {
        log(
          `[weixin:${target.accountId}] Permission target account is unavailable.`,
        )
        return
      }
      try {
        savePendingPermission(
          request,
          target.accountId,
          target.chatId,
          target.contextToken,
        )
        await sendText({
          to: target.chatId,
          text: formatPermissionRequestMessage(request),
          baseUrl: account.baseUrl || DEFAULT_BASE_URL,
          token: account.token,
          contextToken: target.contextToken || '',
          accountId: target.accountId,
        })
      } catch (error) {
        log(
          `[weixin:${target.accountId}] Failed to relay permission request ${request.request_id}: ${error}`,
        )
      }
    },
  )

  await server.connect(transport)
  const controller = new AbortController()
  const requestShutdown = (): void => {
    if (!controller.signal.aborted) controller.abort()
  }
  process.stdin.on('end', requestShutdown)
  process.stdin.on('error', requestShutdown)
  process.on('SIGINT', requestShutdown)
  process.on('SIGTERM', requestShutdown)
  process.on('SIGHUP', requestShutdown)
  const ppid = process.ppid
  const parentCheck = setInterval(() => {
    try {
      process.kill(ppid, 0)
    } catch {
      clearInterval(parentCheck)
      requestShutdown()
    }
  }, 5000)

  try {
    await Promise.all(
      accounts.map(async account => {
        try {
          const response = await notifyStart(
            account.baseUrl || DEFAULT_BASE_URL,
            account.token,
          )
          if (response.ret !== undefined && response.ret !== 0) {
            log(
              `[weixin:${account.accountId}] notifyStart ret=${response.ret} ${response.errmsg ?? ''}`,
            )
          }
        } catch (error) {
          log(`[weixin:${account.accountId}] notifyStart failed: ${error}`)
        }
      }),
    )
    await Promise.all(
      accounts.map(account =>
        startPollLoop({
          accountId: account.accountId,
          baseUrl: account.baseUrl || DEFAULT_BASE_URL,
          cdnBaseUrl: CDN_BASE_URL,
          token: account.token,
          features: featuresByAccount.get(account.accountId)!,
          onMessage: async (msg: ParsedMessage) => {
            await server.notification({
              method: 'notifications/claude/channel',
              params: {
                content: msg.text,
                meta: {
                  chat_id: msg.routedChatId,
                  sender_id: msg.fromUserId,
                  account_id: msg.accountId,
                  message_id: msg.messageId,
                  ...(msg.attachmentPath && {
                    attachment_path: msg.attachmentPath,
                  }),
                  ...(msg.attachmentType && {
                    attachment_type: msg.attachmentType,
                  }),
                },
              },
            })
          },
          onPermissionResponse: async response => {
            await server.notification({
              method: 'notifications/claude/channel/permission',
              params: {
                request_id: response.requestId,
                behavior: response.behavior,
              },
            })
          },
          abortSignal: controller.signal,
        }),
      ),
    )
  } finally {
    clearInterval(parentCheck)
    await Promise.allSettled(
      accounts.map(account =>
        notifyStop(account.baseUrl || DEFAULT_BASE_URL, account.token),
      ),
    )
    await server.close()
  }
}
