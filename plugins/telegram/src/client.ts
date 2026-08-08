import { basename } from 'node:path'
import { Bot, GrammyError, HttpError, InputFile, type Context } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { resolveTelegramProxyUrl } from './config.js'
import { inferTelegramMediaKind, validateTelegramOutboundFile } from './media.js'
import { classifyTelegramError, telegramRetryAfter } from './protocol.js'
import {
  classifyTelegramTransportError,
  createTelegramTransport,
  redactTelegramTransportSecret,
  type TelegramProxyMode,
} from './transport.js'
import type { TelegramAttachment, TelegramInboundMessage, TelegramRoute } from './types.js'

interface Entity { type: string; offset: number; length: number; user?: { id: number } }
interface RawMessage {
  message_id: number
  message_thread_id?: number
  chat: { id: number; type: string }
  from?: { id: number; first_name: string; last_name?: string; username?: string }
  text?: string
  caption?: string
  entities?: Entity[]
  caption_entities?: Entity[]
  reply_to_message?: { message_id: number; from?: { id: number } }
  photo?: Array<{ file_id: string; file_size?: number }>
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
  audio?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
  voice?: { file_id: string; mime_type?: string; file_size?: number }
  video?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
}

function entityText(text: string, entity: Entity): string { return text.slice(entity.offset, entity.offset + entity.length) }
export function isTelegramMessageRelevant(message: RawMessage, bot: Pick<UserFromGetMe, 'id' | 'username'>): boolean {
  if (message.chat.type === 'private') return true
  const text = message.text || message.caption || ''
  const entities = message.entities || message.caption_entities || []
  if (message.reply_to_message?.from?.id === bot.id) return true
  const username = bot.username.toLowerCase()
  return entities.some(entity => {
    if (entity.type === 'text_mention') return entity.user?.id === bot.id
    const value = entityText(text, entity).toLowerCase()
    if (entity.type === 'mention') return value === `@${username}`
    if (entity.type === 'bot_command') return value.includes('@') && value.endsWith(`@${username}`)
    return false
  })
}

export function extractTelegramAttachments(message: RawMessage): TelegramAttachment[] {
  const items: TelegramAttachment[] = []
  const photo = message.photo?.at(-1)
  if (photo) items.push({ kind: 'photo', fileId: photo.file_id, size: photo.file_size, fileName: 'photo.jpg', mimeType: 'image/jpeg' })
  for (const kind of ['document', 'audio', 'voice', 'video'] as const) {
    const item = message[kind]
    if (item) items.push({ kind, fileId: item.file_id, fileName: 'file_name' in item ? item.file_name : kind === 'voice' ? 'voice.ogg' : undefined, mimeType: item.mime_type, size: item.file_size })
  }
  return items
}

export function toTelegramInbound(alias: string, updateId: number, message: RawMessage): TelegramInboundMessage | null {
  if (!message.from || (message.chat.type !== 'private' && message.chat.type !== 'group' && message.chat.type !== 'supergroup')) return null
  return {
    botAlias: alias,
    updateId,
    messageId: message.message_id,
    chatId: String(message.chat.id),
    scope: message.chat.type === 'private' ? 'private' : 'group',
    topicId: message.message_thread_id,
    senderId: String(message.from.id),
    senderName: [message.from.first_name, message.from.last_name].filter(Boolean).join(' '),
    text: message.text || message.caption || '',
    replyToMessageId: message.reply_to_message?.message_id,
    attachments: extractTelegramAttachments(message),
  }
}

export interface TelegramDoctorResult { bot: UserFromGetMe; webhookUrl: string; pendingUpdates: number }
export type TelegramInboundHandler = (message: TelegramInboundMessage) => Promise<void>

export class TelegramClient {
  readonly bot: Bot
  readonly transportFetch: typeof fetch
  readonly proxyMode: TelegramProxyMode
  readonly proxyDisplay: string
  private botInfo: UserFromGetMe | null = null
  private polling: Promise<void> | null = null
  private operationSequence = 0

  constructor(
    readonly alias: string,
    readonly token: string,
    options: { apiRoot?: string; proxyUrl?: string } = {},
  ) {
    const transport = createTelegramTransport(
      options.proxyUrl ?? resolveTelegramProxyUrl(),
    )
    this.transportFetch = transport.fetch
    this.proxyMode = transport.proxyMode
    this.proxyDisplay = transport.proxyDisplay
    this.bot = new Bot(token, {
      client: {
        apiRoot:
          options.apiRoot ??
          process.env.TELEGRAM_API_ROOT ??
          'https://api.telegram.org',
        timeoutSeconds: 40,
        fetch: transport.fetch,
      },
    })
    // grammY bot.start() unconditionally invokes deleteWebhook during setup.
    // This plugin has a stricter boundary: doctor rejects an active webhook and
    // startup must never mutate it, so acknowledge only that internal call locally.
    this.bot.api.config.use(async (previous, method, payload, signal) => {
      if (method === 'deleteWebhook') return { ok: true, result: true } as never
      return previous(method, payload, signal)
    })
  }

