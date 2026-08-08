import { Api, TelegramClient } from 'telegram'
import type { EntityLike } from 'telegram/define'
import { NewMessage, type NewMessageEvent } from 'telegram/events'
import { EditedMessage } from 'telegram/events/EditedMessage.js'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'
import { StringSession } from 'telegram/sessions'
import type { TelegramUserAccountConfig, TelegramUserCredentials } from './config.js'
import {
  loadTelegramUserSession,
  resolveTelegramUserProxyUrl,
  saveTelegramUserSession,
  saveTelegramUserState,
} from './config.js'
import { redactTelegramUserError } from './protocol.js'
import {
  classifyTelegramUserTransportError,
  createTelegramUserTransport,
  type TelegramUserProxyMode,
  type TelegramUserTransport,
} from './transport.js'
import type { TelegramUserAttachment, TelegramUserInboundMessage, TelegramUserPeerType } from './types.js'

export interface TelegramUserPrompts { code(viaApp?: boolean): Promise<string>; password(hint?: string): Promise<string> }
export interface TelegramUserLoginTransport {
  session: { save(): unknown }
  start(params: { phoneNumber: string; phoneCode(viaApp?: boolean): Promise<string>; password(hint?: string): Promise<string>; onError(error: Error): Promise<boolean> | undefined }): Promise<void>
  getMe(): Promise<{ id: { toString(): string }; username?: string }>
  disconnect(): Promise<void>
}
export interface TelegramUserDialogTransport {
  connect(): Promise<unknown>
  checkAuthorization(): Promise<boolean>
  getDialogs(params?: Record<string, never>): Promise<readonly TelegramUserDialogLike[]>
  disconnect(): Promise<void>
}
export interface TelegramUserDialogLike {
  id?: { toString(): string }
  name?: string
  title?: string
  isGroup: boolean
  isChannel: boolean
}
export interface TelegramUserGroup {
  type: 'group' | 'supergroup' | 'channel'
  id: string
  name: string
}
// GramJS consumes a request attempt when Telegram redirects login to the
// account's data center. Keep enough attempts for that internal migration and
// one transient reconnect; this does not replay channel messages.
const clientOptions = { connectionRetries: 3, reconnectRetries: 3, requestRetries: 3, downloadRetries: 2, retryDelay: 1000, autoReconnect: true, floodSleepThreshold: 0, sequentialUpdates: true, baseLogger: new Logger(LogLevel.NONE), deviceModel: 'Claude Code Telegram User Plugin', appVersion: '1.0.0' } as const
function createGramJsClientWithTransport(credentials: Pick<TelegramUserCredentials, 'apiId' | 'apiHash'>, session: string, transport: TelegramUserTransport): TelegramClient {
  return new TelegramClient(new StringSession(session), credentials.apiId, credentials.apiHash, { ...clientOptions, ...(transport.proxy ? { proxy: transport.proxy } : {}) })
}
export function createGramJsClient(credentials: Pick<TelegramUserCredentials, 'apiId' | 'apiHash'>, session: string, proxyUrl = resolveTelegramUserProxyUrl()): TelegramClient {
  return createGramJsClientWithTransport(credentials, session, createTelegramUserTransport(proxyUrl))
}
export function classifyTelegramUserError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = redactTelegramUserError(error)
  if (/FLOOD_WAIT|FloodWait/i.test(`${name} ${message}`)) return `Telegram rate limit (FloodWait): ${message}`
  if (/PHONE_CODE|SESSION_PASSWORD|PASSWORD_HASH/i.test(message)) return `Telegram login rejected: ${message}`
  if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(message)) return `Telegram session is invalid: ${message}`
  if (/MIGRATE/i.test(message)) return `Telegram data-center migration failed: ${message}`
  return `Telegram request failed: ${message}`
}
export async function loginTelegramUserAccount(account: TelegramUserAccountConfig, credentials: TelegramUserCredentials, prompts: TelegramUserPrompts, factory: (credentials: Pick<TelegramUserCredentials, 'apiId' | 'apiHash'>, session: string) => TelegramUserLoginTransport = createGramJsClient): Promise<{ userId: string; username?: string }> {
  const client = factory(credentials, loadTelegramUserSession(account.alias))
  try {
    await client.start({ phoneNumber: credentials.phone, phoneCode: prompts.code, password: prompts.password, onError: async error => { throw new Error(classifyTelegramUserError(error)) } })
    const session = client.session.save() as unknown as string; saveTelegramUserSession(account.alias, session)
    const me = await client.getMe(); const result = { userId: me.id.toString(), ...(me.username ? { username: me.username } : {}) }
    saveTelegramUserState(account.alias, 'identity.json', result); return result
  } catch (error) {
    throw new Error(classifyTelegramUserError(error))
  } finally { await client.disconnect().catch(() => undefined) }
}

export function selectTelegramUserGroups(
  dialogs: readonly TelegramUserDialogLike[],
): TelegramUserGroup[] {
  return dialogs.flatMap(dialog => {
    if ((!dialog.isGroup && !dialog.isChannel) || !dialog.id) return []
    const type: TelegramUserGroup['type'] = dialog.isGroup
      ? dialog.isChannel
        ? 'supergroup'
        : 'group'
      : 'channel'
    const name = (dialog.title ?? dialog.name ?? '(unnamed)')
      .replace(/[\t\r\n]+/g, ' ')
      .trim() || '(unnamed)'
    return [{ type, id: dialog.id.toString(), name }]
  })
}

