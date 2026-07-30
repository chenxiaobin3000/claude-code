#!/usr/bin/env bun

process.env.CLAUDE_CODE_VALIDATION = '1'
process.env.CLAUDE_CODE_PERF_DIAGNOSTICS = '1'

const {
  capturePerformanceBaselineSample,
  formatPerformanceBaselineSample,
  getPerformanceMetricSnapshot,
  incrementPerformanceCounter,
  resetPerformanceBaselineForValidation,
  setPerformanceGauge,
} = await import('../../src/utils/performanceBaseline.js')
const { createStatsStore } = await import('../../src/context/stats.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

resetPerformanceBaselineForValidation()
const stats = createStatsStore()
stats.observe('frame_duration_ms', 10)
stats.observe('frame_duration_ms', 30)
stats.increment('frame_yoga_cache_hits', 4)
stats.set('frame_yoga_live', 9)
stats.set('unsafe.metric.name', 123)

incrementPerformanceCounter('stream_events', 3)
incrementPerformanceCounter('stream_text_chars', 24)
setPerformanceGauge('agent_active', 2)
incrementPerformanceCounter('prompt-secret-value', 99)

const metrics = getPerformanceMetricSnapshot(stats)
assert(metrics.stream_events === 3, 'stream counter must be exported')
assert(metrics.stream_text_chars === 24, 'stream size counter must be exported')
assert(metrics.agent_active === 2, 'agent gauge must be exported')
assert(
  metrics.frame_duration_ms_count === 2,
  'frame histogram must be exported',
)
assert(metrics.frame_duration_ms_avg === 20, 'frame average must be exported')
assert(
  metrics.frame_yoga_cache_hits === 4,
  'render cache counter must be exported',
)
assert(metrics.frame_yoga_live === 9, 'render live-node gauge must be exported')
assert(
  !Object.hasOwn(metrics, 'unsafe.metric.name'),
  'unsafe metric names must be omitted',
)
assert(
  !Object.hasOwn(metrics, 'prompt-secret-value'),
  'arbitrary labels must not become diagnostic fields',
)

const sample = capturePerformanceBaselineSample({
  sequence: 7,
  eventLoopLagMs: 12.5,
  stats,
  now: new Date('2026-07-31T00:00:00.000Z'),
})
assert(sample.schemaVersion === 1, 'schema version must be stable')
assert(sample.sequence === 7, 'sequence must be retained')
assert(sample.eventLoopLagMs === 12.5, 'event-loop lag must be numeric')
assert(sample.memory.rssBytes > 0, 'RSS must be captured')
assert(sample.memory.heapUsedBytes > 0, 'heap usage must be captured')
assert(sample.cpu.userMicros >= 0, 'CPU usage must be captured')
assert(sample.resources.activeHandles >= 0, 'active handles must be captured')

const line = formatPerformanceBaselineSample(sample)
assert(line.startsWith('[PerformanceBaseline] {'), 'line prefix must be stable')
assert(
  !line.includes('prompt-secret-value'),
  'formatted line must omit unsafe labels',
)
assert(
  !line.includes('unsafe.metric.name'),
  'formatted line must omit unsafe stats',
)

const parsed = JSON.parse(line.slice('[PerformanceBaseline] '.length)) as {
  metrics: Record<string, number>
}
assert(
  parsed.metrics.stream_events === 3,
  'formatted sample must remain parseable',
)

resetPerformanceBaselineForValidation()
console.log('performance baseline validation passed')
