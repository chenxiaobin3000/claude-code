import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'

/**
 * The wider union remains temporarily for dormant Vertex/Foundry data shapes.
 * Runtime inference in this distribution is always OpenAI-compatible.
 */
export type APIProvider = 'firstParty' | 'vertex' | 'foundry' | 'openai'

export function getAPIProvider(): APIProvider {
  return 'openai'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return 'openai' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/** Fail closed for every Anthropic first-party endpoint check. */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  return false
}
