import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext, Tools } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { getAssistantMessageText } from '../../utils/messages/text.js'
import { checkRuleBasedPermissions } from '../../utils/permissions/permissions.js'
import type { ChannelEntry } from '../../bootstrap/state.js'
import { findChannelEntry } from './channelNotification.js'

type ChannelOrigin = {
  kind: 'channel'
  server: string
  meta?: Record<string, string>
}

export type ChannelReplyTarget = {
  server: string
  reply: string
  chatId: string
  messageId?: string
}

function channelOrigin(value: unknown): ChannelOrigin | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind !== 'channel' || typeof record.server !== 'string') return null
  const rawMeta = record.meta
  const meta: Record<string, string> = {}
  if (rawMeta && typeof rawMeta === 'object') {
    for (const [key, item] of Object.entries(rawMeta)) {
      if (typeof item === 'string') meta[key] = item
    }
  }
  return { kind: 'channel', server: record.server, meta }
}

export function collectChannelReplyTargets(
  messages: readonly Message[],
  channels: readonly ChannelEntry[],
): ChannelReplyTarget[] {
  const targets = new Map<string, ChannelReplyTarget>()
  for (const message of messages) {
    if (message.type !== 'user') continue
    const origin = channelOrigin(message.origin)
    if (!origin) continue
    const entry = findChannelEntry(origin.server, channels)
    const chatId = origin.meta?.chat_id
    if (!entry?.reply || !chatId) continue
    const target: ChannelReplyTarget = {
      server: origin.server,
      reply: entry.reply,
      chatId,
      ...(origin.meta?.message_id
        ? { messageId: origin.meta.message_id }
        : {}),
    }
    // A merged turn sends one response per source/chat and binds it to the
    // newest inbound message from that target.
    targets.set(`${target.server}\0${target.chatId}`, target)
  }
  return [...targets.values()]
}

function toolUses(message: AssistantMessage): Array<{
  name: string
  input?: Record<string, unknown>
}> {
  const content = message.message?.content
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    if (
      block.type !== 'tool_use' ||
      !('name' in block) ||
      typeof block.name !== 'string'
    ) {
      return []
    }
    const input =
      'input' in block && block.input && typeof block.input === 'object'
        ? (block.input as Record<string, unknown>)
        : undefined
    return [{ name: block.name, input }]
  })
}

export function resolveChannelReplyPlan(
  events: readonly Message[],
  targets: readonly ChannelReplyTarget[],
): {
  text: string
  assistantMessage: AssistantMessage
  targets: ChannelReplyTarget[]
} | null {
  const assistants = events.filter(
    (message): message is AssistantMessage => message.type === 'assistant',
  )
  const finalAssistant = [...assistants]
    .reverse()
    .find(message => !message.isApiErrorMessage && getAssistantMessageText(message))
  if (!finalAssistant) return null
  const text = getAssistantMessageText(finalAssistant)
  if (!text) return null

  const calls = assistants.flatMap(toolUses)
  const pending = targets.filter(
    target =>
      !calls.some(
        call =>
          call.name === target.reply && call.input?.chat_id === target.chatId,
      ),
  )
  return pending.length
    ? { text, assistantMessage: finalAssistant, targets: pending }
    : null
}

function supportsMessageId(tool: Tool): boolean {
  const properties = tool.inputJSONSchema?.properties
  return Boolean(
    properties &&
      typeof properties === 'object' &&
      'message_id' in properties,
  )
}

export async function dispatchConfiguredChannelReplies({
  plan,
  tools,
  context,
  canUseTool,
}: {
  plan: NonNullable<ReturnType<typeof resolveChannelReplyPlan>>
  tools: Tools
  context: ToolUseContext
  canUseTool: CanUseToolFn
}): Promise<void> {
  for (const target of plan.targets) {
    const tool = tools.find(candidate => candidate.name === target.reply)
    if (
      !tool ||
      tool.mcpInfo?.serverName !== target.server ||
      !tool.mcpInfo?.toolName
    ) {
      throw new Error(
        `Configured Channel reply tool ${target.reply} is not provided by ${target.server}.`,
      )
    }
    const input: Record<string, unknown> = {
      chat_id: target.chatId,
      text: plan.text,
      ...(target.messageId && supportsMessageId(tool)
        ? { message_id: target.messageId }
        : {}),
    }
    const validation = await tool.validateInput?.(input, context)
    if (validation && !validation.result) {
      throw new Error(
        `Configured Channel reply input is invalid: ${validation.message}`,
      )
    }
    // The user-level/managed channels.reply entry is the affirmative grant
    // for passive final-response delivery. Explicit ask/deny and hard tool
    // safety decisions still block automatic delivery.
    const permission = await checkRuleBasedPermissions(tool, input, context)
    if (permission) {
      throw new Error(
        `Configured Channel reply ${permission.behavior}: ${permission.message}`,
      )
    }
    await tool.call(input, context, canUseTool, plan.assistantMessage)
  }
}
