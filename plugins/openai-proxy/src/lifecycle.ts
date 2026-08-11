import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { acquireChannelConnectionLease } from '../../shared/connectionLease.js'
import { secureSessionPath, type SecurePath } from './auth/session.js'
import {
  getOpenAIProxyBaseUrl,
  resolveLocalToken,
  resolveOpenAIProxyPort,
} from './config.js'
import { startOpenAIProxyGateway } from './gateway.js'

export const OPENAI_PROXY_CLIENT_HEARTBEAT_MS = 5_000
export const OPENAI_PROXY_CLIENT_LEASE_TTL_MS = 20_000
export const OPENAI_PROXY_IDLE_EXIT_MS = 30_000
const OPENAI_PROXY_MONITOR_MS = 1_000
const OPENAI_PROXY_START_TIMEOUT_MS = 10_000
const MAX_RUNTIME_FILE_BYTES = 64 * 1024

export interface OpenAIProxyRuntimeState {
  version: 1
  instanceId: string
  pid: number
  endpoint: string
  hostVersion: string
  mode: 'daemon' | 'foreground'
  startedAt: string
}

export interface OpenAIProxyLastExit {
  version: 1
  at: string
  hostVersion: string
  reason:
    | 'control_stop'
    | 'idle_exit'
    | 'signal'
    | 'startup_failed'
    | 'recovered_stale_runtime'
}

interface ClientLeaseRecord {
  version: 1
  ownerId: string
  pid: number
  hostVersion: string
  updatedAt: string
}

export interface OpenAIProxyClientLease {
  readonly ownerId: string
  release(): Promise<void>
}

export interface RuntimePaths {
  root: string
  clients: string
  state: string
  lastExit: string
}

export interface LifecycleOptions {
  stateDirectory?: string
  port?: number
  token?: string
  securePath?: SecurePath
  heartbeatMs?: number
  leaseTtlMs?: number
  idleExitMs?: number
  monitorMs?: number
  startTimeoutMs?: number
  spawnDaemon?: () => Promise<void> | void
}

