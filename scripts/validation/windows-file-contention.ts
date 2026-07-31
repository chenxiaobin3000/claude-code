#!/usr/bin/env bun

import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { writeTextContentWithRetry } from '../../src/utils/file.js'
import {
  WINDOWS_FILE_RETRY_DELAYS_MS,
  withWindowsFileRetry,
} from '../../src/utils/windowsFileRetry.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

let attempts = 0
const delays: number[] = []
let validations = 0
const result = await withWindowsFileRetry(
  () => {
    attempts++
    if (attempts <= WINDOWS_FILE_RETRY_DELAYS_MS.length) {
      throw fileError('EBUSY')
    }
    return 'committed'
  },
  {
    platform: 'win32',
    random: () => 0.5,
    sleep: async delay => {
      delays.push(delay)
    },
    beforeRetry: () => {
      validations++
    },
  },
)
assert(result === 'committed', 'bounded retry did not return the operation')
assert(attempts === 6, 'unexpected retry attempt count')
assert(validations === 5, 'identity was not checked before every retry')
assert(
  delays.join(',') === WINDOWS_FILE_RETRY_DELAYS_MS.join(','),
  'retry schedule changed',
)

let nonWindowsAttempts = 0
try {
  await withWindowsFileRetry(
    () => {
      nonWindowsAttempts++
      throw fileError('EBUSY')
    },
    { platform: 'linux', sleep: async () => {} },
  )
  throw new Error('non-Windows conflict was retried')
} catch (error) {
  assert(
    (error as NodeJS.ErrnoException).code === 'EBUSY',
    'non-Windows error identity changed',
  )
}
assert(nonWindowsAttempts === 1, 'non-Windows error must not retry')

let deniedAttempts = 0
try {
  await withWindowsFileRetry(
    () => {
      deniedAttempts++
      throw fileError('ENOENT')
    },
    { platform: 'win32', sleep: async () => {} },
  )
  throw new Error('non-transient error was retried')
} catch (error) {
  assert(
    (error as NodeJS.ErrnoException).code === 'ENOENT',
    'non-transient error identity changed',
  )
}
assert(deniedAttempts === 1, 'non-transient error must not retry')

let staleAttempts = 0
try {
  await withWindowsFileRetry(
    () => {
      staleAttempts++
      throw fileError('EPERM')
    },
    {
      platform: 'win32',
      sleep: async () => {},
      beforeRetry: () => {
        throw new Error('File has been unexpectedly modified')
      },
    },
  )
  throw new Error('stale destination was overwritten')
} catch (error) {
  assert(
    error instanceof Error && error.message.includes('unexpectedly modified'),
    'stale destination did not fail closed',
  )
}
assert(staleAttempts === 1, 'stale destination retried after validation failed')

let realLockResult = 'skipped (non-Windows)'
if (process.platform === 'win32') {
  const directory = await mkdtemp(join(tmpdir(), 'claude-file-lock-'))
  const target = join(directory, '锁定文件.txt')
  await writeFile(target, 'before', 'utf8')
  const lockScript =
    '$p=$env:CLAUDE_LOCK_TARGET;' +
    '$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);' +
    "[Console]::Out.WriteLine('LOCKED');[Console]::Out.Flush();" +
    'Start-Sleep -Milliseconds 250;$f.Dispose()'
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', lockScript],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, CLAUDE_LOCK_TARGET: target },
    },
  )
  try {
    const locked = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('PowerShell lock timed out')),
        5_000,
      )
      timeout.unref?.()
      child.stdout.once('data', chunk => {
        clearTimeout(timeout)
        resolve(String(chunk))
      })
      child.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', code => {
        if (code === 0) return
        clearTimeout(timeout)
        reject(new Error(`PowerShell lock process exited with ${code}`))
      })
    })
    assert(locked.includes('LOCKED'), 'PowerShell did not acquire file lock')
    await writeTextContentWithRetry(target, 'after', 'utf8', 'LF', 'before')
    assert((await readFile(target, 'utf8')) === 'after', 'locked write failed')
    realLockResult = 'passed'
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await Promise.race([
        once(child, 'exit').catch(() => []),
        new Promise<[]>(resolve => setTimeout(() => resolve([]), 1_000)),
      ])
    }
    await rm(directory, { recursive: true, force: true })
  }
}

console.log(
  `[windows-file-contention] PASS (real Windows lock: ${realLockResult})`,
)
