#!/usr/bin/env bun

import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  auditUpstream,
  loadBaseline,
  parseTag,
  resolveReleaseCommit,
  type AuditFetch,
} from '../audit-openai-proxy-upstream.js'
import { assert, assertEqual } from './assertions.js'

async function assertRejects(
  action: () => unknown | Promise<unknown>,
  expected: string,
  message: string,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    assert(detail.includes(expected), `${message}: ${detail}`)
    return
  }
  throw new Error(`${message}: expected rejection`)
}

const root = resolve(import.meta.dir, '..', '..')
const plugin = join(root, 'plugins', 'openai-proxy')
const upstream = join(plugin, 'upstream')
const allowedUpstreamFiles = new Set([
  'BASELINE.json',
  'SOURCE_MAP.md',
  'THIRD_PARTY_NOTICES.md',
])

const baseline = await loadBaseline(join(upstream, 'BASELINE.json'))
assertEqual(baseline.releaseTag, 'rust-v0.147.0', 'fixed release tag')
assertEqual(
  baseline.commit,
  'be6e8eac029b183056b7e4402879f15d2c85f61b',
  'fixed release commit',
)
assertEqual(baseline.license, 'Apache-2.0', 'upstream license')
assertEqual(
  new Set(baseline.sources.map(source => source.path)).size,
  baseline.sources.length,
  'unique whitelist paths',
)

const upstreamFiles = await readdir(upstream, { recursive: true })
assertEqual(upstreamFiles.length, 3, 'metadata-only upstream directory')
for (const file of upstreamFiles) {
  assert(
    allowedUpstreamFiles.has(file),
    `Unexpected upstream artifact: ${file}`,
  )
}
const notices = await readFile(join(upstream, 'THIRD_PARTY_NOTICES.md'), 'utf8')
assert(notices.includes('Apache License 2.0'), 'Apache attribution is required')
assert(
  notices.includes(baseline.commit),
  'Notice must identify the baseline commit',
)
const sourceMap = await readFile(join(upstream, 'SOURCE_MAP.md'), 'utf8')
for (const forbidden of [
  'Agent loops',
  'prompts',
  'tools',
  'sandboxing',
  'telemetry',
  'multi-agent',
]) {
  assert(sourceMap.includes(forbidden), `Missing forbidden scope: ${forbidden}`)
}

const pluginFiles = await readdir(plugin, { recursive: true })
for (const file of pluginFiles) {
  const normalized = file.replaceAll('\\', '/')
  assert(!normalized.endsWith('.rs'), `Rust source is forbidden: ${normalized}`)
  assert(
    !/(^|\/)(Cargo\.(toml|lock)|rust-toolchain(?:\.toml)?|rustfmt\.toml)$/.test(
      normalized,
    ),
    `Rust toolchain artifact is forbidden: ${normalized}`,
  )
  assert(
    !normalized.includes('/.cargo/'),
    `Cargo configuration is forbidden: ${normalized}`,
  )
}

const fixtureBodies = new Map(
  baseline.sources.map(source => [source.path, `fixture:${source.path}`]),
)
const requestedUrls: string[] = []
const fixtureCommit = 'a'.repeat(40)
const fetchFixture: AuditFetch = async input => {
  const url = String(input)
  requestedUrls.push(url)
  if (url.includes('/git/ref/tags/')) {
    return Response.json({ object: { type: 'tag', sha: 'b'.repeat(40) } })
  }
  if (url.includes('/git/tags/')) {
    return Response.json({ object: { type: 'commit', sha: fixtureCommit } })
  }
  const prefix = `https://raw.githubusercontent.com/openai/codex/${fixtureCommit}/`
  if (!url.startsWith(prefix)) return new Response('not found', { status: 404 })
  const path = url.slice(prefix.length)
  const body = fixtureBodies.get(path)
  return body === undefined
    ? new Response('not found', { status: 404 })
    : new Response(body)
}

const tempRoot = await mkdtemp(join(tmpdir(), 'openai-proxy-audit-test-'))
try {
  const result = await auditUpstream({
    tag: 'rust-v9.8.7',
    baseline,
    fetchImpl: fetchFixture,
    tempRoot,
  })
  assertEqual(result.resolvedCommit, fixtureCommit, 'annotated tag resolution')
  assertEqual(
    result.files.length,
    baseline.sources.length,
    'whitelist download count',
  )
  assert(
    result.semanticReview.required,
    'changed fixture requires semantic review',
  )
  assert(
    requestedUrls.filter(url => url.includes('raw.githubusercontent.com'))
      .length === baseline.sources.length,
    'Only whitelisted source files are downloaded',
  )
  for (const source of baseline.sources) {
    assert(
      requestedUrls.some(url => url.endsWith(`/${source.path}`)),
      `Missing whitelist request: ${source.path}`,
    )
  }
  assertEqual(
    (await readdir(tempRoot)).length,
    0,
    'temporary sources are removed',
  )
  const expandedBaseline = structuredClone(baseline)
  expandedBaseline.sources[0]!.path = 'codex-rs/core/src/agent_loop.rs'
  const expandedPath = join(tempRoot, 'expanded-baseline.json')
  await writeFile(expandedPath, JSON.stringify(expandedBaseline))
  await assertRejects(
    () => loadBaseline(expandedPath),
    'Invalid upstream source entry',
    'source whitelist expansion rejection',
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

await assertRejects(
  () => resolveReleaseCommit('../main', fetchFixture),
  'Tag must use the official',
  'tag traversal rejection',
)
await assertRejects(async () => parseTag([]), 'Usage:', 'missing tag rejection')
await access(join(root, 'scripts', 'audit-openai-proxy-upstream.ts'))
console.log('[openai-proxy-upstream-boundary] PASS')
