/**
 * Client factory interfaces.
 * Authentication is handled externally — main project provides factory implementations.
 */
export interface ClientFactories {
  /** Get a legacy Anthropic-compatible client (Foundry only). */
  getAnthropicClient: (params: {
    model?: string
    maxRetries: number
    fetchOverride?: unknown
    source?: string
  }) => Promise<unknown>

  /** Get OpenAI-compatible client */
  getOpenAIClient: (params: {
    maxRetries: number
    fetchOverride?: unknown
    source?: string
  }) => unknown
}
