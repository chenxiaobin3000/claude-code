import type { EntityLike } from 'telegram/define'

export type TelegramUserPeerType = 'user' | 'group' | 'channel'

export interface TelegramUserRoute {
  accountAlias: string
  peerType: TelegramUserPeerType
  peerId: string
  topicId?: number
}

export interface TelegramUserAttachment {
  kind: 'photo' | 'document' | 'audio' | 'voice' | 'video'
  fileName?: string
  mimeType?: string
  size?: number
}

export interface TelegramUserInboundMessage {
  accountAlias: string
  updateKey: string
  messageId: number
  peerId: string
  peerType: TelegramUserPeerType
  topicId?: number
  senderId: string
  senderName?: string
  text: string
  replyToMessageId?: number
  edited: boolean
  attachments: TelegramUserAttachment[]
  inputPeer: EntityLike
  downloadMedia?: () => Promise<Buffer | null>
}