function pathsFor(stateDirectory?: string): RuntimePaths {
  const root =
    stateDirectory ?? join(homedir(), '.claude', 'openai-proxy', 'runtime')
  return {
    root,
    clients: join(root, 'clients'),
    state: join(root, 'runtime.json'),
    lastExit: join(root, 'last-exit.json'),
  }
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(
        `Refusing symbolic link in openai-proxy runtime path: ${path}`,
      )
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function prepareRuntimePaths(
  paths: RuntimePaths,
  securePath: SecurePath,
): Promise<void> {
  await rejectSymlink(dirname(paths.root))
  await rejectSymlink(paths.root)
  await mkdir(paths.root, { recursive: true, mode: 0o700 })
  await securePath(paths.root, 'directory')
  await rejectSymlink(paths.clients)
  await mkdir(paths.clients, { recursive: true, mode: 0o700 })
  await securePath(paths.clients, 'directory')
}

async function writeAtomic(
  path: string,
  value: unknown,
  securePath: SecurePath,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}-${process.pid}-${randomUUID()}.tmp`,
  )
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await securePath(temporary, 'file')
    await rename(temporary, path)
    await securePath(path, 'file')
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readBoundedJson(path: string): Promise<unknown> {
  await rejectSymlink(path)
  const text = await readFile(path, 'utf8')
  if (Buffer.byteLength(text, 'utf8') > MAX_RUNTIME_FILE_BYTES) {
    throw new Error(`openai-proxy runtime file exceeded 64 KiB: ${path}`)
  }
  return JSON.parse(text)
}

function validRuntimeState(value: unknown): value is OpenAIProxyRuntimeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (
    state.version !== 1 ||
    typeof state.instanceId !== 'string' ||
    !Number.isSafeInteger(state.pid) ||
    Number(state.pid) <= 0 ||
    typeof state.endpoint !== 'string' ||
    typeof state.hostVersion !== 'string' ||
    (state.mode !== 'daemon' && state.mode !== 'foreground') ||
    typeof state.startedAt !== 'string'
  ) {
    return false
  }
  try {
    const endpoint = new URL(state.endpoint)
    return endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function validClientLease(value: unknown): value is ClientLeaseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const lease = value as Record<string, unknown>
  return (
    lease.version === 1 &&
    typeof lease.ownerId === 'string' &&
    Number.isSafeInteger(lease.pid) &&
    Number(lease.pid) > 0 &&
    typeof lease.hostVersion === 'string' &&
    typeof lease.updatedAt === 'string' &&
    Number.isFinite(Date.parse(lease.updatedAt))
  )
}

export async function readOpenAIProxyRuntimeState(
  options: Pick<LifecycleOptions, 'stateDirectory'> = {},
): Promise<OpenAIProxyRuntimeState | undefined> {
  const paths = pathsFor(options.stateDirectory)
  try {
    const value = await readBoundedJson(paths.state)
    return validRuntimeState(value) ? value : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return undefined
  }
}

export async function readOpenAIProxyLastExit(
  options: Pick<LifecycleOptions, 'stateDirectory'> = {},
): Promise<OpenAIProxyLastExit | undefined> {
  const paths = pathsFor(options.stateDirectory)
  try {
    const value = await readBoundedJson(paths.lastExit)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined
    const record = value as Record<string, unknown>
    const reasons: OpenAIProxyLastExit['reason'][] = [
      'control_stop',
      'idle_exit',
      'signal',
      'startup_failed',
      'recovered_stale_runtime',
    ]
    return record.version === 1 &&
      typeof record.at === 'string' &&
      Number.isFinite(Date.parse(record.at)) &&
      typeof record.hostVersion === 'string' &&
      reasons.includes(record.reason as OpenAIProxyLastExit['reason'])
      ? (record as unknown as OpenAIProxyLastExit)
      : undefined
  } catch {
    return undefined
  }
}

export async function acquireOpenAIProxyClientLease(
  hostVersion: string,
  options: LifecycleOptions = {},
): Promise<OpenAIProxyClientLease> {
  const paths = pathsFor(options.stateDirectory)
  const securePath = options.securePath ?? secureSessionPath
  await prepareRuntimePaths(paths, securePath)
  const ownerId = randomUUID()
  const path = join(paths.clients, `${ownerId}.json`)
  let released = false
  let writing = false
  const heartbeat = async (): Promise<void> => {
    if (released || writing) return
    writing = true
    try {
      const record: ClientLeaseRecord = {
        version: 1,
        ownerId,
        pid: process.pid,
        hostVersion,
        updatedAt: new Date().toISOString(),
      }
      await writeAtomic(path, record, securePath)
    } finally {
      writing = false
    }
  }
  await heartbeat()
  const timer = setInterval(
    () => void heartbeat().catch(() => undefined),
    options.heartbeatMs ?? OPENAI_PROXY_CLIENT_HEARTBEAT_MS,
  )
  timer.unref()
  return {
    ownerId,
    async release(): Promise<void> {
      if (released) return
      released = true
      clearInterval(timer)
      try {
        const current = await readBoundedJson(path)
        if (validClientLease(current) && current.ownerId === ownerId) {
          await unlink(path)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Never delete a lease whose ownership cannot be proven.
        }
      }
    },
  }
}

async function activeClientLeaseCount(
  paths: RuntimePaths,
  leaseTtlMs: number,
): Promise<number> {
  const names = (await readdir(paths.clients)).filter(name =>
    name.endsWith('.json'),
  )
  if (names.length > 512) {
    throw new Error('openai-proxy client lease directory exceeded 512 entries.')
  }
  const cutoff = Date.now() - leaseTtlMs
  let active = 0
  for (const name of names) {
    const path = join(paths.clients, name)
    try {
      const value = await readBoundedJson(path)
      if (validClientLease(value) && Date.parse(value.updatedAt) >= cutoff) {
        active++
      } else {
        await rm(path, { force: true })
      }
    } catch {
      await rm(path, { force: true })
    }
  }
  return active
}

async function removeOwnedRuntimeState(
  paths: RuntimePaths,
  instanceId: string,
): Promise<void> {
  try {
    const current = await readBoundedJson(paths.state)
    if (validRuntimeState(current) && current.instanceId === instanceId) {
      await unlink(paths.state)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Never delete state whose ownership cannot be proven.
    }
  }
}

export async function runOpenAIProxyService(
  hostVersion: string,
  mode: 'daemon' | 'foreground',
  options: LifecycleOptions = {},
): Promise<OpenAIProxyLastExit['reason']> {
  const paths = pathsFor(options.stateDirectory)
  const securePath = options.securePath ?? secureSessionPath
  await prepareRuntimePaths(paths, securePath)
  const staleRuntime = await readOpenAIProxyRuntimeState(options)
  const singleton = acquireChannelConnectionLease({
    stateDir: paths.root,
    host: 'openai-proxy-host',
    alias: 'gateway',
    displayName: 'openai-proxy gateway',
  })
  const instanceId = randomUUID()
  const port = options.port ?? resolveOpenAIProxyPort()
  const token = options.token ?? resolveLocalToken()
  let exitReason: OpenAIProxyLastExit['reason'] = 'signal'
  let gateway: ReturnType<typeof startOpenAIProxyGateway> | undefined
  const controller = new AbortController()
  const stop = (reason: OpenAIProxyLastExit['reason']): void => {
    if (controller.signal.aborted) return
    exitReason = reason
    controller.abort()
  }
  const signalStop = () => stop('signal')
  process.once('SIGINT', signalStop)
  process.once('SIGTERM', signalStop)
  process.once('SIGHUP', signalStop)
  try {
    if (staleRuntime) {
      await writeAtomic(
        paths.lastExit,
        {
          version: 1,
          at: new Date().toISOString(),
          hostVersion,
          reason: 'recovered_stale_runtime',
        } satisfies OpenAIProxyLastExit,
        securePath,
      )
    }
    gateway = startOpenAIProxyGateway(hostVersion, {
      token,
      port,
      instanceId,
      onStop: () => stop('control_stop'),
    })
    const state: OpenAIProxyRuntimeState = {
      version: 1,
      instanceId,
      pid: process.pid,
      endpoint: gateway.url,
      hostVersion,
      mode,
      startedAt: new Date().toISOString(),
    }
    await writeAtomic(paths.state, state, securePath)
    let emptySince: number | undefined
    const monitor = setInterval(() => {
      if (mode !== 'daemon') return
      void activeClientLeaseCount(
        paths,
        options.leaseTtlMs ?? OPENAI_PROXY_CLIENT_LEASE_TTL_MS,
      )
        .then(count => {
          if (count > 0) {
            emptySince = undefined
            return
          }
          emptySince ??= Date.now()
          if (
            Date.now() - emptySince >=
            (options.idleExitMs ?? OPENAI_PROXY_IDLE_EXIT_MS)
          ) {
            stop('idle_exit')
          }
        })
        .catch(() => undefined)
    }, options.monitorMs ?? OPENAI_PROXY_MONITOR_MS)
    try {
      await new Promise<void>(resolve =>
        controller.signal.addEventListener('abort', () => resolve(), {
          once: true,
        }),
      )
    } finally {
      clearInterval(monitor)
    }
    return exitReason
  } catch (error) {
    exitReason = 'startup_failed'
    throw error
  } finally {
    process.off('SIGINT', signalStop)
    process.off('SIGTERM', signalStop)
    process.off('SIGHUP', signalStop)
    gateway?.stop()
    await removeOwnedRuntimeState(paths, instanceId)
    singleton.release()
    await writeAtomic(
      paths.lastExit,
      {
        version: 1,
        at: new Date().toISOString(),
        hostVersion,
        reason: exitReason,
      } satisfies OpenAIProxyLastExit,
      securePath,
    ).catch(() => undefined)
  }
}

async function inspectRunningGateway(
  state: OpenAIProxyRuntimeState,
  token: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${state.endpoint}/doctor`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) return false
    const body = (await response.json()) as Record<string, unknown>
    return (
      body.service === 'openai-proxy' &&
      body.version === state.hostVersion &&
      body.instanceId === state.instanceId
    )
  } catch {
    return false
  }
}

