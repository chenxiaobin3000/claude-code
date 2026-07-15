import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getInitialSettings } from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'

export function getAPIProvider(
  _settings: Pick<SettingsJson, 'modelType'> = getInitialSettings(),
): APIProvider {
  // This distribution only routes model inference through the OpenAI-compatible
  // path. The wider APIProvider union remains temporarily for internal legacy
  // data structures while their unreachable provider branches are retired.
  return 'openai'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  // TODO: 这里会有问题, 只配置了 openai 协议的用户, 按理说会为 true 导致问题
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
