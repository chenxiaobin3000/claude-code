import type { StatsStore } from '../context/stats.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000
const MIN_SAMPLE_INTERVAL_MS = 250
const MAX_SAMPLE_INTERVAL_MS = 60_000
const MAX_EXPORTED_METRICS = 128

const SAFE_METRIC_PREFIXES = [
  'agent_',
  'cache_',
  'frame_',
  'mcp_',
  'model_',
  'retained_',
  'stream_',
  'task_',
] as const

export type PerformanceBaselineSample = {
  schemaVersion: 1
  sequence: number
  timestamp: string
  uptimeMs: number
  eventLoopLagMs: number
  memory: {
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
    arrayBuffersBytes: number
  }
  cpu: {
    userMicros: number
    systemMicros: number
  }
  resources: {
    activeHandles: number
    activeRequests: number
  }
  metrics: Record<string, number>
}

type NumericMetricState = {
  counters: Map<string, number>
  gauges: Map<string, number>
}

const metricState: NumericMetricState = {
  counters: new Map(),
  gauges: new Map(),
}

let activeSampler: ReturnType<typeof setInterval> | null = null

function isSafeMetricName(name: string): boolean {
  return (
    /^[a-z][a-z0-9_]{0,63}$/.test(name) &&
    SAFE_METRIC_PREFIXES.some(prefix => name.startsWith(prefix))
  )
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function setMetric(
  target: Map<string, number>,
  name: string,
  value: number,
): void {
  if (!isPerformanceBaselineEnabled() || !isSafeMetricName(name)) return
  target.set(name, finiteNonNegative(value))
}

export function isPerformanceBaselineEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PERF_DIAGNOSTICS)
}

export function incrementPerformanceCounter(name: string, value = 1): void {
  if (!isPerformanceBaselineEnabled() || !isSafeMetricName(name)) return
  const increment = finiteNonNegative(value)
  metricState.counters.set(
    name,
    (metricState.counters.get(name) ?? 0) + increment,
  )
}

export function setPerformanceGauge(name: string, value: number): void {
  setMetric(metricState.gauges, name, value)
}

function activeResourceCount(
  method: '_getActiveHandles' | '_getActiveRequests',
): number {
  const getter = (
    process as unknown as Partial<
      Record<typeof method, () => readonly unknown[]>
    >
  )[method]
  if (typeof getter !== 'function') return 0
  try {
    return getter.call(process).length
  } catch {
    return 0
  }
}

export function getPerformanceMetricSnapshot(
  stats?: Pick<StatsStore, 'getAll'>,
): Record<string, number> {
  const result: Record<string, number> = {}
  const sources = [
    Object.fromEntries(metricState.counters),
    Object.fromEntries(metricState.gauges),
    stats?.getAll() ?? {},
  ]

  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      if (Object.keys(result).length >= MAX_EXPORTED_METRICS) return result
      if (!isSafeMetricName(name) || !Number.isFinite(value)) continue
      result[name] = finiteNonNegative(value)
    }
  }
  return result
}

export function capturePerformanceBaselineSample(params: {
  sequence: number
  eventLoopLagMs?: number
  stats?: Pick<StatsStore, 'getAll'>
  now?: Date
}): PerformanceBaselineSample {
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  const now = params.now ?? new Date()

  return {
    schemaVersion: 1,
    sequence: Math.max(0, Math.floor(params.sequence)),
    timestamp: now.toISOString(),
    uptimeMs: Math.round(process.uptime() * 1_000),
    eventLoopLagMs: finiteNonNegative(params.eventLoopLagMs ?? 0),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    },
    cpu: {
      userMicros: cpu.user,
      systemMicros: cpu.system,
    },
    resources: {
      activeHandles: activeResourceCount('_getActiveHandles'),
      activeRequests: activeResourceCount('_getActiveRequests'),
    },
    metrics: getPerformanceMetricSnapshot(params.stats),
  }
}

export function formatPerformanceBaselineSample(
  sample: PerformanceBaselineSample,
): string {
  return `[PerformanceBaseline] ${JSON.stringify(sample)}`
}

function resolveSampleInterval(env: NodeJS.ProcessEnv): number {
  const raw = env.CLAUDE_CODE_PERF_SAMPLE_INTERVAL_MS
  if (!raw) return DEFAULT_SAMPLE_INTERVAL_MS
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) return DEFAULT_SAMPLE_INTERVAL_MS
  return Math.min(
    MAX_SAMPLE_INTERVAL_MS,
    Math.max(MIN_SAMPLE_INTERVAL_MS, parsed),
  )
}

export function startPerformanceBaselineSampling(
  stats: Pick<StatsStore, 'getAll'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isPerformanceBaselineEnabled(env) || activeSampler !== null) return

  const intervalMs = resolveSampleInterval(env)
  let sequence = 0
  let expectedAt = performance.now() + intervalMs

  activeSampler = setInterval(() => {
    const current = performance.now()
    const eventLoopLagMs = Math.max(0, current - expectedAt)
    expectedAt = current + intervalMs
    const sample = capturePerformanceBaselineSample({
      sequence: sequence++,
      eventLoopLagMs,
      stats,
    })
    logForDebugging(formatPerformanceBaselineSample(sample), { level: 'info' })
  }, intervalMs)
  activeSampler.unref?.()
}

export function resetPerformanceBaselineForValidation(): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_VALIDATION)) {
    throw new Error(
      'Performance baseline state can only be reset in validation mode',
    )
  }
  if (activeSampler !== null) {
    clearInterval(activeSampler)
    activeSampler = null
  }
  metricState.counters.clear()
  metricState.gauges.clear()
}