  async doctor(): Promise<TelegramDoctorResult> {
    let bot: UserFromGetMe
    let webhook: Awaited<ReturnType<typeof this.bot.api.getWebhookInfo>>
    try {
      ;[bot, webhook] = await Promise.all([
        this.bot.api.getMe(),
        this.bot.api.getWebhookInfo(),
      ])
    } catch (error) {
      throw this.redactedError(error)
    }
    this.botInfo = bot
    if (webhook.url) throw new Error(`Telegram bot ${this.alias} has an active Webhook; remove it explicitly before using long polling.`)
    return { bot, webhookUrl: webhook.url || '', pendingUpdates: webhook.pending_update_count }
  }

  async start(handler: TelegramInboundHandler, onError: (error: Error) => void, onStopped?: () => void): Promise<void> {
    const info = this.botInfo ?? (await this.doctor()).bot
    this.bot.on('message', async (context: Context) => {
      const raw = context.message as unknown as RawMessage
      if (!isTelegramMessageRelevant(raw, info)) return
      const message = toTelegramInbound(this.alias, context.update.update_id, raw)
      if (message) await handler(message)
    })
    this.bot.catch(error => onError(this.redactedError(error.error)))
    this.polling = this.bot.start({ allowed_updates: ['message'], drop_pending_updates: false, onStart: () => undefined }).catch(error => {
      onError(this.redactedError(error))
      onStopped?.()
    })
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  async stop(): Promise<void> {
    if (this.bot.isRunning()) await this.bot.stop()
    await this.polling?.catch(() => undefined)
    this.polling = null
  }

  async getFile(fileId: string): Promise<{ file_path?: string }> { return this.bot.api.getFile(fileId) }

  private options(route: TelegramRoute, replyMessageId?: number): Record<string, unknown> {
    return {
      ...(route.topicId !== undefined && { message_thread_id: route.topicId }),
      ...(replyMessageId !== undefined && { reply_parameters: { message_id: replyMessageId, allow_sending_without_reply: false } }),
    }
  }

  private async explicit429Retry<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      const delay = telegramRetryAfter(error)
      if (delay === null) throw error
      await new Promise(resolve => setTimeout(resolve, delay))
      return operation()
    }
  }

  private async operation<T>(name: string, action: () => Promise<T>): Promise<T> {
    const id = `${this.alias}-${Date.now().toString(36)}-${(++this.operationSequence).toString(36)}`
    try { return await this.explicit429Retry(action) } catch (error) {
      const safe = this.redactedError(error)
      throw new Error(`Telegram ${name} failed [operation ${id}]: ${safe.message}`)
    }
  }

  async sendText(route: TelegramRoute, text: string, replyMessageId?: number): Promise<void> {
    await this.operation('sendMessage', () => this.bot.api.sendMessage(route.chatId, text, this.options(route, replyMessageId) as never))
  }
  async sendTyping(route: TelegramRoute): Promise<void> {
    await this.operation('sendChatAction', () => this.bot.api.sendChatAction(route.chatId, 'typing', this.options(route) as never))
  }
  async sendFile(route: TelegramRoute, path: string, replyMessageId?: number): Promise<void> {
    const resolved = validateTelegramOutboundFile(path)
    const input = new InputFile(resolved, basename(resolved))
    const options = this.options(route, replyMessageId) as never
    const kind = inferTelegramMediaKind(resolved)
    await this.operation(`send${kind}`, async () => {
      if (kind === 'photo') await this.bot.api.sendPhoto(route.chatId, input, options)
      else if (kind === 'audio') await this.bot.api.sendAudio(route.chatId, input, options)
      else if (kind === 'voice') await this.bot.api.sendVoice(route.chatId, input, options)
      else if (kind === 'video') await this.bot.api.sendVideo(route.chatId, input, options)
      else await this.bot.api.sendDocument(route.chatId, input, options)
    })
  }

  redactedError(error: unknown): Error {
    if (error instanceof GrammyError) return Object.assign(new Error(`Telegram API ${error.error_code}: ${error.description}`), { kind: classifyTelegramError(error), error_code: error.error_code })
    if (error instanceof HttpError) {
      return Object.assign(
        new Error(
          `Telegram Bot API network request failed (transport=${this.proxyMode}, kind=${classifyTelegramTransportError(error.error)}).`,
        ),
        { kind: classifyTelegramTransportError(error.error) },
      )
    }
    const text = error instanceof Error ? error.message : String(error)
    return new Error(
      redactTelegramTransportSecret(
        text.split(this.token).join('[REDACTED]'),
      ),
    )
  }
}
