import type { Message } from '../types/message.js'
import { CROSS_SESSION_MESSAGE_TAG } from '../constants/xml.js'
import { escapeXml, escapeXmlAttr } from './xml.js'

export const CROSS_SESSION_MESSAGE_ORIGIN = 'cross-session'

export function formatCrossSessionMessage(
  from: string | undefined,
  content: string,
): string {
  const sender = from?.trim() || 'unknown'
  return `<${CROSS_SESSION_MESSAGE_TAG} from="${escapeXmlAttr(sender)}">\n${escapeXml(content)}\n</${CROSS_SESSION_MESSAGE_TAG}>`
}

/**
 * Tool-result user messages do not start a new turn, so skip them while
 * walking back to the latest prompt-bearing user message.
 */
export function isCrossSessionTurn(
  messages: readonly Message[] | undefined,
): boolean {
  if (!messages) return false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type !== 'user') continue
    if (message.toolUseResult !== undefined) continue
    return message.origin === CROSS_SESSION_MESSAGE_ORIGIN
  }
  return false
}
