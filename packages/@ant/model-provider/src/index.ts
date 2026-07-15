// @ant/model-provider
// Model provider abstraction layer for Claude Code
//
// This package owns the model calling logic and provides:
// - Core query functions (queryModelWithStreaming, etc.)
// - Provider implementations (Anthropic-compatible and OpenAI-compatible)
// - Type definitions (Message, Tool, Usage, etc.)
// - Dependency injection hooks (analytics, cost tracking, etc.)
//
// Initialization:
//   registerClientFactories({ ... })  // inject auth clients
//   registerHooks({ ... })            // inject analytics/cost/logging

// Hooks (dependency injection)
export { registerHooks, getHooks } from './hooks/index.js'
export type { ModelProviderHooks } from './hooks/types.js'

// Client factories
export { registerClientFactories, getClientFactories } from './client/index.js'
export type { ClientFactories } from './client/types.js'

// Types
export * from './types/index.js'

// Provider model mappings

// Error utilities
export {
  formatAPIError,
  extractConnectionErrorDetails,
  sanitizeAPIError,
  getSSLErrorHint,
  type ConnectionErrorDetails,
} from './errorUtils.js'

// Shared OpenAI conversion utilities
export { anthropicMessagesToOpenAI } from './shared/openaiConvertMessages.js'
export type { ConvertMessagesOptions } from './shared/openaiConvertMessages.js'
export {
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} from './shared/openaiConvertTools.js'
export { adaptOpenAIStreamToAnthropic } from './shared/openaiStreamAdapter.js'
