import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import type { DeepImmutable } from '../../types/utils.js'
import type { Message, NormalizedMessage } from '../../types/message.js'
import { escapeRegExp } from '../stringUtils.js'

export function extractTag(html: string, tagName: string): string | null {
  if (!html.trim() || !tagName.trim()) return null
  const escapedTag = escapeRegExp(tagName)
  const pattern = new RegExp(
    `<${escapedTag}(?:\\s+[^>]*)?>` +
      '([\\s\\S]*?)' +
      `<\\/${escapedTag}>`,
    'gi',
  )
  let match: RegExpExecArray | null
  let lastIndex = 0
  const openingTag = new RegExp(`<${escapedTag}(?:\\s+[^>]*?)?>`, 'gi')
  const closingTag = new RegExp(`<\\/${escapedTag}>`, 'gi')
  while ((match = pattern.exec(html)) !== null) {
    const content = match[1]
    const beforeMatch = html.slice(lastIndex, match.index)
    let depth = 0
    openingTag.lastIndex = 0
    while (openingTag.exec(beforeMatch) !== null) depth++
    closingTag.lastIndex = 0
    while (closingTag.exec(beforeMatch) !== null) depth--
    if (depth === 0 && content) return content
    lastIndex = match.index + match[0].length
  }
  return null
}

const STRIPPED_TAGS_RE =
  /<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs

export function stripPromptXMLTags(content: string): string {
  return content.replace(STRIPPED_TAGS_RE, '').trim()
}

export function isEmptyMessageText(text: string): boolean {
  return (
    stripPromptXMLTags(text).trim() === '' || text.trim() === NO_CONTENT_MESSAGE
  )
}

export function extractTextContent(
  blocks: readonly { readonly type: string }[],
  separator = '',
): string {
  return blocks
    .filter((block): block is { type: 'text'; text: string } =>
      block.type === 'text',
    )
    .map(block => block.text)
    .join(separator)
}

export function getContentText(
  content: string | DeepImmutable<Array<ContentBlockParam>>,
): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return extractTextContent(content, '\n').trim() || null
  return null
}

export function getAssistantMessageText(message: Message): string | null {
  if (message.type !== 'assistant') return null
  const content = message.message?.content
  return Array.isArray(content) ? extractTextContent(content, '\n').trim() || null : null
}

export function getUserMessageText(
  message: Message | NormalizedMessage,
): string | null {
  if (message.type !== 'user') return null
  return getContentText(message.message?.content as string | ContentBlockParam[])
}
