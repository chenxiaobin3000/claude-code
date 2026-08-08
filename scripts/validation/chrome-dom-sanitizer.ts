#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

type SanitizerApi = {
  normalizeText: (value: unknown, maximum?: number) => string | undefined
  sanitizeUrl: (value: unknown) => string | undefined
}

const root = resolve(import.meta.dir, '../..')
const sanitizerPath = join(
  root,
  'plugins',
  'chrome',
  'chrome-extension',
  'dom-snapshot.js',
)
const source = await readFile(sanitizerPath, 'utf8')
for (const forbidden of [
  'document.cookie',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'innerHTML',
  'outerHTML',
  'globalThis.eval',
  'new Function',
]) {
  if (source.includes(forbidden)) {
    throw new Error(
      `[chrome-dom-sanitizer] forbidden browser data or execution access: ${forbidden}`,
    )
  }
}
for (const required of [
  "'script'",
  "'style'",
  "type === 'password'",
  "type === 'hidden'",
  'DOM_SNAPSHOT_ALLOWED_DATA_ATTRIBUTES',
  'DOM_SNAPSHOT_ARIA_ATTRIBUTES',
  'DOM_SNAPSHOT_TOO_MANY_NODES',
  'DOM_SNAPSHOT_TOO_LARGE',
  'cross_origin_iframe_unavailable',
  'closed_shadow_root_unavailable',
  "treeScope: 'shadow-root'",
  "treeScope: 'iframe'",
  'scrollable_content_requires_explicit_paging',
  'visual_content_not_included',
  'compileDomSnapshotMatchSelectors',
  'args.metadataOnly',
]) {
  if (!source.includes(required)) {
    throw new Error(
      `[chrome-dom-sanitizer] required sanitizer boundary is missing: ${required}`,
    )
  }
}

await import(`${pathToFileURL(sanitizerPath).href}?validation=${process.pid}`)
const sanitizer = (
  globalThis as typeof globalThis & {
    __CLAUDE_CHROME_DOM_SNAPSHOT__?: SanitizerApi
  }
).__CLAUDE_CHROME_DOM_SNAPSHOT__
if (!sanitizer) {
  throw new Error('[chrome-dom-sanitizer] sanitizer API was not installed')
}

const normalized = sanitizer.normalizeText(
  '  account   Bearer abc.DEF-123_xyz  eyJabc.def.ghi  ',
)
if (
  normalized !== 'account Bearer <redacted> <redacted-jwt>' ||
  sanitizer.normalizeText('abcdef', 3) !== 'abc'
) {
  throw new Error('[chrome-dom-sanitizer] sensitive text redaction failed')
}
if (
  sanitizer.normalizeText('token=super-secret-value') !==
    'token=<redacted>' ||
  sanitizer.normalizeText('key sk_1234567890abcdefghijklmnop') !==
    'key <redacted-token>'
) {
  throw new Error('[chrome-dom-sanitizer] named token redaction failed')
}

const sanitizedUrl = sanitizer.sanitizeUrl(
  'https://user:password@example.test/orders?symbol=BTC&access_token=secret#private',
)
if (!sanitizedUrl) {
  throw new Error('[chrome-dom-sanitizer] safe HTTP URL was rejected')
}
const parsedUrl = new URL(sanitizedUrl)
if (
  parsedUrl.username !== '' ||
  parsedUrl.password !== '' ||
  parsedUrl.hash !== '' ||
  parsedUrl.searchParams.get('symbol') !== 'BTC' ||
  parsedUrl.searchParams.get('access_token') !== '<redacted>' ||
  sanitizer.sanitizeUrl('javascript:alert(1)') !== undefined
) {
  throw new Error('[chrome-dom-sanitizer] URL sanitization failed')
}

console.log('[chrome-dom-sanitizer] PASS')
