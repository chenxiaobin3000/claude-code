export type TelegramChatScope = 'private' | 'group'

export interface TelegramRoute {
  botAlias: string
  scope: TelegramChatScope
  chatId: string
  topicId?: number
}

export interface TelegramAttachment {
  kind: 'photo' | 'document' | 'audio' | 'voice' | 'video'
  fileId: string
  fileName?: string
  mimeType?: string
  size?: number
}

export interface TelegramInboundMessage {
  botAlias: string
  updateId: number
  messageId: number
  chatId: string
  scope: TelegramChatScope
  topicId?: number
  senderId: string
  senderName?: string
  text: string
  replyToMessageId?: number
  attachments: TelegramAttachment[]
}
