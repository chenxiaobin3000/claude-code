import { createHmac } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import {
  isTelegramUserHistoryAllowed,
  setTelegramUserRouteAllowed,
} from './access.js'
import {
  listTelegramUserGroups,
  listTelegramUserHistory,
  type TelegramUserGroup,
  type TelegramUserHistoryMessage,
} from './client.js'
import {
  loadTelegramUserSession,
  resolveTelegramUserAccount,
  resolveTelegramUserCredentials,
  type TelegramUserAccountConfig,
  type TelegramUserCredentials,
} from './config.js'
import { redactTelegramUserError } from './protocol.js'
import type { TelegramUserPeerType } from './types.js'

export type TelegramUserChatFilter = 'group' | 'channel' | 'all'
export interface TelegramUserControlChat {
  chatRef: string
  name: string
  type: TelegramUserGroup['type']
  allowed: boolean
}
interface ResolvedControlChat extends TelegramUserControlChat {
  peerId: string
  peerType: Extract<TelegramUserPeerType, 'group' | 'channel'>
}
export interface TelegramUserControlDependencies {
  resolveAccount(alias?: string): TelegramUserAccountConfig | null
  resolveCredentials(account: TelegramUserAccountConfig): TelegramUserCredentials
  loadSession(alias: string): string
  listGroups(
    account: TelegramUserAccountConfig,
    credentials: TelegramUserCredentials,
  ): Promise<TelegramUserGroup[]>
  listHistory(
    account: TelegramUserAccountConfig,
    credentials: TelegramUserCredentials,
    peerType: TelegramUserPeerType,
    peerId: string,
    limit: number,
  ): Promise<TelegramUserHistoryMessage[]>
  isHistoryAllowed(
    alias: string,
    peerType: TelegramUserPeerType,
    peerId: string,
  ): boolean
  setAccess(
    alias: string,
    entry: { peerType: TelegramUserPeerType; peerId: string },
    allowed: boolean,
  ): void
}

const defaultDependencies: TelegramUserControlDependencies = {
  resolveAccount: resolveTelegramUserAccount,
  resolveCredentials: resolveTelegramUserCredentials,
  loadSession: loadTelegramUserSession,
  listGroups: listTelegramUserGroups,
  listHistory: listTelegramUserHistory,
  isHistoryAllowed: isTelegramUserHistoryAllowed,
  setAccess: setTelegramUserRouteAllowed,
}

export function createTelegramUserChatRef(
  accountAlias: string,
  type: TelegramUserGroup['type'],
  peerId: string,
  session: string,
): string {
  if (!session) throw new Error('Telegram user account is not logged in.')
  const digest = createHmac('sha256', session)
    .update(`${accountAlias}\0${type}\0${peerId}`)
    .digest('hex')
    .slice(0, 24)
  return `chat_${digest}`
}

export class TelegramUserControlService {
  constructor(
    private readonly dependencies: TelegramUserControlDependencies = defaultDependencies,
  ) {}

  private account(alias?: string): {
    account: TelegramUserAccountConfig
    credentials: TelegramUserCredentials
    session: string
  } {
    const account = this.dependencies.resolveAccount(alias)
    if (!account) throw new Error('No Telegram user account configured.')
    const session = this.dependencies.loadSession(account.alias)
    if (!session)
      throw new Error(
        `Telegram user account ${account.alias} is not logged in.`,
      )
    return {
      account,
      credentials: this.dependencies.resolveCredentials(account),
      session,
    }
  }

  private async resolvedChats(alias?: string): Promise<{
    account: TelegramUserAccountConfig
    credentials: TelegramUserCredentials
    chats: ResolvedControlChat[]
  }> {
    const { account, credentials, session } = this.account(alias)
    const groups = await this.dependencies.listGroups(account, credentials)
    return {
      account,
      credentials,
      chats: groups.map(group => {
        const peerType = group.type === 'channel' ? 'channel' : 'group'
        return {
          chatRef: createTelegramUserChatRef(
            account.alias,
            group.type,
            group.id,
            session,
          ),
          name: group.name,
          type: group.type,
          allowed: this.dependencies.isHistoryAllowed(
            account.alias,
            peerType,
            group.id,
          ),
          peerId: group.id,
          peerType,
        }
      }),
    }
  }

