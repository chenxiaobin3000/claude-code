import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
  isDeferredTool,
} from '@claude-code-best/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import type { Tools } from '../../Tool.js'
import { toolMatchesName } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import { toolToAPISchema } from '../../utils/api.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  ensureToolResultPairing,
  normalizeMessagesForAPI,
  stripAdvisorBlocks,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../utils/messages.js'
import { isSearchExtraToolsEnabled } from '../../utils/searchExtraTools.js'
import type { ModelQueryOptions } from './types.js'

export type PreparedTools = {
  allTools: Tools
  filteredTools: Tools
  toolSchemas: BetaToolUnion[]
  deferredToolNames: Set<string>
  useSearchExtraTools: boolean
}

/** Select tools and build schemas exactly once before provider handoff. */
export async function prepareTools(
  tools: Tools,
  options: ModelQueryOptions,
): Promise<PreparedTools> {
  let useSearchExtraTools = await isSearchExtraToolsEnabled(
    options.model,
    tools,
    options.getToolPermissionContext,
    options.agents,
    'query',
  )
  const deferredToolNames = new Set<string>()
  if (useSearchExtraTools) {
    for (const tool of tools) {
      if (isDeferredTool(tool)) deferredToolNames.add(tool.name)
    }
  }
  if (
    useSearchExtraTools &&
    deferredToolNames.size === 0 &&
    !options.hasPendingMcpServers
  ) {
    useSearchExtraTools = false
  }

  const filteredTools = useSearchExtraTools
    ? tools.filter(
        tool =>
          !deferredToolNames.has(tool.name) ||
          toolMatchesName(tool, SEARCH_EXTRA_TOOLS_TOOL_NAME),
      )
    : tools.filter(tool => !toolMatchesName(tool, SEARCH_EXTRA_TOOLS_TOOL_NAME))

  const toolSchemas = await Promise.all(
    filteredTools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: options.model,
      }),
    ),
  )

  if (useSearchExtraTools) {
    logForDebugging(
      `Dynamic tool loading: 0/${deferredToolNames.size} deferred tools in API tools array (all via ExecuteExtraTool)`,
    )
  }

  return {
    allTools: tools,
    filteredTools,
    toolSchemas,
    deferredToolNames,
    useSearchExtraTools,
  }
}

/** Normalize conversation state once, before any protocol-specific conversion. */
export function prepareMessages(
  messages: Message[],
  tools: Tools,
  options: { useSearchExtraTools: boolean; allowAdvisorBlocks: boolean },
): (AssistantMessage | UserMessage)[] {
  let prepared = normalizeMessagesForAPI(messages, tools)
  if (!options.useSearchExtraTools) {
    prepared = prepared.map(message => {
      if (message.type === 'user') {
        return stripToolReferenceBlocksFromUserMessage(message)
      }
      if (message.type === 'assistant') {
        return stripCallerFieldFromAssistantMessage(message)
      }
      return message
    })
  }
  prepared = ensureToolResultPairing(prepared)
  if (!options.allowAdvisorBlocks) prepared = stripAdvisorBlocks(prepared)
  return prepared as (AssistantMessage | UserMessage)[]
}