export async function listTelegramUserGroups(
  account: TelegramUserAccountConfig,
  credentials: TelegramUserCredentials,
  factory: (
    credentials: Pick<TelegramUserCredentials, 'apiId' | 'apiHash'>,
    session: string,
  ) => TelegramUserDialogTransport = createGramJsClient,
): Promise<TelegramUserGroup[]> {
  const client = factory(credentials, loadTelegramUserSession(account.alias))
  try {
    await client.connect()
    if (!(await client.checkAuthorization()))
      throw new Error('Telegram user session is not authorized; run account login.')
    return selectTelegramUserGroups(await client.getDialogs({}))
  } catch (error) {
    throw new Error(classifyTelegramUserError(error))
  } finally {
    await client.disconnect().catch(() => undefined)
  }
}

function mediaInfo(message: Api.Message): TelegramUserAttachment[] {
  const file = message.file; if (!message.media || !file) return []
  const kind: TelegramUserAttachment['kind'] = message.voice ? 'voice' : message.audio ? 'audio' : message.video ? 'video' : message.photo ? 'photo' : 'document'
  return [{ kind, ...(file.name ? { fileName: file.name } : {}), ...(file.mimeType ? { mimeType: file.mimeType } : {}), ...(typeof file.size === 'number' ? { size: file.size } : {}) }]
}
async function convert(accountAlias: string, event: NewMessageEvent, edited: boolean): Promise<TelegramUserInboundMessage | null> {
  const message = event.message
  if (message.out || !message.senderId || !message.chatId) return null
  const inputPeer = await message.getInputChat(); if (!inputPeer) return null
  const peerType: TelegramUserPeerType = message.isPrivate ? 'user' : message.isGroup ? 'group' : 'channel'
  const topicId = message.replyTo?.forumTopic ? (message.replyTo.replyToTopId ?? message.replyTo.replyToMsgId) : undefined
  const sender = await message.getSender().catch(() => undefined)
  const senderName = sender && 'firstName' in sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username : undefined
  const attachments = mediaInfo(message)
  return { accountAlias, updateKey: `${message.chatId}:${message.id}:${message.editDate ?? 0}`, messageId: message.id, peerId: message.chatId.toString(), peerType, ...(topicId ? { topicId } : {}), senderId: message.senderId.toString(), ...(senderName ? { senderName } : {}), text: message.message ?? '', ...(message.replyToMsgId ? { replyToMessageId: message.replyToMsgId } : {}), edited, attachments, inputPeer, ...(attachments.length ? { downloadMedia: async () => { const data = await message.downloadMedia({}); return Buffer.isBuffer(data) ? data : null } } : {}) }
}

export class TelegramUserRuntimeClient {
  readonly client: TelegramClient
  readonly proxyMode: TelegramUserProxyMode
  readonly proxyDisplay: string
  constructor(readonly account: TelegramUserAccountConfig, credentials: TelegramUserCredentials) {
    const transport = createTelegramUserTransport(resolveTelegramUserProxyUrl())
    this.proxyMode = transport.proxyMode
    this.proxyDisplay = transport.proxyDisplay
    this.client = createGramJsClientWithTransport(credentials, loadTelegramUserSession(account.alias), transport)
  }
  async doctor(): Promise<{ userId: string; username?: string }> {
    try {
      await this.client.connect()
      if (!await this.client.checkAuthorization()) throw new Error('Telegram user session is not authorized; run account login.')
      const me = await this.client.getMe()
      return { userId: me.id.toString(), ...(me.username ? { username: me.username } : {}) }
    } catch (error) {
      const safe = redactTelegramUserError(error)
      throw new Error(`Telegram User doctor failed (stage=mtproto, transport=${this.proxyMode}, kind=${classifyTelegramUserTransportError(error)}): ${safe}`)
    }
  }
  async start(handler: (message: TelegramUserInboundMessage) => Promise<void>, onError: (error: Error) => void): Promise<void> {
    await this.doctor()
    const receive = async (event: NewMessageEvent, edited: boolean): Promise<void> => { try { const message = await convert(this.account.alias, event, edited); if (message) await handler(message) } catch (error) { onError(new Error(classifyTelegramUserError(error))) } }
    this.client.addEventHandler(event => receive(event as NewMessageEvent, false), new NewMessage({ incoming: true }))
    this.client.addEventHandler(event => receive(event as NewMessageEvent, true), new EditedMessage({ incoming: true }))
  }
  async sendText(entity: EntityLike, text: string, replyTo?: number, topicId?: number): Promise<number> { const sent = await this.client.sendMessage(entity, { message: text, parseMode: undefined, ...(replyTo ? { replyTo } : {}), ...(topicId ? { topMsgId: topicId } : {}) }); return sent.id }
  async sendFile(entity: EntityLike, path: string, replyTo?: number, topicId?: number): Promise<number> { const sent = await this.client.sendMessage(entity, { message: '', file: path, parseMode: undefined, ...(replyTo ? { replyTo } : {}), ...(topicId ? { topMsgId: topicId } : {}) }); return sent.id }
  async logout(): Promise<void> { await this.client.connect(); if (await this.client.checkAuthorization()) await this.client.invoke(new Api.auth.LogOut()) }
  async stop(): Promise<void> { await this.client.disconnect() }
}
