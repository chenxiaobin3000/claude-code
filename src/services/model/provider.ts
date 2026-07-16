import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { PreparedModelRequest } from './types.js'

export type ModelProviderStream = {
  requestId: string
  model: string
  events: AsyncIterable<BetaRawMessageStreamEvent>
  metadata: {
    endpoint: string
    requestMessages: unknown[]
    requestTools: unknown[]
    maxOutputTokens: number
    thinking: boolean
    sensitiveValues: string[]
  }
}

/** Transport boundary implemented by the configured model protocol. */
export interface ModelProvider {
  readonly id: 'openai'
  createStream(
    request: PreparedModelRequest,
    signal: AbortSignal,
    context: { requestId: string },
  ): Promise<ModelProviderStream>
}
