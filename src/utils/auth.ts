import type { OAuthTokens, SubscriptionType } from '../services/oauth/types.js'
import type { AccountInfo } from './config.js'
import { checkHasTrustDialogAccepted } from './config.js'
import { errorMessage } from './errors.js'
import { execSyncWithDefaults_DEPRECATED } from './execFileNoThrow.js'
import { logError } from './log.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import { jsonParse } from './slowOperations.js'

/**
 * Anthropic account authentication has intentionally been removed from this
 * distribution. These compatibility exports keep account-dependent legacy
 * modules fail-closed while those modules are retired independently.
 */
export function isAnthropicAuthEnabled(): boolean {
  return false
}

export function getAuthTokenSource(): {
  source: string
  hasToken: boolean
} {
  return { source: 'none', hasToken: false }
}

export type ApiKeySource =
  | 'ANTHROPIC_API_KEY'
  | 'apiKeyHelper'
  | '/login managed key'
  | 'none'

export function getAnthropicApiKey(): null {
  return null
}

export function getAnthropicApiKeyWithSource(
  _opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): {
  key: null
  source: ApiKeySource
} {
  return { key: null, source: 'none' }
}

export function getApiKeyFromConfigOrMacOSKeychain(): null {
  return null
}

export function getConfiguredApiKeyHelper(): undefined {
  return undefined
}

export function getApiKeyHelperElapsedMs(): number {
  return 0
}

export async function getApiKeyFromApiKeyHelper(
  _isNonInteractiveSession: boolean,
): Promise<null> {
  return null
}

export function clearApiKeyHelperCache(): void {}

export function prefetchApiKeyFromApiKeyHelperIfSafe(
  _isNonInteractiveSession: boolean,
): void {}

export async function saveApiKey(_apiKey: string): Promise<void> {
  throw new Error(
    'Anthropic account and API-key authentication are not supported in this distribution.',
  )
}

export function saveOAuthTokensIfNeeded(_tokens: OAuthTokens): {
  success: boolean
  warning?: string
} {
  return {
    success: false,
    warning: 'Anthropic account authentication is not supported.',
  }
}

export function getClaudeAIOAuthTokens(): OAuthTokens | null {
  return null
}

export function clearOAuthTokenCache(): void {}

export function checkAndRefreshOAuthTokenIfNeeded(
  _retryCount = 0,
  _force = false,
): Promise<boolean> {
  return Promise.resolve(false)
}

export function handleOAuth401Error(
  _failedAccessToken: string,
): Promise<boolean> {
  return Promise.resolve(false)
}

export function isClaudeAISubscriber(): boolean {
  return false
}

export function hasProfileScope(): boolean {
  return false
}

export function is1PApiCustomer(): boolean {
  return false
}

export function getOauthAccountInfo(): AccountInfo | undefined {
  return undefined
}

export function isOverageProvisioningAllowed(): boolean {
  return false
}

export function getSubscriptionType(): SubscriptionType | null {
  return null
}

export function isMaxSubscriber(): boolean {
  return false
}

export function isTeamSubscriber(): boolean {
  return false
}

export function isTeamPremiumSubscriber(): boolean {
  return false
}

export function isEnterpriseSubscriber(): boolean {
  return false
}

export function isProSubscriber(): boolean {
  return false
}

export function getRateLimitTier(): string | null {
  return null
}

export function getSubscriptionName(): string {
  return 'OpenAI-compatible provider'
}

export function isConsumerSubscriber(): boolean {
  return false
}

export function isUsing3PServices(): boolean {
  return true
}

export type UserAccountInfo = {
  subscription?: string
  tokenSource?: string
  apiKeySource?: ApiKeySource
  organization?: string
  email?: string
}

export function getAccountInformation(): UserAccountInfo | undefined {
  return undefined
}

