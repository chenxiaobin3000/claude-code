#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildStandaloneWithRetry } from '../standalone-build.js'
import { assertDeepEqual } from './assertions.js'
import type { WorkflowFixtureSummary } from './fixtures/workflow-engine-runtime.js'

const root = resolve(import.meta.dir, '../..')
const workflowPackage = join(root, 'packages', 'workflow-engine')
const fixtureEntrypoint = join(
  root,
  'scripts',
  'validation',
  'fixtures',
  'workflow-engine-runtime.ts',
)
const standaloneEntrypoint = join(
  root,
  'scripts',
  'validation',
  'fixtures',
  'workflow-engine-standalone.ts',
)
const temporaryRoot = await mkdtemp(join(tmpdir(), 'claude-workflow-fixture-'))

async function runProcess(
  command: string[],
  cwd = root,
): Promise<string> {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(
      `command failed (${exitCode}): ${command.join(' ')}\n${stdout}\n${stderr}`,
    )
  }
  return stdout.trim()
}

async function runFixture(
  executable: string,
  mode: 'source' | 'dist',
  name: string,
): Promise<WorkflowFixtureSummary> {
  const runsDir = join(temporaryRoot, name)
  await mkdir(runsDir, { recursive: true })
  const args = executable === process.execPath
    ? [executable, fixtureEntrypoint, mode, runsDir]
    : [executable, mode, runsDir]
  const output = await runProcess(args)
  const json = output.split(/\r?\n/).at(-1)
  if (!json) throw new Error(`${name} workflow fixture returned no output`)
  return JSON.parse(json) as WorkflowFixtureSummary
}

try {
  await runProcess([process.execPath, 'run', 'build'], workflowPackage)

  const source = await runFixture(process.execPath, 'source', 'source')
  const emitted = await runFixture(process.execPath, 'dist', 'dist')

  const standalonePath = join(
    temporaryRoot,
    process.platform === 'win32'
      ? 'workflow-fixture.exe'
      : 'workflow-fixture',
  )
  await buildStandaloneWithRetry({
    label: 'workflow fixture',
    outfile: standalonePath,
    build: () =>
      Bun.build({
        entrypoints: [standaloneEntrypoint],
        target: 'bun',
        compile: { outfile: standalonePath },
      }),
  })
  const standalone = await runFixture(
    standalonePath,
    'source',
    'standalone',
  )

  const expected: WorkflowFixtureSummary = {
    result: {
      status: 'completed',
      returnValue: {
        first: 'fixture:alpha!',
        second: ['fixture:beta!', 'local'],
      },
    },
    resumedResult: {
      status: 'completed',
      returnValue: {
        first: 'fixture:alpha!',
        second: ['fixture:beta!', 'local'],
      },
    },
    adapterCalls: 2,
    lifecycle: { initialized: 1, disposed: 1 },
    journalSeq: [0, 1],
    journalKeyLengths: [64, 64],
    firstEventTypes: [
      'run_started',
      'phase_started',
      'log',
      'agent_started',
      'agent_progress',
      'agent_done',
      'agent_started',
      'agent_progress',
      'agent_done',
      'phase_done',
      'run_done',
    ],
    resumedEventTypes: [
      'run_started',
      'phase_started',
      'log',
      'agent_done',
      'agent_done',
      'phase_done',
      'run_done',
    ],
  }

  assertDeepEqual(source, expected, 'workflow source fixture')
  assertDeepEqual(emitted, expected, 'workflow emitted package fixture')
  assertDeepEqual(standalone, expected, 'workflow standalone fixture')
  assertDeepEqual(emitted, source, 'workflow source/emitted parity')
  assertDeepEqual(standalone, source, 'workflow source/standalone parity')

  console.log('[workflow-engine-runtime] PASS (source, dist, standalone)')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
