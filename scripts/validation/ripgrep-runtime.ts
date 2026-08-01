#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ripGrep } from '../../src/utils/ripgrep.js'
import { assert } from './assertions.js'

const fixtureRoot = await mkdtemp(join(tmpdir(), 'claude-ripgrep-runtime-'))
const needle = 'ripgrep-runtime-probe-5f9d2ab7'

try {
  await writeFile(join(fixtureRoot, 'probe.txt'), needle, 'utf8')
  const matches = await ripGrep(
    ['--fixed-strings', needle],
    fixtureRoot,
    AbortSignal.timeout(10_000),
  )
  assert(
    matches.some(line => line.includes('probe.txt')),
    `ripgrep runtime did not return the fixture match: ${matches.join('\n')}`,
  )

  let usageError: unknown
  try {
    await ripGrep(
      ['--claude-code-invalid-ripgrep-option'],
      fixtureRoot,
      AbortSignal.timeout(10_000),
    )
  } catch (error) {
    usageError = error
  }
  assert(
    usageError instanceof Error &&
      usageError.message.includes('rejected its command arguments'),
    'ripgrep usage errors must be surfaced instead of becoming empty results',
  )
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

console.log('[ripgrep-runtime] PASS')
