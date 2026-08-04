#!/usr/bin/env bun
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import {
  buildStandaloneWithRetry,
  isRetryableStandaloneBuildError,
} from '../standalone-build.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

for (const message of [
  'error.EBUSY',
  'failed to open temporary file to copy bun into',
  'Failed to get temp file path: FileNotFound',
  'FailedToCommit',
]) {
  assert(
    isRetryableStandaloneBuildError(new Error(message)),
    `retryable marker: ${message}`,
  )
}
assert(
  !isRetryableStandaloneBuildError(new Error('Could not resolve dependency')),
  'deterministic build errors are not retryable',
)

let attempts = 0
const leakedTemporaryFile = `.${Date.now().toString(16)}${process.pid.toString(16)}-00000000.bun-build`
const delays: number[] = []
const removals: string[] = []
const logs: string[] = []
const result = await buildStandaloneWithRetry({
  label: 'fixture-host',
  outfile: 'dist/fixture-host.exe',
  platform: 'win32',
  delaysMs: [1, 2, 3],
  build: async () => {
    attempts++
    if (attempts === 1) {
      writeFileSync(leakedTemporaryFile, 'fixture')
      throw new Error('error.EBUSY')
    }
    if (attempts === 2)
      throw new Error('Failed to get temp file path: FileNotFound')
    return 'built'
  },
  sleep: async milliseconds => {
    delays.push(milliseconds)
  },
  removePartialOutput: async path => {
    removals.push(path)
  },
  log: message => logs.push(message),
})
assertEqual(result, 'built', 'transient build eventually succeeds')
assertEqual(attempts, 3, 'two transient failures are retried')
assert(
  !existsSync(leakedTemporaryFile),
  'Bun temporary Runtime copy from the failed attempt is removed',
)
assertDeepEqual(delays, [1, 2], 'bounded retry delays')
assertDeepEqual(
  removals,
  ['dist/fixture-host.exe', 'dist/fixture-host.exe'],
  'partial output is removed before each retry',
)
assert(
  logs.every(message => message.includes('Windows temporary file contention')),
  'retry diagnostic is explicit',
)

for (const test of [
  { platform: 'win32' as const, message: 'Could not resolve dependency' },
  { platform: 'linux' as const, message: 'error.EBUSY' },
]) {
  let count = 0
  try {
    await buildStandaloneWithRetry({
      label: 'non-retry-fixture',
      outfile: 'dist/non-retry-fixture',
      platform: test.platform,
      delaysMs: [1, 2, 3],
      build: async () => {
        count++
        throw new Error(test.message)
      },
      sleep: async () => undefined,
      removePartialOutput: async () => undefined,
      log: () => undefined,
    })
    throw new Error('Expected standalone build failure.')
  } catch (error) {
    assert(
      error instanceof Error && error.message === test.message,
      'original non-retryable error is preserved',
    )
  }
  assertEqual(count, 1, 'non-Windows or deterministic errors fail immediately')
}

console.log('[standalone-build-retry] PASS')
rmSync(leakedTemporaryFile, { force: true })
