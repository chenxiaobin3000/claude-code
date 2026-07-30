#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  getMcpStartupBackoffMs,
  isTransientMcpStartupError,
  MCP_STARTUP_MAX_ATTEMPTS,
} from '../../src/services/mcp/retryPolicy.js'
import {
  describeMcpArguments,
  getMcpHttpStatus,
  redactMcpEnvironment,
  redactMcpError,
  redactMcpHeaders,
  redactMcpUrl,
} from '../../src/services/mcp/security.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')

assertEqual(MCP_STARTUP_MAX_ATTEMPTS, 3, 'startup connection attempt count')
assertEqual(getMcpStartupBackoffMs(1), 1000, 'first startup backoff')
assertEqual(getMcpStartupBackoffMs(2), 2000, 'second startup backoff')
for (const error of [
  'HTTP 503 Service Unavailable',
  'fetch failed: ECONNREFUSED',
  'connection timed out',
]) {
  assert(isTransientMcpStartupError(error), `transient startup error: ${error}`)
}
for (const error of [
  'HTTP 401 Unauthorized',
  'HTTP 404 Not Found',
  'spawn ENOENT',
  'invalid configuration',
]) {
  assert(
    !isTransientMcpStartupError(error),
    `permanent startup error is not retried: ${error}`,
  )
}

const secretUrl =
  'https://user:password@example.test/mcp?token=abc&workspace=private#secret'
const safeUrl = redactMcpUrl(secretUrl)
assert(!safeUrl.includes('password'), 'URL password is redacted')
assert(!safeUrl.includes('abc'), 'URL token is redacted')
assert(!safeUrl.includes('private'), 'all URL query values are redacted')
assert(!safeUrl.includes('#secret'), 'URL fragment is removed')
assertEqual(getMcpHttpStatus('request failed with HTTP 502'), 502, 'HTTP status')
assert(
  !redactMcpError(
    'Authorization: Bearer abc https://example.test/mcp?api_key=value',
  ).includes('abc'),
  'bearer token is redacted from errors',
)
assertEqual(
  redactMcpHeaders({ Authorization: 'Bearer abc' })?.Authorization,
  '[REDACTED]',
  'header value redaction',
)
assertEqual(
  redactMcpEnvironment({ API_KEY: 'abc' })?.API_KEY,
  '[REDACTED]',
  'environment value redaction',
)
assert(
  !describeMcpArguments(['--token', 'abc']).includes('abc'),
  'stdio argument values are hidden',
)

const clientSource = await readFile(
  resolve(root, 'src/services/mcp/client.ts'),
  'utf8',
)
for (const marker of [
  'connectToServerWithStartupRetry',
  'sendRootsListChanged',
  'CLAUDE_CODE_SESSION_ID: getSessionId()',
  'registerMonitorMcpTask',
  'flushTaskOutput',
  'MCP_TOOL_BACKGROUND_THRESHOLD_MS',
]) {
  assert(clientSource.includes(marker), `MCP lifecycle step missing: ${marker}`)
}

const configSource = await readFile(
  resolve(root, 'src/services/mcp/config.ts'),
  'utf8',
)
assert(
  !configSource.includes('first100=${jsonStringify(configContent.slice'),
  'invalid config logs must not include file contents',
)
assert(
  configSource.includes('approval required for this project .mcp.json server'),
  'pending project MCP approval is visible',
)

const approvalSource = await readFile(
  resolve(root, 'src/services/mcp/utils.ts'),
  'utf8',
)
assert(
  !approvalSource.includes('getIsNonInteractiveSession() &&'),
  'headless mode cannot auto-approve project MCP servers',
)

console.log('[mcp-lifecycle] PASS')

