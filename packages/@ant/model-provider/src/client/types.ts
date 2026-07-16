/**
 * Client factory interfaces.
 * Authentication is handled externally — main project provides factory implementations.
 */
export interface ClientFactories {
  /** Get the fail-closed legacy Anthropic-compatible client boundary. */
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
