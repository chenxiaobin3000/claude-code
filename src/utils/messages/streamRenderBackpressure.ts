import {
  incrementPerformanceCounter,
  setPerformanceGauge,
} from '../performanceBaseline.js'

export const STREAM_RENDER_INTERVAL_MS = 33

export type StreamTextUpdater = (current: string | null) => string | null

export type StreamRenderScheduler = {
  now(): number
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

const defaultScheduler: StreamRenderScheduler = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export type StreamRenderBackpressure = {
  enqueue(update: StreamTextUpdater): void
  flush(endBurst?: boolean): void
  dispose(): void
  readonly pending: boolean
}

/**
 * Coalesces interactive streaming-text state updates without touching the
 * provider/SDK event stream. The first update in a burst is committed
 * immediately; later updates are limited to one commit per interval.
 */
export function createStreamRenderBackpressure(params: {
  commit: (update: StreamTextUpdater) => void
  intervalMs?: number
  scheduler?: StreamRenderScheduler
}): StreamRenderBackpressure {
  const intervalMs = Math.max(1, params.intervalMs ?? STREAM_RENDER_INTERVAL_MS)
  const scheduler = params.scheduler ?? defaultScheduler
  let queuedUpdate: StreamTextUpdater | null = null
  let timer: unknown | null = null
  let lastFlushAt = Number.NEGATIVE_INFINITY
  let burstActive = false
  let disposed = false

  const updatePendingGauge = () =>
    setPerformanceGauge('stream_render_pending', queuedUpdate ? 1 : 0)

  const clearTimer = () => {
    if (timer === null) return
    scheduler.cancel(timer)
    timer = null
  }

  const commitQueued = () => {
    if (!queuedUpdate || disposed) return
    const update = queuedUpdate
    queuedUpdate = null
    updatePendingGauge()
    lastFlushAt = scheduler.now()
    incrementPerformanceCounter('stream_render_flushes')
    params.commit(update)
  }

  const scheduleFlush = () => {
    if (timer !== null || !queuedUpdate || disposed) return
    const elapsed = scheduler.now() - lastFlushAt
    const delayMs = Math.max(0, intervalMs - elapsed)
    timer = scheduler.schedule(() => {
      timer = null
      commitQueued()
      if (queuedUpdate) scheduleFlush()
    }, delayMs)
  }

  return {
    enqueue(update) {
      if (disposed) return
      incrementPerformanceCounter('stream_render_updates')
      if (queuedUpdate) {
        const previous = queuedUpdate
        queuedUpdate = current => update(previous(current))
      } else {
        queuedUpdate = update
      }
      updatePendingGauge()

      if (!burstActive) {
        burstActive = true
        clearTimer()
        commitQueued()
        return
      }

      if (scheduler.now() - lastFlushAt >= intervalMs) {
        clearTimer()
        commitQueued()
      } else {
        scheduleFlush()
      }
    },
    flush(endBurst = false) {
      if (disposed) return
      clearTimer()
      commitQueued()
      if (endBurst) burstActive = false
    },
    dispose() {
      if (disposed) return
      clearTimer()
      queuedUpdate = null
      burstActive = false
      disposed = true
      updatePendingGauge()
    },
    get pending() {
      return queuedUpdate !== null
    },
  }
}
