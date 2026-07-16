import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  CAPPED_DEFAULT_MAX_TOKENS,
  getModelMaxOutputTokens,
} from '../../utils/context.js'
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js'

export function getMaxOutputTokensForModel(model: string): number {
  const limits = getModelMaxOutputTokens(model)
  const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_otk_slot_v1',
    false,
  )
  const defaultTokens = capEnabled
    ? Math.min(limits.default, CAPPED_DEFAULT_MAX_TOKENS)
    : limits.default

  return validateBoundedIntEnvVar(
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    defaultTokens,
    limits.upperLimit,
  ).effective
}
