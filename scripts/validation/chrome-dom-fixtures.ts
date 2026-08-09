#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[chrome-dom-fixtures] ${message}`)
}

const fixtureRoot = join(import.meta.dir, 'fixtures', 'chrome-dom')
const index = await readFile(join(fixtureRoot, 'index.html'), 'utf8')
const sameOrigin = await readFile(
  join(fixtureRoot, 'same-origin-frame.html'),
  'utf8',
)
const crossOrigin = await readFile(
  join(fixtureRoot, 'cross-origin-frame.html'),
  'utf8',
)
const server = await readFile(
  join(import.meta.dir, 'chrome-dom-fixture-server.ts'),
  'utf8',
)

for (const marker of [
  'rowspan="2"',
  'colspan="2"',
  '61234.123456789012345678',
  '3456.000000000000000001',
  'id="headerless"',
  'id="accounts"',
  'id="virtual-list"',
  "attachShadow({ mode: 'open' })",
  "attachShadow({ mode: 'closed' })",
  'id="same-origin-frame"',
  '127.0.0.1:18081/cross-origin-frame.html',
  'type="password"',
  'type="hidden"',
  'access_token=secret-value',
  'id="visual-chart"',
  'id="visual-image"',
  "dataset.state = 'ready'",
]) {
  assert(index.includes(marker), `main fixture is missing ${marker}`)
}
assert(
  sameOrigin.includes('同源 Iframe 可见内容') &&
    crossOrigin.includes('跨源 Iframe 内容不得泄漏'),
  'iframe fixtures are incomplete',
)
assert(
  server.includes("port: 18_080") &&
    server.includes("port: 18_081") &&
    server.includes("length: 5_100") &&
    server.includes("length: 1_500"),
  'fixture server does not preserve origin or limit boundaries',
)

console.log('[chrome-dom-fixtures] PASS')
