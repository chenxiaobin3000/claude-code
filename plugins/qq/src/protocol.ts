import { createHash } from 'node:crypto'
import { GatewayEvent, GatewayOp, type GatewayPayload, type QqAttachment, type QqInboundMessage } from './types.js'

export const QQ_GROUP_C2C_INTENT = 1 << 25
export function identifyPayload(accessToken: string): GatewayPayload {
  return { op: GatewayOp.Identify, d: { token: `QQBot ${accessToken}`, intents: QQ_GROUP_C2C_INTENT, shard: [0, 1] } }
}
export function resumePayload(accessToken: string, sessionId: string, seq: number): GatewayPayload {
  return { op: GatewayOp.Resume, d: { token: `QQBot ${accessToken}`, session_id: sessionId, seq } }
}
export function heartbeatPayload(seq: number | null): GatewayPayload { return { op: GatewayOp.Heartbeat, d: seq } }

function attachments(value: unknown): QqAttachment[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item === 'object' && typeof (item as QqAttachment).url === 'string' && typeof (item as QqAttachment).content_type === 'string') as QqAttachment[]
}
export function normalizeQqDispatch(alias: string, eventType: string, data: unknown): QqInboundMessage | null {
  if (!data || typeof data !== 'object') return null
  const event = data as Record<string, unknown>
  if (eventType === GatewayEvent.C2cMessage) {
    const author = event.author as { user_openid?: unknown } | undefined
    if (typeof event.id !== 'string' || typeof author?.user_openid !== 'string') return null
    return { botAlias: alias, scope: 'c2c', targetId: author.user_openid, senderId: author.user_openid, messageId: event.id, timestamp: typeof event.timestamp === 'string' ? event.timestamp : '', content: typeof event.content === 'string' ? event.content : '', attachments: attachments(event.attachments) }
  }
  if (eventType === GatewayEvent.GroupAtMessage) {
    const author = event.author as { member_openid?: unknown; username?: unknown; bot?: unknown } | undefined
    if (author?.bot === true || typeof event.id !== 'string' || typeof event.group_openid !== 'string' || typeof author?.member_openid !== 'string') return null
    return { botAlias: alias, scope: 'group', targetId: event.group_openid, senderId: author.member_openid, senderName: typeof author.username === 'string' ? author.username : undefined, messageId: event.id, timestamp: typeof event.timestamp === 'string' ? event.timestamp : '', content: typeof event.content === 'string' ? event.content : '', attachments: attachments(event.attachments) }
  }
  return null
}
export function deterministicMsgSeq(messageId: string, part = 0): number {
  const digest = createHash('sha256').update(`${messageId}\0${part}`).digest()
  return digest.readUInt16BE(0)
}
export function splitQqText(text: string, maximum = 1800): string[] {
  if (!text) throw new Error('QQ reply text must not be empty.')
  const chunks: string[] = []
  let current = ''
  for (const character of text) {
    if (Buffer.byteLength(current + character, 'utf8') > maximum) { chunks.push(current); current = character } else current += character
  }
  if (current) chunks.push(current)
  return chunks
}
