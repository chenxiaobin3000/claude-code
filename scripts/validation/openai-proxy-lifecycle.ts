#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireOpenAIProxyClientLease,
  ensureOpenAIProxyDaemon,
  readOpenAIProxyLastExit,
  readOpenAIProxyRuntimeState,
  runOpenAIProxyService,
  stopOpenAIProxyDaemon,
  type LifecycleOptions,
  type OpenAIProxyRuntimeState,
} from '../../plugins/openai-proxy/src/lifecycle.js'
import { assert, assertEqual } from './assertions.js'

const token = 'fixture-local-token-with-sufficient-entropy'
const securePath = async (): Promise<void> => undefined

async function waitForState(
  stateDirectory: string,
  excludedInstanceId?: string,
): Promise<OpenAIProxyRuntimeState> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const state = await readOpenAIProxyRuntimeState({ stateDirectory })
    if (state && state.instanceId !== excludedInstanceId) return state
    await Bun.sleep(20)
  }
  throw new Error(
    'openai-proxy lifecycle fixture did not publish runtime state',
  )
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return await Promise.race([
    promise,
    Bun.sleep(5_000).then(() => {
      throw new Error(`${label} timed out`)
    }),
  ])
}

function fixtureOptions(stateDirectory: string): LifecycleOptions {
  return {
    stateDirectory,
    token,
    port: 0,
    securePath,
    heartbeatMs: 20,
    leaseTtlMs: 250,
    idleExitMs: 80,
    monitorMs: 10,
    startTimeoutMs: 2_000,
  }
}

