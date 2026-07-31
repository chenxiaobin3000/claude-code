#!/usr/bin/env bun

process.env.CLAUDE_CODE_VALIDATION = '1'
process.env.CLAUDE_CODE_PERF_DIAGNOSTICS = '1'

import {
  createStreamRenderBackpressure,
  STREAM_RENDER_INTERVAL_MS,
  type StreamRenderScheduler,
} from '../../src/utils/messages/streamRenderBackpressure.js'
import {
  getPerformanceMetricSnapshot,
  resetPerformanceBaselineForValidation,
} from '../../src/utils/performanceBaseline.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let now = 0
let nextTimer = 1
const timers = new Map<number, { at: number; callback: () => void }>()
const scheduler: StreamRenderScheduler = {
  now: () => now,
  schedule(callback, delayMs) {
    const id = nextTimer++
    timers.set(id, { at: now + delayMs, callback })
    return id
  },
  cancel(handle) {
    timers.delete(handle as number)
  },
}
function advance(ms: number): void {
  const target = now + ms
  while (true) {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= target)
      .sort((left, right) => left[1].at - right[1].at)[0]
    if (!due) break
    timers.delete(due[0])
    now = due[1].at
    due[1].callback()
  }
  now = target
}

resetPerformanceBaselineForValidation()
let text: string | null = null
const commits: Array<string | null> = []
const batcher = createStreamRenderBackpressure({
  scheduler,
  commit(update) {
    text = update(text)
    commits.push(text)
  },
})

batcher.enqueue(current => (current ?? '') + 'A')
assert(text === 'A', 'first visible delta must flush immediately')
for (const value of ['B', 'C', 'D', 'E']) {
  batcher.enqueue(current => (current ?? '') + value)
}
assert(commits.length === 1, 'same-window deltas must be coalesced')
assert(batcher.pending, 'coalesced delta must remain pending')

advance(STREAM_RENDER_INTERVAL_MS - 1)
assert(commits.length === 1, 'flush happened before interval boundary')
advance(1)
assert(text === 'ABCDE', 'coalesced text order changed')
assert(commits.length === 2, 'coalesced window must commit once')

batcher.enqueue(current => (current ?? '') + 'F')
batcher.enqueue(current => (current ?? '') + 'G')
batcher.flush(true)
assert(text === 'ABCDEFG', 'terminal flush lost pending text')
assert(!batcher.pending, 'terminal flush retained pending state')

batcher.enqueue(() => 'H')
assert(text === 'H', 'new burst must flush its first delta immediately')
batcher.enqueue(current => (current ?? '') + 'I')
batcher.dispose()
advance(STREAM_RENDER_INTERVAL_MS * 2)
assert(text === 'H', 'disposed batcher committed a stale update')
assert(timers.size === 0, 'disposed batcher leaked a timer')

const metrics = getPerformanceMetricSnapshot()
assert(metrics.stream_render_updates === 9, 'update metric mismatch')
assert(metrics.stream_render_flushes === 4, 'flush metric mismatch')
assert(metrics.stream_render_pending === 0, 'pending gauge did not clear')
assert(
  commits.length < metrics.stream_render_updates,
  'render backpressure did not reduce commits',
)

resetPerformanceBaselineForValidation()
console.log('[stream-render-backpressure] PASS')
