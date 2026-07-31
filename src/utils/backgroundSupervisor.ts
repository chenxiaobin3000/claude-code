export type BackgroundSupervisorState =
  | 'running'
  | 'backoff'
  | 'restarting'
  | 'failed'
  | 'stopped'

export type BackgroundSupervisorEvent = {
  state: BackgroundSupervisorState
  attempt: number
  generation: number
  delayMs?: number
  error?: unknown
}

export type BackgroundSupervisorPolicy = {
  baseDelayMs: number
  maxDelayMs: number
  maxFailures: number
}

export const DEFAULT_BACKGROUND_SUPERVISOR_POLICY: BackgroundSupervisorPolicy = {
  baseDelayMs: 250,
  maxDelayMs: 10_000,
  maxFailures: 5,
}

let nextGeneration = 1

function abortError(): Error {
  return Object.assign(new Error('Background recovery stopped'), {
    name: 'AbortError',
  })
}

async function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

/**
 * Recover a reconstructible infrastructure process. Callers must never wrap a
 * business/tool operation that may already have produced side effects.
 */
export async function recoverBackgroundInfrastructure<T>(params: {
  restart: (attempt: number, generation: number) => Promise<T>
  signal: AbortSignal
  onState?: (event: BackgroundSupervisorEvent) => void
  policy?: Partial<BackgroundSupervisorPolicy>
  random?: () => number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<T | undefined> {
  const policy = {
    ...DEFAULT_BACKGROUND_SUPERVISOR_POLICY,
    ...params.policy,
  }
  const generation = nextGeneration++
  const random = params.random ?? Math.random
  const sleep = params.sleep ?? defaultSleep
  let lastError: unknown

  for (let attempt = 1; attempt <= policy.maxFailures; attempt++) {
    if (params.signal.aborted) {
      params.onState?.({ state: 'stopped', attempt, generation })
      return undefined
    }
    const ceiling = Math.min(
      policy.maxDelayMs,
      policy.baseDelayMs * 2 ** (attempt - 1),
    )
    const delayMs = Math.round(Math.max(0, Math.min(1, random())) * ceiling)
    params.onState?.({ state: 'backoff', attempt, generation, delayMs })
    try {
      await sleep(delayMs, params.signal)
    } catch (error) {
      if (params.signal.aborted || (error as Error).name === 'AbortError') {
        params.onState?.({ state: 'stopped', attempt, generation })
        return undefined
      }
      throw error
    }
    if (params.signal.aborted) {
      params.onState?.({ state: 'stopped', attempt, generation })
      return undefined
    }
    params.onState?.({ state: 'restarting', attempt, generation })
    try {
      const result = await params.restart(attempt, generation)
      if (params.signal.aborted) {
        params.onState?.({ state: 'stopped', attempt, generation })
        return undefined
      }
      params.onState?.({ state: 'running', attempt, generation })
      return result
    } catch (error) {
      lastError = error
    }
  }

  params.onState?.({
    state: 'failed',
    attempt: policy.maxFailures,
    generation,
    error: lastError,
  })
  return undefined
}
