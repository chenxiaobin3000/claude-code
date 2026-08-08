import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const PROCESS_START_TOLERANCE_MS = 3_000
const LEGACY_ACQUIRE_GRACE_MS = 120_000

type ProcessSnapshot =
  | { state: 'running'; name: string; startedAt: number | null }
  | { state: 'missing' }
  | { state: 'unknown' }

type ConnectionLockRecord = {
  version: 2
  pid: number
  processStartedAt: number
  host: string
  alias: string
  ownerId: string
  acquiredAt: string
}

type LegacyLockRecord = {
  pid?: unknown
  startedAt?: unknown
}

export interface ChannelConnectionLease {
  release(): void
}

export type ChannelConnectionLeaseOptions = {
  stateDir: string
  host: string
  alias: string
  displayName: string
}

function normalizedProcessName(value: string): string {
  const name = value.trim().replace(/^.*[\\/]/, '').toLowerCase()
  return name.endsWith('.exe') ? name.slice(0, -4) : name
}

function processNameMatches(actual: string, expectedHost: string): boolean {
  const name = normalizedProcessName(actual)
  const expected = normalizedProcessName(expectedHost)
  if (name === expected || name === 'bun') return true
  // Linux comm may truncate executable names to 15 bytes.
  return name.length >= 15 && expected.startsWith(name)
}