async function authenticateDoctor(
  state: OpenAIProxyRuntimeState,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${state.endpoint}/doctor`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assertEqual(response.status, 200, 'lifecycle doctor status')
  return (await response.json()) as Record<string, unknown>
}

const root = await mkdtemp(join(tmpdir(), 'openai-proxy-lifecycle-'))
try {
  const sharedDirectory = join(root, 'shared')
  const sharedOptions = fixtureOptions(sharedDirectory)
  const first = await acquireOpenAIProxyClientLease('fixture-v1', sharedOptions)
  const second = await acquireOpenAIProxyClientLease(
    'fixture-v1',
    sharedOptions,
  )
  const sharedRun = runOpenAIProxyService('fixture-v1', 'daemon', sharedOptions)
  const sharedState = await waitForState(sharedDirectory)
  const doctor = await authenticateDoctor(sharedState)
  assertEqual(
    doctor.instanceId,
    sharedState.instanceId,
    'doctor instance identity',
  )
  await first.release()
  await Bun.sleep(160)
  assert(
    Boolean(
      await readOpenAIProxyRuntimeState({ stateDirectory: sharedDirectory }),
    ),
    'one active client lease keeps the singleton service alive',
  )
  await second.release()
  assertEqual(
    await bounded(sharedRun, 'idle exit'),
    'idle_exit',
    'idle exit reason',
  )
  assertEqual(
    await readOpenAIProxyRuntimeState({ stateDirectory: sharedDirectory }),
    undefined,
    'owned runtime state removed after idle exit',
  )

  const modelLeaseDirectory = join(root, 'model-lease')
  const modelLeaseOptions = fixtureOptions(modelLeaseDirectory)
  const modelLeaseRun = runOpenAIProxyService(
    'fixture-v1',
    'daemon',
    modelLeaseOptions,
  )
  const modelLeaseState = await waitForState(modelLeaseDirectory)
  const modelLeaseHeaders = {
    authorization: `Bearer ${token}`,
    'x-openai-proxy-client-id': 'fixture-selected-model',
  }
  for (let index = 0; index < 4; index++) {
    const retained = await fetch(
      `${modelLeaseState.endpoint}/control/client/retain`,
      { method: 'POST', headers: modelLeaseHeaders },
    )
    assertEqual(retained.status, 200, 'selected model lease heartbeat')
    await Bun.sleep(60)
  }
  assert(
    Boolean(
      await readOpenAIProxyRuntimeState({
        stateDirectory: modelLeaseDirectory,
      }),
    ),
    'selected model lease keeps the gateway alive without an MCP lease',
  )
  const released = await fetch(
    `${modelLeaseState.endpoint}/control/client/release`,
    { method: 'POST', headers: modelLeaseHeaders },
  )
  assertEqual(released.status, 200, 'selected model lease release')
  assertEqual(
    await bounded(modelLeaseRun, 'model lease idle exit'),
    'idle_exit',
    'gateway exits after the selected model lease is released',
  )

  const controlledDirectory = join(root, 'controlled')
  const controlledOptions = fixtureOptions(controlledDirectory)
  const controlledLease = await acquireOpenAIProxyClientLease(
    'fixture-v1',
    controlledOptions,
  )
  const controlledRun = runOpenAIProxyService(
    'fixture-v1',
    'daemon',
    controlledOptions,
  )
  const controlledState = await waitForState(controlledDirectory)
  const unauthorized = await fetch(`${controlledState.endpoint}/control/stop`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-token' },
  })
  assertEqual(unauthorized.status, 401, 'stop control requires local token')
  assert(
    Boolean(
      await readOpenAIProxyRuntimeState({
        stateDirectory: controlledDirectory,
      }),
    ),
    'unauthorized stop preserves service',
  )
  let spawnCount = 0
  const reused = await ensureOpenAIProxyDaemon('fixture-v1', {
    ...controlledOptions,
    spawnDaemon: () => {
      spawnCount++
    },
  })
  assertEqual(reused.instanceId, controlledState.instanceId, 'daemon is reused')
  assertEqual(spawnCount, 0, 'reuse does not spawn another daemon')
  let versionConflict = false
  try {
    await ensureOpenAIProxyDaemon('fixture-v2', controlledOptions)
  } catch (error) {
    versionConflict = String(error).includes('already running')
  }
  assert(versionConflict, 'an active incompatible Host version is rejected')
  assert(
    await stopOpenAIProxyDaemon(controlledOptions),
    'authenticated lifecycle stop succeeds',
  )
  assertEqual(
    await bounded(controlledRun, 'controlled exit'),
    'control_stop',
    'control stop reason',
  )
  await controlledLease.release()

  const automaticDirectory = join(root, 'automatic')
  const automaticOptions = fixtureOptions(automaticDirectory)
  const automaticLease = await acquireOpenAIProxyClientLease(
    'fixture-v1',
    automaticOptions,
  )
  let automaticRun:
    | Promise<
        | 'control_stop'
        | 'idle_exit'
        | 'signal'
        | 'startup_failed'
        | 'recovered_stale_runtime'
      >
    | undefined
  const automaticState = await ensureOpenAIProxyDaemon('fixture-v1', {
    ...automaticOptions,
    spawnDaemon: () => {
      automaticRun = runOpenAIProxyService(
        'fixture-v1',
        'daemon',
        automaticOptions,
      )
    },
  })
  assertEqual(
    (await authenticateDoctor(automaticState)).instanceId,
    automaticState.instanceId,
    'automatic daemon startup publishes a ready instance',
  )
  assert(
    await stopOpenAIProxyDaemon(automaticOptions),
    'automatically started daemon accepts lifecycle stop',
  )
  assert(automaticRun, 'automatic startup invoked the daemon launcher')
  assertEqual(
    await bounded(automaticRun, 'automatic controlled exit'),
    'control_stop',
    'automatically started daemon exits cleanly',
  )
  await automaticLease.release()

  const recoveredDirectory = join(root, 'recovered')
  await mkdir(join(recoveredDirectory, 'clients'), { recursive: true })
  await writeFile(
    join(recoveredDirectory, 'runtime.json'),
    `${JSON.stringify({
      version: 1,
      instanceId: 'crashed-instance',
      pid: 2_147_483_647,
      endpoint: 'http://127.0.0.1:9',
      hostVersion: 'fixture-old',
      mode: 'daemon',
      startedAt: new Date(0).toISOString(),
    })}\n`,
  )
  await writeFile(
    join(recoveredDirectory, 'connection.lock'),
    `${JSON.stringify({
      version: 2,
      pid: process.pid,
      processStartedAt: 0,
      host: 'crashed-openai-proxy-host',
      alias: 'gateway',
      ownerId: 'crashed-owner',
      acquiredAt: new Date(0).toISOString(),
    })}\n`,
  )
  const recoveredOptions = fixtureOptions(recoveredDirectory)
  const recoveredLease = await acquireOpenAIProxyClientLease(
    'fixture-v1',
    recoveredOptions,
  )
  const recoveredRun = runOpenAIProxyService(
    'fixture-v1',
    'daemon',
    recoveredOptions,
  )
  await waitForState(recoveredDirectory, 'crashed-instance')
  assertEqual(
    (await readOpenAIProxyLastExit({ stateDirectory: recoveredDirectory }))
      ?.reason,
    'recovered_stale_runtime',
    'crash residue is diagnosed during recovery',
  )
  await recoveredLease.release()
  assertEqual(
    await bounded(recoveredRun, 'recovered idle exit'),
    'idle_exit',
    'recovered service remains operational',
  )
  const lifecycleSource = await readFile(
    join(
      import.meta.dir,
      '..',
      '..',
      'plugins',
      'openai-proxy',
      'src',
      'lifecycle.ts',
    ),
    'utf8',
  )
  assert(
    !lifecycleSource.includes('process.kill('),
    'lifecycle recovery never kills a PID read from mutable state',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

process.stdout.write('openai-proxy lifecycle validation passed\n')
