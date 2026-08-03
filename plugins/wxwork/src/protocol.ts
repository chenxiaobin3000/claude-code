import { randomBytes } from 'node:crypto'
import { WxworkCommand, type NormalizedWxworkMessage, type WxworkFrame, type WxworkMediaReference, type WxworkMessageBody } from './types.js'

export function generateWxworkRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(8).toString('hex')}`
}

export function createSubscribeFrame(botId: string, secret: string, requestId = generateWxworkRequestId(WxworkCommand.Subscribe)): WxworkFrame {
  return {
    cmd: WxworkCommand.Subscribe,
    headers: { req_id: requestId },
    body: { bot_id: botId, secret },
  }
}

export function createPingFrame(requestId = generateWxworkRequestId(WxworkCommand.Ping)): WxworkFrame {
  return { cmd: WxworkCommand.Ping, headers: { req_id: requestId } }
}

export function parseWxworkFrame(value: string | Buffer): WxworkFrame {
  const parsed = JSON.parse(value.toString()) as Partial<WxworkFrame>
  if (!parsed || typeof parsed !== 'object' || !parsed.headers || typeof parsed.headers.req_id !== 'string') {
    throw new Error('Invalid wxwork WebSocket frame.')
  }
  return parsed as WxworkFrame
}

function mediaReference(type: WxworkMediaReference['type'], value: unknown): WxworkMediaReference | null {
  if (!value || typeof value !== 'object') return null
  const item = value as { url?: unknown; aeskey?: unknown }
  return typeof item.url === 'string' && typeof item.aeskey === 'string'
    ? { type, url: item.url, aeskey: item.aeskey }
    : null
}

function quoteText(quote: Record<string, unknown> | undefined): string {
  if (!quote) return ''
  const text = (quote.text as { content?: unknown } | undefined)?.content
  if (typeof text === 'string' && text.trim()) return `\n\n> ${text.trim().replace(/\n/g, '\n> ')}`
  return ''
}

export function normalizeWxworkMessage(body: WxworkMessageBody): NormalizedWxworkMessage {
  if (!body.msgid || !body.aibotid || !body.from?.userid) throw new Error('wxwork callback is missing identity fields.')
  if (body.chattype !== 'single' && body.chattype !== 'group') throw new Error('wxwork callback has an invalid chat type.')
  const targetId = body.chattype === 'group' ? body.chatid : body.from.userid
  if (!targetId) throw new Error('wxwork group callback is missing chatid.')
  const media: WxworkMediaReference[] = []
  const textParts: string[] = []
  if (body.msgtype === 'text' && typeof body.text?.content === 'string') textParts.push(body.text.content)
  else if (body.msgtype === 'voice' && typeof body.voice?.content === 'string') textParts.push(body.voice.content)
  else if (body.msgtype === 'mixed') {
    for (const item of body.mixed?.msg_item ?? []) {
      if (item.msgtype === 'text' && typeof item.text?.content === 'string') textParts.push(item.text.content)
      if (item.msgtype === 'image') {
        const reference = mediaReference('image', item.image)
        if (reference) media.push(reference)
      }
    }
  } else if (body.msgtype === 'image') {
    const reference = mediaReference('image', body.image)
    if (reference) media.push(reference)
  } else if (body.msgtype === 'file') {
    const reference = mediaReference('file', body.file)
    if (reference) media.push(reference)
  } else if (body.msgtype === 'video') {
    const reference = mediaReference('video', body.video)
    if (reference) media.push(reference)
  }
  const fallback = media.length > 0 ? `[${body.msgtype} attachment]` : `[unsupported wxwork message: ${body.msgtype}]`
  return {
    messageId: body.msgid,
    botId: body.aibotid,
    chatType: body.chattype,
    targetId,
    senderId: body.from.userid,
    text: `${textParts.join('\n').trim() || fallback}${quoteText(body.quote)}`,
    media,
  }
}

export function createFinalReplyBody(streamId: string, content: string): Record<string, unknown> {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > 20_480) throw new Error(`wxwork Markdown reply exceeds 20480 UTF-8 bytes (${bytes}).`)
  return { msgtype: 'stream', stream: { id: streamId, finish: true, content } }
}

export function createMediaReplyBody(type: WxworkMediaReference['type'], mediaId: string): Record<string, unknown> {
  return { msgtype: type, [type]: { media_id: mediaId } }
}
