#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listXApps,
  removeXApp,
  resolveXApp,
  resolveXBearerToken,
  saveXApp,
} from '../../plugins/x/src/config.js'
import {
  createXTransport,
  redactXSecret,
  validateXProxyUrl,
} from '../../plugins/x/src/transport.js'
import { assert, assertEqual } from './assertions.js'

const state = mkdtempSync(join(tmpdir(), 'x-core-'))
process.env.X_STATE_DIR = state
try {
  const primary = saveXApp('primary')
  const research = saveXApp('research')
  assertEqual(listXApps().length, 2, 'multi-App index')
  assertEqual(resolveXApp('primary')?.alias, 'primary', 'alias resolution')
  let ambiguous = false
  try {
    resolveXApp()
  } catch {
    ambiguous = true
  }
  assert(ambiguous, 'multi-App resolution requires alias')
  process.env.X_BEARER_TOKEN = JSON.stringify({
    primary: 'primary-secret',
    research: 'research-secret',
  })
  assertEqual(resolveXBearerToken(primary), 'primary-secret', 'primary token')
  assertEqual(
    resolveXBearerToken(research),
    'research-secret',
    'research token isolation',
  )
  assertEqual(createXTransport().proxyMode, 'direct', 'direct transport')
  assertEqual(
    createXTransport('http://user:pass@127.0.0.1:8080').proxyMode,
    'http-connect',
    'HTTP CONNECT transport',
  )
  let socksRejected = false
  try {
    validateXProxyUrl('socks5h://localhost:1080')
  } catch (error) {
    socksRejected = String(error).includes('not supported')
  }
  assert(socksRejected, 'SOCKS5 fails closed on Bun standalone')
  assert(
    !redactXSecret('https://user:pass@proxy.local Bearer abc').includes('pass'),
    'proxy credentials redacted',
  )
  removeXApp('research')
  process.env.X_BEARER_TOKEN = 'single-secret'
  assertEqual(resolveXBearerToken(primary), 'single-secret', 'single-App token')
} finally {
  delete process.env.X_STATE_DIR
  delete process.env.X_BEARER_TOKEN
  rmSync(state, { recursive: true, force: true })
}
console.log('[x-core] PASS')
