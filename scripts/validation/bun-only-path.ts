#!/usr/bin/env bun

import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import {
  assertBunOnlyPath,
  createBunOnlyPath,
  withBunOnlyPath,
} from '../lib/bunOnlyPath.js'
import { assert, assertDeepEqual } from './assertions.js'

const fixtureRoot = await mkdtemp(join(tmpdir(), 'bun-only-path-'))
const unsafeDirectory = join(fixtureRoot, 'unsafe')
const safeDirectory = join(fixtureRoot, 'safe')

try {
  await mkdir(unsafeDirectory)
  await mkdir(safeDirectory)
  const nodeFixture = join(
    unsafeDirectory,
    process.platform === 'win32' ? 'node.exe' : 'node',
  )
  await writeFile(nodeFixture, '')
  if (process.platform !== 'win32') await chmod(nodeFixture, 0o755)

  const isolated = createBunOnlyPath(
    [unsafeDirectory, safeDirectory].join(delimiter),
  )
  assertDeepEqual(
    isolated.removed,
    [unsafeDirectory],
    'directory containing a Node executable must be removed',
  )
  assert(
    isolated.path.split(delimiter).includes(dirname(process.execPath)),
    'Bun executable directory must remain available',
  )
  assert(
    isolated.path.split(delimiter).includes(safeDirectory),
    'unrelated system-tool directories must remain available',
  )

  const normalizedEnvironment = withBunOnlyPath(
    { Path: 'discard-me', HOME: 'preserve-me' },
    isolated.path,
  )
  assert(
    normalizedEnvironment.Path === undefined &&
      normalizedEnvironment.PATH === isolated.path &&
      normalizedEnvironment.HOME === 'preserve-me',
    'spawn environment must contain one authoritative PATH',
  )

  const current = createBunOnlyPath(process.env.PATH)
  assertBunOnlyPath(current.path)
  console.log(
    `[bun-only-path] PASS (${current.removed.length} runtime-bearing PATH entries removed)`,
  )
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}
