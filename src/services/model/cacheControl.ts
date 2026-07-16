import type { CacheScope } from '../../utils/api.js'
import type { QuerySource } from '../../constants/querySource.js'

/**
 * Internal SDK-compatible cache marker. OpenAI conversion strips this field;
 * no Anthropic subscription, account, TTL or beta state is consulted.
 */
export function getCacheControl({
  scope,
}: {
  scope?: CacheScope
  querySource?: QuerySource
} = {}): { type: 'ephemeral'; scope?: CacheScope } {
  return {
    type: 'ephemeral',
    ...(scope === 'global' ? { scope } : {}),
  }
}
