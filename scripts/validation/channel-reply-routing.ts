#!/usr/bin/env bun

import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../src/Tool.js'
import type { Message } from '../../src/types/message.js'
import type { ChannelEntry } from '../../src/bootstrap/state.js'
import {
  collectChannelReplyTargets,
  dispatchConfiguredChannelReplies,
  resolveChannelReplyPlan,
} from '../../src/services/mcp/channelReply.js'
import { createAssistantMessage } from '../../src/utils/messages/factories.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const channels: ChannelEntry[] = [
  {
    kind: 'plugin',
    name: 'telegram',
    marketplace: 'local',
    reply: 'mcp__plugin_telegram_telegram__reply',
  },
  {
    kind: 'plugin',
    name: 'weixin',
    marketplace: 'local',
    reply: 'mcp__plugin_weixin_weixin__reply',
  },
]

function inbound(
  server: string,
  chatId: string,
  messageId: string,
): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    message: { role: 'user', content: 'hello' },
    origin: {
      kind: 'channel',
      server,
      meta: { chat_id: chatId, message_id: messageId },
    },
  } as unknown as Message
}

const targets = collectChannelReplyTargets(
  [
    inbound('plugin:telegram:telegram', 'primary::private::1', '10'),
    inbound('plugin:telegram:telegram', 'primary::private::1', '11'),
    inbound('plugin:weixin:weixin', 'wx::contact::2', '20'),
  ],
  channels,
)
assertEqual(targets.length, 2, 'merged targets deduplicate by server and chat')
assertEqual(targets[0]?.messageId, '11', 'latest message ID wins')
assertEqual(
  targets[1]?.reply,
  'mcp__plugin_weixin_weixin__reply',
  'source selects its configured reply tool',
)
assertEqual(
  collectChannelReplyTargets(
    [
      {
        ...inbound('plugin:telegram:telegram', 'ignored', '1'),
        origin: undefined,
      } as Message,
    ],
    channels,
  ).length,
  0,
  'non-Channel messages remain unchanged',
)

const final = createAssistantMessage({ content: 'final response' })
const plan = resolveChannelReplyPlan([final], targets)
assert(plan, 'plain final text creates a Channel reply plan')

const called: Array<{ name: string; input: Record<string, unknown> }> = []
function fakeTool(
  name: string,
  serverName: string,
  supportsMessageId: boolean,
): Tool {
  return {
    name,
    mcpInfo: { serverName, toolName: 'reply' },
    inputSchema: z.object({}).passthrough(),
    inputJSONSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        text: { type: 'string' },
        ...(supportsMessageId ? { message_id: { type: 'string' } } : {}),
      },
    },
    isEnabled: () => true,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    checkPermissions: async () => ({
      behavior: 'passthrough',
      message: 'configured Channel reply',
    }),
    call: async input => {
      called.push({ name, input })
      return { data: 'sent' }
    },
  } as Tool
}

const context = {
  abortController: new AbortController(),
  getAppState: () => ({
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
    },
  }),
} as unknown as ToolUseContext

await dispatchConfiguredChannelReplies({
  plan: plan!,
  tools: [
    fakeTool(
      'mcp__plugin_telegram_telegram__reply',
      'plugin:telegram:telegram',
      true,
    ),
    fakeTool(
      'mcp__plugin_weixin_weixin__reply',
      'plugin:weixin:weixin',
      false,
    ),
  ],
  context,
  canUseTool: async () => ({
    behavior: 'allow',
    updatedInput: {},
  }),
})
assertEqual(called.length, 2, 'each configured Channel receives final text')
assertDeepEqual(
  called[0]?.input,
  {
    chat_id: 'primary::private::1',
    message_id: '11',
    text: 'final response',
  },
  'supported message ID is preserved',
)
assertDeepEqual(
  called[1]?.input,
  { chat_id: 'wx::contact::2', text: 'final response' },
  'unsupported message ID is omitted',
)

const proactiveReply = createAssistantMessage({
  content: [
    {
      type: 'tool_use',
      id: 'reply-1',
      name: 'mcp__plugin_telegram_telegram__reply',
      input: { chat_id: 'primary::private::1', text: 'already sent' },
    },
  ],
})
assertEqual(
  resolveChannelReplyPlan([proactiveReply, final], [targets[0]!]),
  null,
  'model-initiated reply suppresses automatic duplicate delivery',
)

console.log('channel reply routing validation passed')
