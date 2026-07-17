import type { Entry, SerializedMessage, TranscriptMessage } from '../../types/logs.js'
import type { Message } from '../../types/message.js'

export function isTranscriptMessage(entry: Entry): entry is TranscriptMessage {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

export function isChainParticipant(message: Pick<Message, 'type'>): boolean {
  return message.type !== 'progress'
}

export function removeExtraFields(
  transcript: TranscriptMessage[],
): SerializedMessage[] {
  return transcript.map(message => {
    const { isSidechain, parentUuid, ...serializedMessage } = message
    return serializedMessage
  })
}
