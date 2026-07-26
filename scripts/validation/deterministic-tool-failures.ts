#!/usr/bin/env bun

import {
  deterministicFileFailureKey,
  isDeterministicFileFailure,
  recordDeterministicFileFailure,
  shouldBlockRepeatedDeterministicFailure,
} from '../../src/services/tools/deterministicFailureGuard.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[deterministic-tool-failures] ${message}`)
}

const signal = new AbortController().signal
const bashPathKey = deterministicFileFailureKey('Read', {
  file_path: '/d/AI/test/example.txt',
})
const nativePathKey = deterministicFileFailureKey('Read', {
  file_path: 'D:/AI/test/example.txt',
})

assert(bashPathKey === nativePathKey, 'Git Bash and native Windows paths differ')
assert(
  deterministicFileFailureKey('Read', { file_path: '/tmp/example.txt' }) !==
    nativePathKey,
  'POSIX path was converted to a Windows drive path',
)
assert(
  !shouldBlockRepeatedDeterministicFailure(signal, bashPathKey),
  'first deterministic failure was blocked',
)
assert(
  recordDeterministicFileFailure(signal, bashPathKey) === 1,
  'first deterministic failure was not recorded',
)
assert(
  !shouldBlockRepeatedDeterministicFailure(signal, bashPathKey),
  'second execution was blocked before its first retry',
)
assert(
  recordDeterministicFileFailure(signal, bashPathKey) === 2,
  'second deterministic failure was not recorded',
)
assert(
  shouldBlockRepeatedDeterministicFailure(signal, bashPathKey),
  'third identical deterministic failure was not blocked',
)
assert(
  !shouldBlockRepeatedDeterministicFailure(
    signal,
    deterministicFileFailureKey('Read', { file_path: 'D:/AI/test/other.txt' }),
  ),
  'different file path was blocked',
)
assert(
  isDeterministicFileFailure(new Error('File does not exist.')), 
  'missing-file error was not classified as deterministic',
)
assert(
  !isDeterministicFileFailure(new Error('socket hang up')),
  'transient network error was classified as deterministic',
)

console.log('[deterministic-tool-failures] PASS')
