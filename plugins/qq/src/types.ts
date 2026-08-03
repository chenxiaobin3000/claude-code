export type QqChatScope = 'c2c' | 'group'

export const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const

export const GatewayEvent = {
  Ready: 'READY',
  Resumed: 'RESUMED',
  C2cMessage: 'C2C_MESSAGE_CREATE',
  GroupAtMessage: 'GROUP_AT_MESSAGE_CREATE',
} as const

export interface GatewayPayload {
  op: number
  d?: unknown
  s?: number
  t?: string
}

export interface QqAttachment {
  content_type: string
  url: string
  filename?: string
  size?: number
  voice_wav_url?: string
  asr_refer_text?: string
}

export interface QqInboundMessage {
  botAlias: string
  scope: QqChatScope
  targetId: string
  senderId: string
  senderName?: string
  messageId: string
  timestamp: string
  content: string
  attachments: QqAttachment[]
}

export interface QqApiErrorShape {
  httpStatus: number
  path: string
  bizCode?: number
  retryAfterMs?: number
}

export interface QqSessionState {
  sessionId: string
  lastSeq: number | null
}