function daemonCommand(): string[] {
  const executableName = basename(process.execPath).toLowerCase()
  if (executableName === 'bun' || executableName === 'bun.exe') {
    const entrypoint = process.argv[1]
    if (!entrypoint)
      throw new Error('Unable to determine openai-proxy Host entrypoint.')
    return [process.execPath, entrypoint, 'daemon']
  }
  return [process.execPath, 'daemon']
}

async function spawnDetachedDaemon(): Promise<void> {
  const child = Bun.spawn(daemonCommand(), {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    env: process.env,
    detached: true,
    windowsHide: true,
  })
  child.unref()
}

export async function ensureOpenAIProxyDaemon(
  hostVersion: string,
  options: LifecycleOptions = {},
): Promise<OpenAIProxyRuntimeState> {
  const token = options.token ?? resolveLocalToken()
  const expectedEndpoint =
    options.port === 0
      ? undefined
      : getOpenAIProxyBaseUrl(options.port ?? resolveOpenAIProxyPort())
  const existing = await readOpenAIProxyRuntimeState(options)
  if (existing && (await inspectRunningGateway(existing, token))) {
    if (existing.hostVersion !== hostVersion) {
      throw new Error(
        `openai-proxy Host version ${existing.hostVersion} is already running; stop it before starting ${hostVersion}.`,
      )
    }
    if (expectedEndpoint && existing.endpoint !== expectedEndpoint) {
      throw new Error(
        `openai-proxy is running at ${existing.endpoint}, but user settings require ${expectedEndpoint}. Stop the existing gateway before changing ports.`,
      )
    }
    return existing
  }
  await (options.spawnDaemon ?? spawnDetachedDaemon)()
  const deadline =
    Date.now() + (options.startTimeoutMs ?? OPENAI_PROXY_START_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const state = await readOpenAIProxyRuntimeState(options)
    if (state && (await inspectRunningGateway(state, token))) {
      if (state.hostVersion !== hostVersion) {
        throw new Error(
          `openai-proxy Host version ${state.hostVersion} started instead of ${hostVersion}.`,
        )
      }
      return state
    }
    await Bun.sleep(100)
  }
  const lastExit = await readOpenAIProxyLastExit(options)
  throw new Error(
    `openai-proxy daemon did not become ready${lastExit ? `; last exit=${lastExit.reason}` : ''}.`,
  )
}

export async function stopOpenAIProxyDaemon(
  options: LifecycleOptions = {},
): Promise<boolean> {
  const state = await readOpenAIProxyRuntimeState(options)
  if (!state) return false
  const token = options.token ?? resolveLocalToken()
  const response = await fetch(`${state.endpoint}/control/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) {
    throw new Error(`openai-proxy stop failed (${response.status}).`)
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const current = await readOpenAIProxyRuntimeState(options)
    if (!current || current.instanceId !== state.instanceId) return true
    await Bun.sleep(50)
  }
  throw new Error('openai-proxy did not stop within 5 seconds.')
}
