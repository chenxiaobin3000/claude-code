#!/usr/bin/env bun

import {
  recoverBackgroundInfrastructure,
  type BackgroundSupervisorEvent,
} from '../../src/utils/backgroundSupervisor.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const events: BackgroundSupervisorEvent[] = []
const delays: number[] = []
let restarts = 0
const controller = new AbortController()
const recovered = await recoverBackgroundInfrastructure({
  signal: controller.signal,
  random: () => 1,
  sleep: async delay => {
    delays.push(delay)
  },
  onState: event => events.push(event),
  restart: async () => {
    restarts++
    if (restarts < 3) throw new Error('fixture crash')
    return 'healthy'
  },
})
assert(recovered === 'healthy', 'infrastructure did not recover')
assert(restarts === 3, 'unexpected restart count')
assert(delays.join(',') === '250,500,1000', 'backoff schedule changed')
assert(
  events.map(event => event.state).join(',') ===
    'backoff,restarting,backoff,restarting,backoff,restarting,running',
  'recovery state order changed',
)
assert(
  new Set(events.map(event => event.generation)).size === 1,
  'one recovery cycle used multiple generations',
)

const failedEvents: BackgroundSupervisorEvent[] = []
let failedRestarts = 0
await recoverBackgroundInfrastructure({
  signal: new AbortController().signal,
  random: () => 0,
  sleep: async () => {},
  onState: event => failedEvents.push(event),
  restart: async () => {
    failedRestarts++
    throw new Error('always fails')
  },
})
assert(failedRestarts === 5, 'circuit breaker did not cap restarts')
assert(failedEvents.at(-1)?.state === 'failed', 'missing failed state')

const stoppedEvents: BackgroundSupervisorEvent[] = []
const stopped = new AbortController()
const stoppedResult = await recoverBackgroundInfrastructure({
  signal: stopped.signal,
  random: () => 1,
  onState: event => stoppedEvents.push(event),
  sleep: async (_delay, signal) => {
    stopped.abort('user-stop')
    if (signal.aborted)
      throw Object.assign(new Error('stopped'), { name: 'AbortError' })
  },
  restart: async () => {
    throw new Error('side effect must not replay')
  },
})
assert(stoppedResult === undefined, 'stopped recovery returned a result')
assert(stoppedEvents.at(-1)?.state === 'stopped', 'missing stopped state')

console.log('[background-supervisor] PASS')
