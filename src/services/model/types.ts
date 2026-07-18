import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  BetaJSONOutputFormat,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AgentDefinition } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type {
  QueryChainTracking,
  ToolPermissionContext,
  Tools,
} from '../../Tool.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { Notification } from '../../context/notifications.js'
import type { AgentId } from '../../types/ids.js'
import type { EffortValue } from '../../utils/effort.js'
import type { Message } from '../../types/message.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'

/** Provider-neutral options consumed by the model query orchestrator. */
export type ModelQueryOptions = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notification: Notification) => void
  taskBudget?: { total: number; remaining?: number }
}

/** Shared preprocessing output. Provider implementations must not normalize it again. */
export type PreparedModelRequest = {
  messages: Message[]
  systemPrompt: SystemPrompt
  allTools: Tools
  filteredTools: Tools
  toolSchemas: BetaToolUnion[]
  deferredToolNames: ReadonlySet<string>
  useSearchExtraTools: boolean
  thinkingConfig: ThinkingConfig
  options: ModelQueryOptions
}
