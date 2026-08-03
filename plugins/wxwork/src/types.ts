export const WxworkCommand = {
  Subscribe: 'aibot_subscribe',
  Ping: 'ping',
  Respond: 'aibot_respond_msg',
  MessageCallback: 'aibot_msg_callback',
  EventCallback: 'aibot_event_callback',
  UploadInit: 'aibot_upload_media_init',
  UploadChunk: 'aibot_upload_media_chunk',
  UploadFinish: 'aibot_upload_media_finish',
} as const

export interface WxworkFrame<T = Record<string, unknown>> {
  cmd?: string
  headers: { req_id: string; [key: string]: unknown }
  body?: T
  errcode?: number
  errmsg?: string
}

export type WxworkChatType = 'single' | 'group'
export type WxworkMediaType = 'image' | 'voice' | 'video' | 'file'

export interface WxworkMediaReference {
  type: WxworkMediaType
  url: string
  aeskey: string
}

export interface WxworkMessageBody extends Record<string, unknown> {
  msgid: string
  aibotid: string
  chatid?: string
  chattype: WxworkChatType
  from: { userid: string; corpid?: string }
  create_time?: number
  msgtype: string
  text?: { content?: string }
  image?: { url?: string; aeskey?: string }
  voice?: { content?: string }
  video?: { url?: string; aeskey?: string }
  file?: { url?: string; aeskey?: string }
  mixed?: {
    msg_item?: Array<{
      msgtype?: string
      text?: { content?: string }
      image?: { url?: string; aeskey?: string }
    }>
  }
  quote?: Record<string, unknown>
}

export interface NormalizedWxworkMessage {
  messageId: string
  botId: string
  chatType: WxworkChatType
  targetId: string
  senderId: string
  text: string
  media: WxworkMediaReference[]
}

export interface UploadedMedia {
  type: WxworkMediaType
  mediaId: string
  createdAt: string
}
