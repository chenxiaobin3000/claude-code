#!/usr/bin/env bun

process.env.CLAUDE_CODE_VALIDATION = '1'
process.env.CLAUDE_CODE_PERF_DIAGNOSTICS = '1'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  getCompactCleanupCallbackCount,
  registerCompactCleanup,
  runPostCompactCleanup,
} from '../../src/services/compact/postCompactCleanup.js'
import { recoverBackgroundInfrastructure } from '../../src/utils/backgroundSupervisor.js'
import { createStreamRenderBackpressure } from '../../src/utils/messages/streamRenderBackpressure.js'
import {
  getPerformanceMetricSnapshot,
  resetPerformanceBaselineForValidation,
} from '../../src/utils/performanceBaseline.js'
import { withWindowsFileRetry } from '../../src/utils/windowsFileRetry.js'
import { STABILITY_THRESHOLDS as limits } from './stability-thresholds.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const root = resolve(import.meta.dir, '../..')
const verifySource = await readFile(resolve(root, 'scripts/verify.ts'), 'utf8')
const requiredMatrix = [
  'openai-stream.ts',
  'model-profiles.ts',
  'mcp-lifecycle.ts',
  'agent-lifecycle.ts',
  'agent-permission-relay.ts',
  'agent-resource-cleanup.ts',
  'background-task-lifecycle.ts',
  'clear-resume-rewind.ts',
  'windows-file-contention.ts',
  'background-supervisor.ts',
]
for (const script of requiredMatrix) {
  assert(verifySource.includes(script), `verify matrix omitted ${script}`)
}

resetPerformanceBaselineForValidation()
const baselineCallbacks = getCompactCleanupCallbackCount()
const baselineMemory = process.memoryUsage()
const baselineHandles = (
  process as unknown as { _getActiveHandles?: () => unknown[] }
)._getActiveHandles?.().length ?? 0
let text: string | null = null
let flushes = 0
let logicalTime = 0

for (let window = 0; window < limits.pressureWindows; window++) {
  const timers = new Map<number, () => void>()
  let timerId = 0
  const batcher = createStreamRenderBackpressure({
    scheduler: {
      now: () => logicalTime,
      schedule(callback) {
        const id = ++timerId
        timers.set(id, callback)
        return id
      },
      cancel(handle) {
        timers.delete(handle as number)
      },
    },
    commit(update) {
      text = update(text)
      flushes++
    },
  })
  for (let delta = 0; delta < limits.streamDeltasPerWindow; delta++) {
    batcher.enqueue(current => `${current ?? ''}x`)
  }
  batcher.flush(true)
  batcher.dispose()
  timers.clear()
  logicalTime += 100

  const unregister = registerCompactCleanup(() => {
    text = null
  })
  runPostCompactCleanup('repl_main_thread')
  unregister()
  assert(text === null, `window ${window} did not release streaming text`)
  assert(
    getCompactCleanupCallbackCount() === baselineCallbacks,
    `window ${window} retained a cleanup callback`,
  )
}

const streamUpdates =
  limits.pressureWindows * limits.streamDeltasPerWindow
assert(
  flushes / streamUpdates <= limits.maxStreamFlushRatio,
  `stream flush ratio ${flushes / streamUpdates} exceeded ${limits.maxStreamFlushRatio}`,
)

let restarts = 0
const recovered = await recoverBackgroundInfrastructure({
  signal: new AbortController().signal,
  random: () => 0,
  sleep: async () => {},
  restart: async () => {
    restarts++
    if (restarts < 3) throw new Error('pressure fixture crash')
    return true
  },
})
assert(recovered === true, 'pressure supervisor did not recover')
assert(
  restarts <= limits.maxBackgroundRestarts,
  'pressure supervisor exceeded restart limit',
)

let fileAttempts = 0
let fileBackoffMs = 0
await withWindowsFileRetry(
  () => {
    fileAttempts++
    if (fileAttempts < limits.maxWindowsFileAttempts) {
      throw Object.assign(new Error('locked'), { code: 'EPERM' })
    }
  },
  {
    platform: 'win32',
    random: () => 0.5,
    sleep: async delay => {
      fileBackoffMs += delay
    },
  },
)
assert(
  fileAttempts === limits.maxWindowsFileAttempts,
  'file retry attempt ceiling changed',
)
assert(
  fileBackoffMs <= limits.maxWindowsFileBackoffMs,
  'file retry time ceiling changed',
)

const finalMemory = process.memoryUsage()
assert(
  finalMemory.heapUsed - baselineMemory.heapUsed <= limits.maxHeapGrowthBytes,
  'five-window heap growth exceeded the fixed tolerance',
)
const finalHandles = (
  process as unknown as { _getActiveHandles?: () => unknown[] }
)._getActiveHandles?.().length ?? 0
assert(
  finalHandles - baselineHandles <= limits.maxActiveHandleDrift,
  'active handles did not return to the fixed tolerance',
)
const metrics = getPerformanceMetricSnapshot()
assert(metrics.stream_render_pending === 0, 'stream pending gauge leaked')
assert(
  metrics.retained_compact_cleanup_callbacks === baselineCallbacks,
  'retained callback gauge drifted',
)

resetPerformanceBaselineForValidation()
console.log(
  `[stability-pressure] PASS (${limits.pressureWindows} windows, ${streamUpdates} deltas, flush ratio ${(flushes / streamUpdates).toFixed(4)})`,
)
