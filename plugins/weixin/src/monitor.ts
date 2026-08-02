import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
// Matches the canonical definition in src/services/mcp/channelPermissions.ts
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
import { getUpdates } from './api.js'
import {
  formatRoutedChatId,
  loadStateJson,
  loadStateText,
  saveStateJson,
  saveStateText,
  type WeixinFeatureConfig,
} from './accounts.js'
import { downloadAndDecrypt } from './media.js'
import { addPendingPairing, isAllowed } from './pairing.js'
import {
  consumePendingPermission,
  setActivePermissionChat,
} from './permissions.js'
import { sendText } from './send.js'
import {
  getSessionPauseRemaining,
  pauseSession,
  STALE_TOKEN_ERRCODE,
} from './session.js'
import {
  MessageItemType,
  MessageType,
  type MessageItem,
  type WeixinMessage,
} from './types.js'

function setContextToken(accountId: string, userId: string, token: string): void {
  const contextTokens = loadStateJson<Record<string, string>>(
    'context-tokens.json',
    {},
    accountId,
  )
  contextTokens[userId] = token
  saveStateJson('context-tokens.json', contextTokens, accountId)
}

export function getContextToken(userId: string, accountId = 'default'): string | undefined {
  return loadStateJson<Record<string, string>>(
    'context-tokens.json',
    {},
    accountId,
  )[userId]
}

function cursorPath(): string {
  return 'cursor.txt'
}

function loadCursor(accountId: string): string {
  return loadStateText(cursorPath(), accountId)
}

function saveCursor(accountId: string, cursor: string): void {
  saveStateText(cursorPath(), cursor, accountId)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timeout = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timeout)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

async function downloadMedia(
  item: MessageItem,
  cdnBaseUrl: string,
  accountId: string,
): Promise<{ path: string; type: string } | null> {
  let encryptQueryParam: string | undefined
  let aesKey: string | undefined
  let ext = ''
  let mediaType = ''

  switch (item.type) {
    case MessageItemType.IMAGE:
      encryptQueryParam = item.image_item?.media?.encrypt_query_param
      aesKey = item.image_item?.aeskey
        ? Buffer.from(item.image_item.aeskey, 'hex').toString('base64')
        : item.image_item?.media?.aes_key
      ext = '.jpg'
      mediaType = 'image'
      break
    case MessageItemType.VOICE:
      encryptQueryParam = item.voice_item?.media?.encrypt_query_param
      aesKey = item.voice_item?.media?.aes_key
      ext = '.silk'
      mediaType = 'voice'
      break
    case MessageItemType.FILE:
      encryptQueryParam = item.file_item?.media?.encrypt_query_param
      aesKey = item.file_item?.media?.aes_key
      ext = item.file_item?.file_name
        ? `.${item.file_item.file_name.split('.').pop()}`
        : ''
      mediaType = 'file'
      break
    case MessageItemType.VIDEO:
      encryptQueryParam = item.video_item?.media?.encrypt_query_param
      aesKey = item.video_item?.media?.aes_key
      ext = '.mp4'
      mediaType = 'video'
      break
    default:
      return null
  }

  const fullUrl =
    item.image_item?.media?.full_url ||
    item.voice_item?.media?.full_url ||
    item.file_item?.media?.full_url ||
    item.video_item?.media?.full_url
  if ((!encryptQueryParam && !fullUrl) || (!aesKey && item.type !== MessageItemType.IMAGE)) {
    return null
  }

  try {
    const data = await downloadAndDecrypt({
      encryptQueryParam,
      aesKey,
      cdnBaseUrl,
      fullUrl,
    })
    const dir = join(tmpdir(), 'weixin-media', accountId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const rawFileName = item.file_item?.file_name || `${Date.now()}${ext}`
    const fileName = `${randomUUID()}-${basename(rawFileName)}`
    const filePath = join(dir, fileName)
    writeFileSync(filePath, data)
    return { path: filePath, type: mediaType }
  } catch (error) {
    process.stderr.write(`[weixin] Failed to download media: ${error}\n`)
    return null
  }
}

export interface ParsedMessage {
  accountId: string
  fromUserId: string
  routedChatId: string
  messageId: string
  text: string
  attachmentPath?: string
  attachmentType?: string
}

function itemHasMedia(item: MessageItem): boolean {
  const media =
    item.image_item?.media ||
    item.video_item?.media ||
    item.file_item?.media ||
    item.voice_item?.media
  return Boolean(media?.encrypt_query_param || media?.full_url)
}

export function selectInboundMedia(items: MessageItem[] = []): MessageItem | undefined {
  const priorities = [
    MessageItemType.IMAGE,
    MessageItemType.VIDEO,
    MessageItemType.FILE,
    MessageItemType.VOICE,
  ]
  for (const type of priorities) {
    const direct = items.find(
      item =>
        item.type === type &&
        itemHasMedia(item) &&
        (type !== MessageItemType.VOICE || !item.voice_item?.text),
    )
    if (direct) return direct
  }
  for (const item of items) {
    const referenced = item.ref_msg?.message_item
    if (referenced && itemHasMedia(referenced)) return referenced
  }
  return undefined
}

export function extractMessageText(items: MessageItem[] = []): string {
  const parts: string[] = []
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      const quoted = item.ref_msg
      const quoteParts = [quoted?.title]
      const quoteText = quoted?.message_item?.text_item?.text
      if (quoteText) quoteParts.push(quoteText)
      const quote = quoteParts.filter(Boolean).join(' | ')
      parts.push(`${quote ? `[Quoted: ${quote}]\n` : ''}${item.text_item.text}`)
    } else if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      parts.push(`[Voice transcription]: ${item.voice_item.text}`)
    }
  }
  return parts.join('\n')
}

