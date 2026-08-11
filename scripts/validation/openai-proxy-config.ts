#!/usr/bin/env bun

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureOpenAIProxyUserConfig,
  getOpenAIProxyBaseUrl,
  OPENAI_PROXY_DEFAULT_PORT,
  resolveLocalToken,
  resolveOpenAIProxyPort,
} from '../../plugins/openai-proxy/src/config.js'
import { assert, assertEqual } from './assertions.js'

const root = await mkdtemp(join(tmpdir(), 'openai-proxy-config-'))
try {
  const cliSource = await readFile(
    join(
      import.meta.dir,
      '..',
      '..',
      'plugins',
      'openai-proxy',
      'src',
      'cli.ts',
    ),
    'utf8',
  )
  assert(
    !cliSource.includes('openai-proxy-host setup') &&
      !cliSource.includes("args[0] === 'setup'"),
    'setup command remains removed after being merged into login',
  )
  const settingsPath = join(root, '.claude', 'settings.json')
  const generated = 'a'.repeat(64)
  const env: NodeJS.ProcessEnv = {}
  const first = await ensureOpenAIProxyUserConfig({
    settingsPath,
    env,
    generateToken: () => generated,
  })
  assert(first.generatedToken, 'first login generates a local token')
  assertEqual(first.token, generated, 'generated token returned')
  assertEqual(first.port, OPENAI_PROXY_DEFAULT_PORT, 'default port returned')
  assertEqual(
    env.OPENAI_PROXY_LOCAL_TOKEN,
    generated,
    'generated token applied to the login process',
  )
  const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as {
    env: Record<string, string>
    openaiProxy: { port: number }
  }
  assertEqual(
    saved.env.OPENAI_PROXY_LOCAL_TOKEN,
    generated,
    'generated token persisted in user settings env',
  )
  assertEqual(
    saved.openaiProxy.port,
    48_481,
    'default configurable port persisted',
  )
  assertEqual(
    resolveLocalToken({}, () => saved.env.OPENAI_PROXY_LOCAL_TOKEN),
    generated,
    'direct Host commands fall back to user settings token',
  )
  assertEqual(
    resolveOpenAIProxyPort(() => ({ settings: saved })),
    48_481,
    'port resolves from user settings',
  )
  assertEqual(
    getOpenAIProxyBaseUrl(49_123),
    'http://127.0.0.1:49123',
    'configured port shapes the loopback base URL',
  )

  saved.env.EXISTING_VALUE = 'preserved'
  saved.openaiProxy.port = 49_123
  await writeFile(settingsPath, `${JSON.stringify(saved, null, 2)}\n`)
  let generatedAgain = false
  const second = await ensureOpenAIProxyUserConfig({
    settingsPath,
    env: {},
    generateToken: () => {
      generatedAgain = true
      return 'b'.repeat(64)
    },
  })
  assert(!generatedAgain, 'an existing token is never regenerated')
  assert(!second.generatedToken, 'existing token reported as loaded')
  assertEqual(second.port, 49_123, 'custom port retained')
  const preserved = JSON.parse(await readFile(settingsPath, 'utf8')) as {
    env: Record<string, string>
  }
  assertEqual(
    preserved.env.EXISTING_VALUE,
    'preserved',
    'unrelated settings content is preserved',
  )

  const invalidPath = join(root, '.invalid', 'settings.json')
  await ensureOpenAIProxyUserConfig({
    settingsPath: invalidPath,
    env: {},
    generateToken: () => 'c'.repeat(64),
  })
  const invalid = JSON.parse(await readFile(invalidPath, 'utf8')) as {
    openaiProxy: { port: number }
  }
  invalid.openaiProxy.port = 80
  await writeFile(invalidPath, `${JSON.stringify(invalid, null, 2)}\n`)
  let invalidPortRejected = false
  try {
    await ensureOpenAIProxyUserConfig({ settingsPath: invalidPath, env: {} })
  } catch (error) {
    invalidPortRejected = String(error).includes('1024')
  }
  assert(
    invalidPortRejected,
    'privileged or invalid configured ports are rejected',
  )

  let conflictRejected = false
  try {
    await ensureOpenAIProxyUserConfig({
      settingsPath,
      env: { OPENAI_PROXY_LOCAL_TOKEN: 'd'.repeat(64) },
    })
  } catch (error) {
    conflictRejected = String(error).includes('differs')
  }
  assert(conflictRejected, 'process and persisted token conflicts fail closed')
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('[openai-proxy-config] PASS')
