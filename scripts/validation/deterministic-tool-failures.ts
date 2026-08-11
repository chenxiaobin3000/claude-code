#!/usr/bin/env bun

import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearDeterministicFileFailures,
  deterministicFileFailureKey,
  isDeterministicFileFailure,
  recordDeterministicFileFailure,
  shouldBlockRepeatedDeterministicFailure,
} from '../../src/services/tools/deterministicFailureGuard.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[deterministic-tool-failures] ${message}`)
}

const signal = new AbortController().signal
const missingError = new Error('File does not exist.')
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
  recordDeterministicFileFailure(signal, bashPathKey, missingError) === 1,
  'first deterministic failure was not recorded',
)
assert(
  !shouldBlockRepeatedDeterministicFailure(signal, bashPathKey),
  'second execution was blocked before its first retry',
)
assert(
  recordDeterministicFileFailure(signal, bashPathKey, missingError) === 2,
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

const fixtureRoot = mkdtempSync(join(tmpdir(), 'claude-deterministic-failure-'))
try {
  const changingPath = join(fixtureRoot, 'created-after-failure.txt')
  const changingKey = deterministicFileFailureKey('Read', {
    file_path: changingPath,
  })
  recordDeterministicFileFailure(signal, changingKey, missingError)
  recordDeterministicFileFailure(signal, changingKey, missingError)
  assert(
    shouldBlockRepeatedDeterministicFailure(signal, changingKey),
    'unchanged missing file was not blocked',
  )
  writeFileSync(changingPath, 'created')
  assert(
    !shouldBlockRepeatedDeterministicFailure(signal, changingKey),
    'file creation did not invalidate the missing-file failures',
  )

  const modifiedPath = join(fixtureRoot, 'modified-after-failure.txt')
  writeFileSync(modifiedPath, 'before')
  const modifiedKey = deterministicFileFailureKey('Edit', {
    file_path: modifiedPath,
  })
  const permissionError = new Error('denied by your permission settings')
  recordDeterministicFileFailure(signal, modifiedKey, permissionError)
  recordDeterministicFileFailure(signal, modifiedKey, permissionError)
  assert(
    shouldBlockRepeatedDeterministicFailure(signal, modifiedKey),
    'unchanged permission failure was not blocked',
  )
  appendFileSync(modifiedPath, '-after')
  assert(
    !shouldBlockRepeatedDeterministicFailure(signal, modifiedKey),
    'file modification did not invalidate the previous failure state',
  )

  const sharedPath = join(fixtureRoot, 'cross-tool-clear.txt')
  const readKey = deterministicFileFailureKey('Read', { file_path: sharedPath })
  const writeKey = deterministicFileFailureKey('Write', {
    file_path: sharedPath,
  })
  recordDeterministicFileFailure(signal, readKey, missingError)
  recordDeterministicFileFailure(signal, readKey, missingError)
  clearDeterministicFileFailures(signal, writeKey)
  assert(
    !shouldBlockRepeatedDeterministicFailure(signal, readKey),
    'successful cross-tool operation did not clear failures for the path',
  )

  assert(
    deterministicFileFailureKey('NotebookEdit', {
      notebook_path: join(fixtureRoot, 'fixture.ipynb'),
    }) !== undefined,
    'NotebookEdit notebook_path was not fingerprinted',
  )

  const changedClassKey = deterministicFileFailureKey('Read', {
    file_path: join(fixtureRoot, 'failure-class.txt'),
  })
  recordDeterministicFileFailure(signal, changedClassKey, missingError)
  assert(
    recordDeterministicFileFailure(
      signal,
      changedClassKey,
      permissionError,
    ) === 1,
    'a different deterministic failure class inherited the old count',
  )
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log('[deterministic-tool-failures] PASS')
