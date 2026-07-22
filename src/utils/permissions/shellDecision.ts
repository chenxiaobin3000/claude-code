import type { PermissionResult } from './PermissionResult.js'

/**
 * Security precedence shared by Bash and PowerShell.
 *
 * The category is deliberately separate from the public allow/ask/deny
 * behavior: two `ask` results do not have the same authority, and a broad
 * allow must never compete at the same level as an exact user rule.
 */
export type ShellDecisionCategory =
  | 'hard-deny'
  | 'explicit-deny'
  | 'mandatory-ask'
  | 'explicit-ask'
  | 'exact-allow'
  | 'constrained-allow'
  | 'default-ask'

export type ShellDecisionCandidate = {
  category: ShellDecisionCategory
  result: PermissionResult
}

const SHELL_DECISION_RANK: Record<ShellDecisionCategory, number> = {
  'hard-deny': 0,
  'explicit-deny': 1,
  'mandatory-ask': 2,
  'explicit-ask': 3,
  'exact-allow': 4,
  'constrained-allow': 5,
  'default-ask': 6,
}

/** Returns the first decision at the highest security precedence. */
export function selectShellDecision(
  candidates: readonly ShellDecisionCandidate[],
): ShellDecisionCandidate | null {
  let selected: ShellDecisionCandidate | undefined
  for (const candidate of candidates) {
    if (
      selected === undefined ||
      SHELL_DECISION_RANK[candidate.category] <
        SHELL_DECISION_RANK[selected.category]
    ) {
      selected = candidate
    }
  }
  return selected ?? null
}

export function reduceShellDecisions(
  candidates: readonly ShellDecisionCandidate[],
): PermissionResult | null {
  return selectShellDecision(candidates)?.result ?? null
}

export function shellDecisionCategoryForResult(
  result: PermissionResult,
  allowCategory: Extract<
    ShellDecisionCategory,
    'exact-allow' | 'constrained-allow'
  > = 'constrained-allow',
  nonRuleAskCategory: Extract<
    ShellDecisionCategory,
    'mandatory-ask' | 'default-ask'
  > = 'default-ask',
): ShellDecisionCategory {
  if (result.behavior === 'deny') {
    return result.decisionReason?.type === 'destructiveOperation' &&
      result.decisionReason.severity === 'hard-deny'
      ? 'hard-deny'
      : 'explicit-deny'
  }
  if (result.behavior === 'ask') {
    if (
      result.decisionReason?.type === 'rule' &&
      result.decisionReason.rule.ruleBehavior === 'ask'
    ) {
      return 'explicit-ask'
    }
    return result.decisionReason?.type === 'safetyCheck' ||
      result.decisionReason?.type === 'destructiveOperation' ||
      result.isBashSecurityCheckForMisparsing === true
      ? 'mandatory-ask'
      : nonRuleAskCategory
  }
  return result.behavior === 'allow' ? allowCategory : 'default-ask'
}
