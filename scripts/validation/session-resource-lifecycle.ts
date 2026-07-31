#!/usr/bin/env bun

process.env.CLAUDE_CODE_VALIDATION = '1'
process.env.CLAUDE_CODE_PERF_DIAGNOSTICS = '1'

import {
  getCompactCleanupCallbackCount,
  registerCompactCleanup,
  runPostCompactCleanup,
} from '../../src/services/compact/postCompactCleanup.js'
import {
  getPerformanceMetricSnapshot,
  resetPerformanceBaselineForValidation,
} from '../../src/utils/performanceBaseline.js'
import { createContentReplacementState } from '../../src/utils/toolResultStorage.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

resetPerformanceBaselineForValidation()
const initialCount = getCompactCleanupCallbackCount()
let cleanupRuns = 0
let replacementState = createContentReplacementState()
replacementState.seenIds.add('old-tool')
replacementState.replacements.set('old-tool', 'stored-preview')

const unregister = registerCompactCleanup(() => {
  cleanupRuns++
  replacementState = createContentReplacementState()
})
assert(
  getCompactCleanupCallbackCount() === initialCount + 1,
  'resource callback was not registered exactly once',
)

for (let window = 0; window < 5; window++) {
  runPostCompactCleanup('repl_main_thread')
  assert(
    getCompactCleanupCallbackCount() === initialCount + 1,
    'repeated cleanup retained duplicate callbacks',
  )
}
assert(cleanupRuns === 5, 'registered resource was not cleaned per lifecycle')
assert(replacementState.seenIds.size === 0, 'seen tool IDs were retained')
assert(
  replacementState.replacements.size === 0,
  'tool replacement previews were retained',
)

unregister()
unregister()
assert(
  getCompactCleanupCallbackCount() === initialCount,
  'idempotent unregister did not restore baseline',
)
const metrics = getPerformanceMetricSnapshot()
assert(
  metrics.retained_compact_cleanup_callbacks === initialCount,
  'retained resource gauge did not return to baseline',
)

resetPerformanceBaselineForValidation()
console.log('[session-resource-lifecycle] PASS')
