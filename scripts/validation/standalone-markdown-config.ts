#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assert } from './assertions.js'

const exe = resolve(
  process.argv[2] ??
    join(
      import.meta.dir,
      '..',
      '..',
      'dist',
      process.platform === 'win32' ? 'claude.exe' : 'claude',
    ),
)

await access(exe)

const fixtureRoot = await mkdtemp(
  join(tmpdir(), 'claude-standalone-markdown-'),
)
const projectRoot = join(fixtureRoot, 'project')
const nestedCwd = join(projectRoot, 'nested', 'cwd')
const configRoot = join(fixtureRoot, 'user-config')
const agentDir = join(projectRoot, '.claude', 'agents')
const agentName = 'standalone-markdown-probe'
const searchNeedle = 'standalone-ripgrep-probe-8d8c6d30'

try {
  await Promise.all([
    mkdir(join(projectRoot, '.git'), { recursive: true }),
    mkdir(nestedCwd, { recursive: true }),
    mkdir(configRoot, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
  ])
  await writeFile(
    join(agentDir, `${agentName}.md`),
    [
      '---',
      `name: ${agentName}`,
      'description: Standalone Markdown configuration discovery probe.',
      'tools: Read',
      'model: inherit',
      '---',
      '',
      'Report that standalone Markdown configuration discovery works.',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(join(projectRoot, 'search-probe.txt'), searchNeedle, 'utf8')

  const {
    CLAUDE_CODE_USE_NATIVE_FILE_SEARCH: _ignoredNativeOverride,
    USE_BUILTIN_RIPGREP: _ignoredRipgrepOverride,
    ...cleanEnv
  } = process.env
  const result = spawnSync(exe, ['agents'], {
    cwd: nestedCwd,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...cleanEnv,
      CLAUDE_CONFIG_DIR: configRoot,
      CCB_VALIDATE_EMBEDDED_RIPGREP: '1',
      NO_COLOR: '1',
    },
  })

  assert(
    result.status === 0,
    `standalone agents command failed (${result.status}): ${result.stderr || result.stdout}`,
  )
  assert(
    result.stdout.includes(agentName),
    `standalone did not discover the project Agent from a nested cwd:\n${result.stdout}`,
  )
  assert(
    result.stdout.includes('Project agents:'),
    `standalone did not classify the discovered Agent as project configuration:\n${result.stdout}`,
  )

  const ripgrepCacheRoot = join(configRoot, 'cache', 'ripgrep')
  const cacheEntries = await readdir(ripgrepCacheRoot, {
    withFileTypes: true,
  })
  const versionDirectories = cacheEntries.filter(entry => entry.isDirectory())
  assert(
    versionDirectories.length === 1,
    `standalone must extract exactly one content-addressed ripgrep version, got ${versionDirectories.length}`,
  )
  const extractedRipgrep = join(
    ripgrepCacheRoot,
    versionDirectories[0]!.name,
    process.platform === 'win32' ? 'rg.exe' : 'rg',
  )
  const extractedStats = await lstat(extractedRipgrep)
  assert(
    extractedStats.isFile() && !extractedStats.isSymbolicLink(),
    'standalone ripgrep cache entry must be a regular file',
  )

  const version = spawnSync(extractedRipgrep, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  assert(
    version.status === 0 && version.stdout.startsWith('ripgrep '),
    `extracted executable is not ripgrep: ${version.stderr || version.stdout}`,
  )

  const search = spawnSync(
    extractedRipgrep,
    ['--no-config', '--fixed-strings', searchNeedle, projectRoot],
    { encoding: 'utf8', windowsHide: true },
  )
  assert(
    search.status === 0 && search.stdout.includes('search-probe.txt'),
    `extracted ripgrep failed a real search: ${search.stderr || search.stdout}`,
  )

  await writeFile(extractedRipgrep, 'tampered cache entry', 'utf8')
  const tamperedCacheRun = spawnSync(exe, ['agents'], {
    cwd: nestedCwd,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...cleanEnv,
      CLAUDE_CONFIG_DIR: configRoot,
      CCB_VALIDATE_EMBEDDED_RIPGREP: '1',
      NO_COLOR: '1',
    },
  })
  assert(
    tamperedCacheRun.status !== 0 &&
      tamperedCacheRun.stderr.includes('failed SHA-256 verification'),
    'standalone must reject a tampered extracted ripgrep cache entry',
  )
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

console.log('[standalone-markdown-config] PASS')