function inspectWindowsProcess(pid: number): ProcessSnapshot {
  const script =
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;` +
    `if($null -eq $p){exit 3};` +
    `$started=$null;try{$started=$p.StartTime.ToUniversalTime().ToString('o')}catch{};` +
    `[pscustomobject]@{name=$p.ProcessName;startedAt=$started}|ConvertTo-Json -Compress`
  const systemRoot =
    process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const executable = join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const result = spawnSync(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3_000,
    },
  )
  if (result.status === 3) return { state: 'missing' }
  if (result.status !== 0 || !result.stdout.trim()) return { state: 'unknown' }
  try {
    const value = JSON.parse(result.stdout) as {
      name?: unknown
      startedAt?: unknown
    }
    if (typeof value.name !== 'string') return { state: 'unknown' }
    const startedAt =
      typeof value.startedAt === 'string'
        ? Date.parse(value.startedAt)
        : Number.NaN
    return {
      state: 'running',
      name: value.name,
      startedAt: Number.isFinite(startedAt) ? startedAt : null,
    }
  } catch {
    return { state: 'unknown' }
  }
}

function inspectPosixProcess(pid: number): ProcessSnapshot {
  const executable = ['/bin/ps', '/usr/bin/ps'].find(existsSync)
  if (!executable) return { state: 'unknown' }
  const result = spawnSync(
    executable,
    ['-p', String(pid), '-o', 'comm=', '-o', 'lstart='],
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 3_000,
    },
  )
  if (result.status === 1 || !result.stdout.trim()) return { state: 'missing' }
  if (result.status !== 0) return { state: 'unknown' }
  const output = result.stdout.trim()
  const match = output.match(/^(\S+)\s+(.+)$/)
  if (!match) return { state: 'unknown' }
  const startedAt = Date.parse(match[2]!)
  return {
    state: 'running',
    name: match[1]!,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
  }
}

function inspectProcess(pid: number): ProcessSnapshot {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: 'missing' }
  if (pid === process.pid) {
    return {
      state: 'running',
      name: process.execPath,
      startedAt: currentProcessStartedAt(),
    }
  }
  return process.platform === 'win32'
    ? inspectWindowsProcess(pid)
    : inspectPosixProcess(pid)
}

function currentProcessStartedAt(): number {
  return Math.round((Date.now() - process.uptime() * 1_000) / 1_000) * 1_000
}

function isV2Record(value: unknown): value is ConnectionLockRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === 2 &&
    Number.isSafeInteger(record.pid) &&
    typeof record.processStartedAt === 'number' &&
    Number.isFinite(record.processStartedAt) &&
    typeof record.host === 'string' &&
    typeof record.alias === 'string' &&
    typeof record.ownerId === 'string' &&
    typeof record.acquiredAt === 'string'
  )
}

function classifyExistingLock(
  value: unknown,
  options: ChannelConnectionLeaseOptions,
): 'active' | 'stale' | 'unknown' {
  const legacy = value as LegacyLockRecord
  const pid =
    isV2Record(value) || Number.isSafeInteger(legacy?.pid)
      ? Number((value as ConnectionLockRecord | LegacyLockRecord).pid)
      : null
  if (pid === null) return 'unknown'
  const snapshot = inspectProcess(pid)
  if (snapshot.state === 'missing') return 'stale'
  if (snapshot.state === 'unknown') return 'unknown'
  if (!processNameMatches(snapshot.name, options.host)) return 'stale'
  if (isV2Record(value)) {
    if (value.host !== options.host || value.alias !== options.alias)
      return 'stale'
    if (snapshot.startedAt === null) return 'unknown'
    return Math.abs(snapshot.startedAt - value.processStartedAt) <=
      PROCESS_START_TOLERANCE_MS
      ? 'active'
      : 'stale'
  }

  // Legacy locks recorded acquisition time rather than process birth time.
  // Treat a plausible matching Host as active, but recover when the live PID
  // belongs to a process that started after the lock or far before acquisition.
  if (typeof legacy.startedAt !== 'string' || snapshot.startedAt === null)
    return 'unknown'
  const acquiredAt = Date.parse(legacy.startedAt)
  if (!Number.isFinite(acquiredAt)) return 'unknown'
  const lead = acquiredAt - snapshot.startedAt
  return lead >= -PROCESS_START_TOLERANCE_MS && lead <= LEGACY_ACQUIRE_GRACE_MS
    ? 'active'
    : 'stale'
}

function sameOwner(
  value: unknown,
  expected: ConnectionLockRecord,
): boolean {
  return (
    isV2Record(value) &&
    value.pid === expected.pid &&
    value.processStartedAt === expected.processStartedAt &&
    value.host === expected.host &&
    value.alias === expected.alias &&
    value.ownerId === expected.ownerId
  )
}

function readLock(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function acquireChannelConnectionLease(
  options: ChannelConnectionLeaseOptions,
): ChannelConnectionLease {
  const path = join(options.stateDir, 'connection.lock')
  const record: ConnectionLockRecord = {
    version: 2,
    pid: process.pid,
    processStartedAt: currentProcessStartedAt(),
    host: options.host,
    alias: options.alias,
    ownerId: randomUUID(),
    acquiredAt: new Date().toISOString(),
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor: number | null = null
    try {
      descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
      closeSync(descriptor)
      descriptor = null
      let released = false
      return {
        release(): void {
          if (released) return
          released = true
          try {
            if (sameOwner(readLock(path), record)) rmSync(path, { force: true })
          } catch {
            // Never remove a lock whose complete ownership cannot be proven.
          }
        },
      }
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) {
        throw new Error(
          `${options.displayName} already has an active Host connection.`,
        )
      }
      let state: 'active' | 'stale' | 'unknown' = 'unknown'
      try {
        state = classifyExistingLock(readLock(path), options)
      } catch {
        state = 'unknown'
      }
      if (state !== 'stale') {
        const detail =
          state === 'unknown'
            ? ` Lock ownership could not be verified; inspect ${path}.`
            : ''
        throw new Error(
          `${options.displayName} already has an active Host connection.${detail}`,
        )
      }
      try {
        rmSync(path, { force: true })
      } catch {
        if (existsSync(path)) {
          throw new Error(
            `${options.displayName} has a stale connection lock that could not be removed: ${path}.`,
          )
        }
      }
    }
  }
  throw new Error(`${options.displayName} already has an active Host connection.`)
}