export type OnMessageCallback = (msg: ParsedMessage) => Promise<void>

export type PermissionResponse = {
  requestId: string
  behavior: 'allow' | 'deny'
  fromUserId: string
}

export type OnPermissionResponseCallback = (
  response: PermissionResponse,
) => Promise<void>

export function resolveNextLongPollTimeout(
  current: number,
  suggested?: number,
): number {
  return suggested !== undefined && suggested > 0 ? suggested : current
}

export function extractPermissionReply(
  text: string,
): { requestId: string; behavior: 'allow' | 'deny' } | null {
  const match = text.match(PERMISSION_REPLY_RE)
  if (!match) return null
  const behavior = match[1]?.toLowerCase().startsWith('y') ? 'allow' : 'deny'
  const requestId = match[2]?.toLowerCase()
  if (!requestId) return null
  return { requestId, behavior }
}

export function extractEchoCommand(text: string): string | null {
  const match = text.match(/^\s*\/echo(?:\s+([\s\S]*))?\s*$/i)
  return match ? (match[1] ?? '') : null
}

export async function startPollLoop(params: {
  accountId: string
  baseUrl: string
  cdnBaseUrl: string
  token: string
  onMessage: OnMessageCallback
  onPermissionResponse?: OnPermissionResponseCallback
  abortSignal: AbortSignal
  features: WeixinFeatureConfig
}): Promise<void> {
  const {
    accountId,
    baseUrl,
    cdnBaseUrl,
    token,
    onMessage,
    onPermissionResponse,
    abortSignal,
    features,
  } = params
  let cursor = loadCursor(accountId)
  let consecutiveErrors = 0
  let nextTimeoutMs = 35_000

  process.stderr.write(`[weixin:${accountId}] Starting message poll loop...\n`)

  while (!abortSignal.aborted) {
    try {
      const response = await getUpdates(
        baseUrl,
        token,
        cursor,
        abortSignal,
        nextTimeoutMs,
      )

      nextTimeoutMs = resolveNextLongPollTimeout(
        nextTimeoutMs,
        response.longpolling_timeout_ms,
      )

      if (
        response.errcode === STALE_TOKEN_ERRCODE ||
        response.ret === STALE_TOKEN_ERRCODE
      ) {
        pauseSession(Date.now(), accountId)
        const pauseMs = getSessionPauseRemaining(Date.now(), accountId)
        process.stderr.write(
          `[weixin:${accountId}] Bot token is stale (errcode ${STALE_TOKEN_ERRCODE}). Pausing requests for ${Math.ceil(pauseMs / 60_000)} minute(s); run login refresh ${accountId} to reconnect.\n`,
        )
        await sleep(pauseMs, abortSignal)
        continue
      }

      if (
        (response.ret !== 0 && response.ret !== undefined) ||
        (response.errcode !== 0 && response.errcode !== undefined)
      ) {
        throw new Error(
          `getUpdates error: ret=${response.ret} errcode=${response.errcode} ${response.errmsg}`,
        )
      }

      consecutiveErrors = 0

      if (response.get_updates_buf) {
        cursor = response.get_updates_buf
        saveCursor(accountId, cursor)
      }

      if (response.msgs && response.msgs.length > 0) {
        for (const msg of response.msgs) {
          await processMessage(msg, {
            accountId,
            baseUrl,
            cdnBaseUrl,
            token,
            onMessage,
            onPermissionResponse,
            features,
          })
        }
      }
    } catch (error) {
      if (abortSignal.aborted) break

      consecutiveErrors += 1
      process.stderr.write(
        `[weixin:${accountId}] Poll error (${consecutiveErrors}): ${error instanceof Error ? error.message : String(error)}\n`,
      )

      if (consecutiveErrors >= 3) {
        process.stderr.write(
          '[weixin] Too many consecutive errors, backing off 30s...\n',
        )
        await sleep(30_000, abortSignal)
        consecutiveErrors = 0
      } else {
        await sleep(2000, abortSignal)
      }
    }
  }

  process.stderr.write(`[weixin:${accountId}] Poll loop stopped.\n`)
}