  async listChats(
    alias?: string,
    filter: TelegramUserChatFilter = 'group',
  ): Promise<TelegramUserControlChat[]> {
    const { chats } = await this.resolvedChats(alias)
    return chats
      .filter(chat =>
        filter === 'all'
          ? true
          : filter === 'group'
            ? chat.peerType === 'group'
            : chat.peerType === 'channel',
      )
      .map(({ peerId: _peerId, peerType: _peerType, ...chat }) => chat)
  }

  private async resolveChat(alias: string | undefined, chatRef: string) {
    if (!/^chat_[a-f0-9]{24}$/.test(chatRef))
      throw new Error('Telegram chatRef is invalid.')
    const context = await this.resolvedChats(alias)
    const chat = context.chats.find(candidate => candidate.chatRef === chatRef)
    if (!chat) throw new Error('Telegram chatRef is unavailable for this account.')
    return { ...context, chat }
  }

  async setChatAccess(
    alias: string | undefined,
    chatRef: string,
    allowed: boolean,
  ): Promise<TelegramUserControlChat> {
    const { account, chat } = await this.resolveChat(alias, chatRef)
    this.dependencies.setAccess(
      account.alias,
      { peerType: chat.peerType, peerId: chat.peerId },
      allowed,
    )
    const { peerId: _peerId, peerType: _peerType, ...result } = chat
    return { ...result, allowed }
  }

  async getChatHistory(
    alias: string | undefined,
    chatRef: string,
    limit: number,
  ): Promise<TelegramUserHistoryMessage[]> {
    const { account, credentials, chat } = await this.resolveChat(alias, chatRef)
    return this.dependencies.listHistory(
      account,
      credentials,
      chat.peerType,
      chat.peerId,
      limit,
    )
  }
}

const ListChatsInput = z.object({
  account: z.string().optional(),
  type: z.enum(['group', 'channel', 'all']).default('group'),
})
const SetChatAccessInput = z.object({
  account: z.string().optional(),
  chatRef: z.string(),
  allowed: z.boolean(),
})
const GetChatHistoryInput = z.object({
  account: z.string().optional(),
  chatRef: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
})

function safeControlError(error: unknown): string {
  return redactTelegramUserError(error).replace(/-100\d{5,}|-\d{5,}/g, '[peer]')
}

export function createTelegramUserControlMcpServer(
  version: string,
  service = new TelegramUserControlService(),
): Server {
  const server = new Server(
    { name: 'telegram-user-control', version },
    {
      capabilities: { tools: {} },
      instructions:
        'Manage Telegram user group access through opaque chatRef values. Never infer or expose Telegram Peer IDs.',
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_chats',
        description:
          'List Telegram groups and channels by name and opaque chatRef without exposing Peer IDs.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string' },
            type: { type: 'string', enum: ['group', 'channel', 'all'] },
          },
        },
      },
      {
        name: 'set_chat_access',
        description:
          'Add or remove a Telegram group or channel from the unrestricted allowlist using its opaque chatRef.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string' },
            chatRef: { type: 'string' },
            allowed: { type: 'boolean' },
          },
          required: ['chatRef', 'allowed'],
        },
      },
      {
        name: 'get_chat_history',
        description:
          'Read up to 100 recent text messages from an already allowlisted Telegram chat using its opaque chatRef. Attachments are not downloaded.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string' },
            chatRef: { type: 'string' },
            limit: { type: 'number', minimum: 1, maximum: 100 },
          },
          required: ['chatRef'],
        },
      },
    ] as never,
  }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const args = request.params.arguments
      let result: unknown
      if (request.params.name === 'list_chats') {
        const input = ListChatsInput.parse(args ?? {})
        result = await service.listChats(input.account, input.type)
      } else if (request.params.name === 'set_chat_access') {
        const input = SetChatAccessInput.parse(args ?? {})
        result = await service.setChatAccess(
          input.account,
          input.chatRef,
          input.allowed,
        )
      } else if (request.params.name === 'get_chat_history') {
        const input = GetChatHistoryInput.parse(args ?? {})
        result = await service.getChatHistory(
          input.account,
          input.chatRef,
          input.limit,
        )
      } else {
        throw new Error(`Unknown Telegram user control tool: ${request.params.name}`)
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: safeControlError(error) }],
        isError: true,
      }
    }
  })
  return server
}

export async function runTelegramUserControlMcpServer(
  version: string,
): Promise<void> {
  const server = createTelegramUserControlMcpServer(version)
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
  try {
    await new Promise<void>(resolve =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    )
  } finally {
    clearInterval(parent)
    await server.close()
  }
}
