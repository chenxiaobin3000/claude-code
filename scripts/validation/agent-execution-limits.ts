#!/usr/bin/env bun

import {
  DEFAULT_AGENT_EXECUTION_LIMITS,
  reserveAgentExecution,
  resetAgentBudgetLedgersForValidation,
  resolveAgentExecutionLimits,
  type AgentExecutionLimits,
} from '../../src/utils/agentExecutionPolicy.js'
import { createChildAbortController } from '../../src/utils/abortController.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

process.env.CLAUDE_CODE_VALIDATION = '1'

function expectThrow(fn: () => unknown, fragment: string): void {
  let message = ''
  try {
    fn()
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(
    message.includes(fragment),
    `expected error containing ${JSON.stringify(fragment)}, got ${JSON.stringify(message)}`,
  )
}

assertDeepEqual(
  resolveAgentExecutionLimits({}),
  DEFAULT_AGENT_EXECUTION_LIMITS,
  'default limits',
)
assertDeepEqual(
  resolveAgentExecutionLimits({
    CLAUDE_CODE_MAX_AGENT_DEPTH: '3',
    CLAUDE_CODE_MAX_AGENT_COUNT: '12',
    CLAUDE_CODE_MAX_AGENT_CONCURRENCY: '4',
    CLAUDE_CODE_MAX_AGENT_TOKENS: '250000',
  }),
  {
    maxDepth: 3,
    maxSessionAgents: 12,
    maxConcurrentAgents: 4,
    maxSessionTokens: 250_000,
  },
  'configured limits',
)
expectThrow(
  () =>
    resolveAgentExecutionLimits({
      CLAUDE_CODE_MAX_AGENT_DEPTH: '0',
    }),
  'CLAUDE_CODE_MAX_AGENT_DEPTH must be a positive integer',
)

const limits: AgentExecutionLimits = {
  maxDepth: 2,
  maxSessionAgents: 2,
  maxConcurrentAgents: 2,
  maxSessionTokens: 100,
}

resetAgentBudgetLedgersForValidation()
const rootChild = reserveAgentExecution({
  sessionId: 'limits-depth',
  limits,
})
assertEqual(rootChild.depth, 1, 'direct child depth')
const nestedChild = reserveAgentExecution({
  sessionId: 'limits-depth',
  parentDepth: rootChild.depth,
  inheritedLedger: rootChild.ledger,
  limits,
})
assertEqual(nestedChild.depth, 2, 'nested child depth')
expectThrow(
  () =>
    reserveAgentExecution({
      sessionId: 'limits-depth',
      parentDepth: nestedChild.depth,
      inheritedLedger: nestedChild.ledger,
      limits,
    }),
  'nesting depth 3',
)
expectThrow(
  () =>
    reserveAgentExecution({
      sessionId: 'limits-depth',
      inheritedLedger: rootChild.ledger,
      limits,
    }),
  'session limit reached',
)
assertEqual(rootChild.ledger.activeAgents, 2, 'active count before release')
nestedChild.release(40)
nestedChild.release(40)
assertEqual(rootChild.ledger.activeAgents, 1, 'release is idempotent')
assertEqual(rootChild.ledger.usedTokens, 40, 'token charge is idempotent')
rootChild.release(60)
assertEqual(rootChild.ledger.activeAgents, 0, 'all agents released')
assertEqual(rootChild.ledger.usedTokens, 100, 'session tokens accumulated')
expectThrow(
  () =>
    reserveAgentExecution({
      sessionId: 'limits-depth',
      inheritedLedger: rootChild.ledger,
      countAsNewAgent: false,
      limits,
    }),
  'token budget exhausted',
)

resetAgentBudgetLedgersForValidation()
const concurrentOne = reserveAgentExecution({
  sessionId: 'limits-concurrency',
  limits: { ...limits, maxSessionAgents: 10 },
})
const concurrentTwo = reserveAgentExecution({
  sessionId: 'limits-concurrency',
  inheritedLedger: concurrentOne.ledger,
  limits: { ...limits, maxSessionAgents: 10 },
})
expectThrow(
  () =>
    reserveAgentExecution({
      sessionId: 'limits-concurrency',
      inheritedLedger: concurrentOne.ledger,
      limits: { ...limits, maxSessionAgents: 10 },
    }),
  'concurrency limit reached',
)
concurrentOne.release()
concurrentTwo.release()

const parentAbortController = new AbortController()
const childAbortController = createChildAbortController(parentAbortController)
const grandchildAbortController = createChildAbortController(
  childAbortController,
)
parentAbortController.abort('validation cancellation')
assertEqual(
  childAbortController.signal.aborted,
  true,
  'parent cancellation reaches child',
)
assertEqual(
  grandchildAbortController.signal.aborted,
  true,
  'parent cancellation reaches nested subtree',
)
assertEqual(
  grandchildAbortController.signal.reason,
  'validation cancellation',
  'nested cancellation reason',
)

const projectRoot = new URL('../../', import.meta.url)
const toolConstantsSource = await Bun.file(
  new URL('src/constants/tools.ts', projectRoot),
).text()
const agentToolSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
    projectRoot,
  ),
).text()
const resumeAgentSource = await Bun.file(
  new URL(
    'packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts',
    projectRoot,
  ),
).text()
assert(
  /ASYNC_AGENT_ALLOWED_TOOLS = new Set\(\[\r?\n\s+AGENT_TOOL_NAME/.test(
    toolConstantsSource,
  ),
  'async Agent tool must support bounded nesting',
)
assert(
  agentToolSource.includes(
    'parentAbortController: parentSubagentContext',
  ),
  'nested cancellation must link to the immediate parent',
)
assert(
  resumeAgentSource.includes(
    'parentAbortController: parentSubagentContext',
  ),
  'resumed nested Agent must remain linked to the immediate parent',
)

console.log('agent execution limits validation passed')
