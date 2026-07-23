#!/usr/bin/env bun

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, getSessionId } from '../../src/bootstrap/state.js'
import { call } from '../../src/commands/cd/cd.js'
import { getCwd } from '../../src/utils/cwd.js'
import { getSessionMemoryDir } from '../../src/utils/permissions/filesystem.js'
import { setCwd } from '../../src/utils/Shell.js'
import { getTranscriptPath } from '../../src/utils/sessionStorage.js'
import { assert, assertEqual } from './assertions.js'

const startupProject = getOriginalCwd()
const startupCwd = getCwd()
const sessionId = getSessionId()
const transcriptPath = getTranscriptPath()
const sessionMemoryDir = getSessionMemoryDir()
const tempRoot = await mkdtemp(join(tmpdir(), 'claude-code-cd-'))
const first = join(tempRoot, 'first directory')
const second = join(tempRoot, 'second')
const file = join(tempRoot, 'not-a-directory.txt')

await mkdir(first, { recursive: true })
await mkdir(second, { recursive: true })
await writeFile(file, 'fixture', 'utf8')

try {
  const result = await call(`"${first}"`, {} as never)
  assertEqual(result.type, 'text', 'quoted directory result')
  assertEqual(getCwd(), first, 'quoted directory becomes temporary cwd')
  assertEqual(getOriginalCwd(), startupProject, 'startup project remains fixed')
  assertEqual(getSessionId(), sessionId, 'session ID remains fixed')
  assertEqual(
    getTranscriptPath(),
    transcriptPath,
    'transcript remains in startup project',
  )
  assertEqual(
    getSessionMemoryDir(),
    sessionMemoryDir,
    'session memory remains in startup project',
  )

  await call('../second', {} as never)
  assertEqual(getCwd(), second, 'relative path resolves from temporary cwd')
  assertEqual(
    getOriginalCwd(),
    startupProject,
    'relative cd does not replace startup project',
  )

  const current = await call('', {} as never)
  assert(
    current.type === 'text' && current.value.includes(second),
    'empty /cd reports cwd without changing it',
  )

  let rejectedFile = false
  try {
    await call(file, {} as never)
  } catch (error) {
    rejectedFile =
      error instanceof Error && error.message.includes('is not a directory')
  }
  assert(rejectedFile, '/cd rejects file targets')
  assertEqual(getCwd(), second, 'failed /cd keeps previous cwd')

  const commandSource = await Bun.file(
    join(import.meta.dir, '../../src/commands/cd/cd.ts'),
  ).text()
  for (const forbidden of [
    'setOriginalCwd',
    'switchSession',
    'regenerateSessionId',
    'sessionStorage',
    'claudemd',
    'getMemoryFiles',
    'checkHasTrustDialogAccepted',
    'processSessionStartHooks',
    'onCwdChangedForHooks',
  ]) {
    assert(
      !commandSource.includes(forbidden),
      `/cd must not acquire project-switch responsibility: ${forbidden}`,
    )
  }

  const clearSource = await Bun.file(
    join(import.meta.dir, '../../src/commands/clear/conversation.ts'),
  ).text()
  assert(
    clearSource.includes('setCwd(getOriginalCwd())'),
    '/clear restores the startup project cwd',
  )

  const registrySource = await Bun.file(
    join(import.meta.dir, '../../src/commands.ts'),
  ).text()
  assert(
    registrySource.includes("import cd from './commands/cd/index.js'") &&
      /\r?\n {2}cd,\r?\n/.test(registrySource),
    '/cd is registered as a built-in command',
  )

  const fixedProjectSources = [
    '../../src/utils/permissions/filesystem.ts',
    '../../src/utils/plans.ts',
    '../../src/services/mcp/config.ts',
    '../../src/services/mcp/utils.ts',
    '../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts',
    '../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts',
    '../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts',
  ]
  for (const relativePath of fixedProjectSources) {
    const source = await Bun.file(join(import.meta.dir, relativePath)).text()
    assert(
      source.includes('getOriginalCwd'),
      `${relativePath} keeps project-scoped state on startup project`,
    )
  }

  const permissionSource = await Bun.file(
    join(import.meta.dir, '../../src/utils/permissions/filesystem.ts'),
  ).text()
  assert(
    !permissionSource.includes('getProjectDir(getCwd())'),
    'session memory and project-history permissions ignore temporary cwd',
  )

  const plansSource = await Bun.file(
    join(import.meta.dir, '../../src/utils/plans.ts'),
  ).text()
  assert(
    !plansSource.includes("from './cwd.js'"),
    'relative plans directory ignores temporary cwd',
  )

  for (const relativePath of [
    '../../src/services/mcp/config.ts',
    '../../src/services/mcp/utils.ts',
  ]) {
    const source = await Bun.file(join(import.meta.dir, relativePath)).text()
    assert(
      !source.includes('getCwd'),
      `${relativePath} does not discover MCP configuration from temporary cwd`,
    )
  }
} finally {
  setCwd(startupCwd)
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('[temporary-cd] PASS')
