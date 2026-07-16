/**
 * Compatibility exports for older internal imports.
 *
 * Model orchestration lives under services/model. Do not add provider,
 * authentication, request, retry, stream, cache-beta, or usage logic here.
 */
export {
  queryModelWithStreaming,
  queryModelWithoutStreaming,
} from '../model/query.js'
export { queryHaiku, queryWithModel } from '../model/queryHelpers.js'
export { getMaxOutputTokensForModel } from '../model/tokenLimits.js'
export { getAPIMetadata } from '../model/metadata.js'
export { getCacheControl } from '../model/cacheControl.js'
export type { ModelQueryOptions as Options } from '../model/types.js'
export {
  accumulateUsage,
  mergeUsage as updateUsage,
} from '../model/usage.js'
