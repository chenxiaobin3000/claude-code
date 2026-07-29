import { isEnvTruthy } from './envUtils.js'

export type AgentBackgroundDecision = {
  runInBackground: boolean
  reason:
    | 'background_tasks_disabled'
    | 'background_unsupported'
    | 'explicit_input'
    | 'agent_definition'
    | 'forced_context'
    | 'default_background'
}

export function resolveAgentBackgroundDecision({
  backgroundTasksDisabled,
  backgroundSupported = true,
  explicit,
  agentDefault,
  forced = false,
}: {
  backgroundTasksDisabled: boolean
  backgroundSupported?: boolean
  explicit?: boolean
  agentDefault?: boolean
  forced?: boolean
}): AgentBackgroundDecision {
  if (backgroundTasksDisabled) {
    return {
      runInBackground: false,
      reason: 'background_tasks_disabled',
    }
  }
  if (!backgroundSupported) {
    return { runInBackground: false, reason: 'background_unsupported' }
  }
  if (forced) {
    return { runInBackground: true, reason: 'forced_context' }
  }
  if (explicit !== undefined) {
    return { runInBackground: explicit, reason: 'explicit_input' }
  }
  if (agentDefault !== undefined) {
    return {
      runInBackground: agentDefault,
      reason: 'agent_definition',
    }
  }
  return { runInBackground: true, reason: 'default_background' }
}

export type AgentExecutionLimits = {
  maxDepth: number
  maxSessionAgents: number
  maxConcurrentAgents: number
  maxSessionTokens: number
}

export const DEFAULT_AGENT_EXECUTION_LIMITS: Readonly<AgentExecutionLimits> =
  Object.freeze({
    maxDepth: 2,
    maxSessionAgents: 50,
    maxConcurrentAgents: 8,
    maxSessionTokens: 1_000_000,
  })

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return parsed
}

export function resolveAgentExecutionLimits(
  env: NodeJS.ProcessEnv = process.env,
): AgentExecutionLimits {
  return {
    maxDepth: positiveInteger(
      env.CLAUDE_CODE_MAX_AGENT_DEPTH,
      'CLAUDE_CODE_MAX_AGENT_DEPTH',
      DEFAULT_AGENT_EXECUTION_LIMITS.maxDepth,
    ),
    maxSessionAgents: positiveInteger(
      env.CLAUDE_CODE_MAX_AGENT_COUNT,
      'CLAUDE_CODE_MAX_AGENT_COUNT',
      DEFAULT_AGENT_EXECUTION_LIMITS.maxSessionAgents,
    ),
    maxConcurrentAgents: positiveInteger(
      env.CLAUDE_CODE_MAX_AGENT_CONCURRENCY,
      'CLAUDE_CODE_MAX_AGENT_CONCURRENCY',
      DEFAULT_AGENT_EXECUTION_LIMITS.maxConcurrentAgents,
    ),
    maxSessionTokens: positiveInteger(
      env.CLAUDE_CODE_MAX_AGENT_TOKENS,
      'CLAUDE_CODE_MAX_AGENT_TOKENS',
      DEFAULT_AGENT_EXECUTION_LIMITS.maxSessionTokens,
    ),
  }
}

export type AgentBudgetLedger = {
  readonly sessionId: string
  spawnedAgents: number
  activeAgents: number
  usedTokens: number
}

const sessionLedgers = new Map<string, AgentBudgetLedger>()

export function getAgentBudgetLedger(sessionId: string): AgentBudgetLedger {
  const existing = sessionLedgers.get(sessionId)
  if (existing) return existing
  const created: AgentBudgetLedger = {
    sessionId,
    spawnedAgents: 0,
    activeAgents: 0,
    usedTokens: 0,
  }
  sessionLedgers.set(sessionId, created)
  return created
}

export type AgentExecutionReservation = {
  readonly depth: number
  readonly ledger: AgentBudgetLedger
  release(tokensUsed?: number): void
}

export function reserveAgentExecution({
  sessionId,
  parentDepth = 0,
  inheritedLedger,
  countAsNewAgent = true,
  limits = resolveAgentExecutionLimits(),
}: {
  sessionId: string
  parentDepth?: number
  inheritedLedger?: AgentBudgetLedger
  countAsNewAgent?: boolean
  limits?: AgentExecutionLimits
}): AgentExecutionReservation {
  const ledger = inheritedLedger ?? getAgentBudgetLedger(sessionId)
  const depth = parentDepth + 1

  if (depth > limits.maxDepth) {
    throw new Error(
      `Agent nesting depth ${depth} exceeds the configured maximum of ${limits.maxDepth}. Complete the work in the current agent or raise CLAUDE_CODE_MAX_AGENT_DEPTH.`,
    )
  }
  if (
    countAsNewAgent &&
    ledger.spawnedAgents >= limits.maxSessionAgents
  ) {
    throw new Error(
      `Agent session limit reached (${limits.maxSessionAgents}). Reuse an existing agent instead of spawning another one.`,
    )
  }
  if (ledger.activeAgents >= limits.maxConcurrentAgents) {
    throw new Error(
      `Agent concurrency limit reached (${limits.maxConcurrentAgents}). Wait for an active agent to finish before spawning another one.`,
    )
  }
  if (ledger.usedTokens >= limits.maxSessionTokens) {
    throw new Error(
      `Agent token budget exhausted (${ledger.usedTokens}/${limits.maxSessionTokens}). Reuse existing results or raise CLAUDE_CODE_MAX_AGENT_TOKENS.`,
    )
  }

  if (countAsNewAgent) ledger.spawnedAgents++
  ledger.activeAgents++
  let released = false

  return {
    depth,
    ledger,
    release(tokensUsed = 0) {
      if (released) return
      released = true
      ledger.activeAgents = Math.max(0, ledger.activeAgents - 1)
      if (Number.isFinite(tokensUsed) && tokensUsed > 0) {
        ledger.usedTokens += Math.floor(tokensUsed)
      }
    },
  }
}

export function resetAgentBudgetLedgersForValidation(): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_VALIDATION)) {
    throw new Error(
      'Agent budget ledgers can only be reset in validation mode',
    )
  }
  sessionLedgers.clear()
}
