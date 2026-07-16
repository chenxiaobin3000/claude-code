import type Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions } from '@anthropic-ai/sdk'

/**
 * Legacy Anthropic-compatible client boundary.
 *
 * Runtime inference is OpenAI-compatible only. Dormant callers are retained
 * temporarily so shared SDK message types can be migrated independently, but
 * this boundary must never construct a provider client.
 */
export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<Anthropic> {
  void apiKey
  void maxRetries
  void model
  void fetchOverride
  void source
  throw new Error(
    'Anthropic first-party model access has been removed; configure an OpenAI-compatible model endpoint.',
  )
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