export async function processMessage(
  msg: WeixinMessage,
  ctx: {
    accountId: string
    baseUrl: string
    cdnBaseUrl: string
    token: string
    onMessage: OnMessageCallback
    onPermissionResponse?: OnPermissionResponseCallback
    features: WeixinFeatureConfig
  },
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return
  const fromUserId = msg.from_user_id
  if (!fromUserId) return

  if (msg.context_token) {
    setContextToken(ctx.accountId, fromUserId, msg.context_token)
  }

  if (!isAllowed(fromUserId, ctx.accountId)) {
    const code = addPendingPairing(fromUserId, ctx.accountId)
    try {
      await sendText({
        to: fromUserId,
        text: `Your pairing code is: ${code}\n\nAsk the operator to confirm:\nweixin-host access pair ${ctx.accountId} ${code}`,
        baseUrl: ctx.baseUrl,
        token: ctx.token,
        contextToken: msg.context_token || '',
        accountId: ctx.accountId,
      })
    } catch (error) {
      process.stderr.write(`[weixin] Failed to send pairing code: ${error}\n`)
    }
    return
  }

  setActivePermissionChat(ctx.accountId, fromUserId, msg.context_token)

  const items = msg.item_list || []
  const textContent = ctx.features.quotedText
    ? extractMessageText(items)
    : extractMessageText(items.map(item => ({ ...item, ref_msg: undefined })))
  let mediaPath: string | undefined
  let mediaType: string | undefined

  const mediaItem = selectInboundMedia(items)
  if (mediaItem) {
    const downloaded = await downloadMedia(mediaItem, ctx.cdnBaseUrl, ctx.accountId)
    if (downloaded) {
      mediaPath = downloaded.path
      mediaType = downloaded.type
    }
  }

  if (!textContent && !mediaPath) return

  if (ctx.features.echo && textContent) {
    const echoed = extractEchoCommand(textContent)
    if (echoed !== null) {
      await sendText({
        to: fromUserId,
        text: echoed,
        baseUrl: ctx.baseUrl,
        token: ctx.token,
        contextToken: msg.context_token || '',
        accountId: ctx.accountId,
      })
      return
    }
  }

  if (textContent && ctx.onPermissionResponse) {
    const permissionReply = extractPermissionReply(textContent)
    if (permissionReply) {
      const pending = consumePendingPermission(
        permissionReply.requestId,
        ctx.accountId,
        fromUserId,
      )
      if (pending) {
        await ctx.onPermissionResponse({
          requestId: pending.request_id,
          behavior: permissionReply.behavior,
          fromUserId,
        })
        return
      }
    }
  }

  await ctx.onMessage({
    accountId: ctx.accountId,
    fromUserId,
    routedChatId: formatRoutedChatId(ctx.accountId, fromUserId),
    messageId: String(msg.message_id || ''),
    text: textContent || '(media attachment)',
    attachmentPath: mediaPath,
    attachmentType: mediaType,
  })
}
