import { Api, TelegramClient } from 'telegram'
import type { EntityLike } from 'telegram/define'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'
import { StringSession } from 'telegram/sessions'
import type { TelegramUserAccountConfig, TelegramUserCredentials } from './config.js'
import { isTelegramUserHistoryAllowed } from './access.js'
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
import type { TelegramUserPeerType } from './types.js'

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
  getMessages(
    entity: EntityLike,
    params: { limit: number },
  ): Promise<readonly TelegramUserHistorySource[]>
  disconnect(): Promise<void>
}
export interface TelegramUserDialogLike {
  id?: { toString(): string }
  name?: string
  title?: string
  isGroup: boolean
  isChannel: boolean
  isUser?: boolean
  inputEntity?: EntityLike
}
export interface TelegramUserGroup {
  type: 'group' | 'supergroup' | 'channel'
  id: string
  name: string
}
export interface TelegramUserHistoryMessage {
  messageId: number
  date: string
  senderId?: string
  text: string
  hasMedia: boolean
}
export interface TelegramUserHistorySource {
  id: number
  date: number
  senderId?: { toString(): string }
  message?: string
  media?: unknown
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

export function selectTelegramUserHistory(
  messages: readonly TelegramUserHistorySource[],
): TelegramUserHistoryMessage[] {
  return messages.map(message => ({
    messageId: message.id,
    date: new Date(message.date * 1000).toISOString(),
    ...(message.senderId ? { senderId: message.senderId.toString() } : {}),
    text: message.message ?? '',
    hasMedia: Boolean(message.media),
  }))
}

export async function listTelegramUserHistory(
  account: TelegramUserAccountConfig,
  credentials: TelegramUserCredentials,
  peerType: TelegramUserPeerType,
  peerId: string,
  limit: number,
  factory: (
    credentials: Pick<TelegramUserCredentials, 'apiId' | 'apiHash'>,
    session: string,
  ) => TelegramUserDialogTransport = createGramJsClient,
): Promise<TelegramUserHistoryMessage[]> {
  if (!isTelegramUserHistoryAllowed(account.alias, peerType, peerId))
    throw new Error(
      'Telegram history target is not in the unrestricted peer allowlist.',
    )
  const client = factory(credentials, loadTelegramUserSession(account.alias))
  try {
    await client.connect()
    if (!(await client.checkAuthorization()))
      throw new Error('Telegram user session is not authorized; run account login.')
    const dialog = (await client.getDialogs({})).find(candidate => {
      if (candidate.id?.toString() !== peerId) return false
      if (peerType === 'user') return candidate.isUser
      if (peerType === 'group') return candidate.isGroup
      return candidate.isChannel && !candidate.isGroup
    })
    if (!dialog?.inputEntity)
      throw new Error('Telegram history target is not available to this account.')
    const messages = await client.getMessages(dialog.inputEntity, { limit })
    return selectTelegramUserHistory([...messages].reverse())
  } catch (error) {
    throw new Error(classifyTelegramUserError(error))
  } finally {
    await client.disconnect().catch(() => undefined)
  }
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
  async logout(): Promise<void> { await this.client.connect(); if (await this.client.checkAuthorization()) await this.client.invoke(new Api.auth.LogOut()) }
  async stop(): Promise<void> { await this.client.disconnect() }
}
