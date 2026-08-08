import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireChannelConnectionLease } from '../../plugins/shared/connectionLease.js'
import { assert, assertEqual } from './assertions.js'

const root = mkdtempSync(join(tmpdir(), 'channel-connection-lease-'))

function assertThrows(operation: () => unknown, includes: string): void {
  try {
    operation()
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(includes),
      `expected error containing ${includes}`,
    )
    return
  }
  throw new Error(`expected error containing ${includes}`)
}

function stateDir(name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

function lockPath(directory: string): string {
  return join(directory, 'connection.lock')
}

function options(directory: string, alias = 'primary') {
  return {
    stateDir: directory,
    host: 'qq-host',
    alias,
    displayName: `QQ bot ${alias}`,
  }
}

try {
  const primaryDir = stateDir('primary')
  const primary = acquireChannelConnectionLease(options(primaryDir))
  const record = JSON.parse(readFileSync(lockPath(primaryDir), 'utf8')) as {
    version?: unknown
    pid?: unknown
    processStartedAt?: unknown
    host?: unknown
    alias?: unknown
    ownerId?: unknown
  }
  assertEqual(record.version, 2, 'new connection lock schema version')
  assertEqual(record.pid, process.pid, 'connection lock owner PID')
  assert(
    typeof record.processStartedAt === 'number',
    'connection lock records process birth time',
  )
  assertEqual(record.host, 'qq-host', 'connection lock Host identity')
  assertEqual(record.alias, 'primary', 'connection lock account alias')
  assert(
    typeof record.ownerId === 'string' && record.ownerId.length > 0,
    'connection lock records a unique owner ID',
  )
  assertThrows(
    () => acquireChannelConnectionLease(options(primaryDir)),
    'active Host connection',
  )

  const secondaryDir = stateDir('secondary')
  const secondary = acquireChannelConnectionLease(
    options(secondaryDir, 'secondary'),
  )
  secondary.release()
  assert(
    !existsSync(lockPath(secondaryDir)),
    'different account lease releases independently',
  )
  primary.release()
  primary.release()
  assert(!existsSync(lockPath(primaryDir)), 'release is idempotent')

  const reusedPidDir = stateDir('reused-pid')
  writeFileSync(
    lockPath(reusedPidDir),
    `${JSON.stringify({
      version: 2,
      pid: process.pid,
      processStartedAt: 1,
      host: 'qq-host',
      alias: 'primary',
      ownerId: 'stale-owner',
      acquiredAt: '2000-01-01T00:00:00.000Z',
    })}\n`,
  )
  const recoveredReusedPid = acquireChannelConnectionLease(
    options(reusedPidDir),
  )
  recoveredReusedPid.release()
  assert(
    !existsSync(lockPath(reusedPidDir)),
    'a reused live PID with a different process birth time is recovered',
  )

  const wrongHostDir = stateDir('wrong-host')
  writeFileSync(
    lockPath(wrongHostDir),
    `${JSON.stringify({
      version: 2,
      pid: process.pid,
      processStartedAt: Date.now() - process.uptime() * 1_000,
      host: 'another-host',
      alias: 'primary',
      ownerId: 'wrong-host-owner',
      acquiredAt: new Date().toISOString(),
    })}\n`,
  )
  const recoveredWrongHost = acquireChannelConnectionLease(
    options(wrongHostDir),
  )
  recoveredWrongHost.release()

  const legacyDir = stateDir('legacy')
  writeFileSync(
    lockPath(legacyDir),
    `${JSON.stringify({
      pid: process.pid,
      startedAt: '2000-01-01T00:00:00.000Z',
    })}\n`,
  )
  const recoveredLegacy = acquireChannelConnectionLease(options(legacyDir))
  recoveredLegacy.release()
  assert(
    !existsSync(lockPath(legacyDir)),
    'legacy PID-reuse lock is migrated automatically',
  )

  const ownershipDir = stateDir('ownership')
  const oldLease = acquireChannelConnectionLease(options(ownershipDir))
  const replacement = JSON.parse(
    readFileSync(lockPath(ownershipDir), 'utf8'),
  ) as Record<string, unknown>
  replacement.ownerId = 'replacement-owner'
  writeFileSync(lockPath(ownershipDir), `${JSON.stringify(replacement)}\n`)
  oldLease.release()
  assert(
    existsSync(lockPath(ownershipDir)),
    'an old owner cannot remove a replacement lock',
  )

  const invalidDir = stateDir('invalid')
  writeFileSync(lockPath(invalidDir), '{invalid')
  assertThrows(
    () => acquireChannelConnectionLease(options(invalidDir)),
    'ownership could not be verified',
  )

  const externalPid = Number(process.env.CHANNEL_LEASE_EXTERNAL_PID)
  if (Number.isSafeInteger(externalPid) && externalPid > 0) {
    const externalPidDir = stateDir('external-reused-pid')
    writeFileSync(
      lockPath(externalPidDir),
      `${JSON.stringify({
        version: 2,
        pid: externalPid,
        processStartedAt: 1,
        host: 'qq-host',
        alias: 'primary',
        ownerId: 'external-stale-owner',
        acquiredAt: '2000-01-01T00:00:00.000Z',
      })}\n`,
    )
    const recoveredExternalPid = acquireChannelConnectionLease(
      options(externalPidDir),
    )
    recoveredExternalPid.release()
    assert(
      !existsSync(lockPath(externalPidDir)),
      'a live external PID owned by another process is recovered',
    )
  }

  process.stdout.write('channel connection lease validation passed\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
