#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

export interface UpstreamSource {
  path: string
  sha256: string
  scope: string[]
  localTargets: string[]
}

export interface UpstreamBaseline {
  schemaVersion: number
  repository: string
  releaseTag: string
  tagObject: string
  commit: string
  auditedAt: string
  license: string
  sources: UpstreamSource[]
}

export type AuditFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface AuditResult {
  repository: string
  requestedTag: string
  resolvedCommit: string
  baselineTag: string
  baselineCommit: string
  files: Array<{
    path: string
    sha256: string
    baselineSha256: string
    status: 'unchanged' | 'changed'
    scope: string[]
    localTargets: string[]
  }>
  semanticReview: {
    required: boolean
    changedFiles: string[]
    allowedScopes: string[]
    excludedResponsibilities: string[]
  }
}

const projectRoot = resolve(import.meta.dir, '..')
export const baselinePath = join(
  projectRoot,
  'plugins',
  'openai-proxy',
  'upstream',
  'BASELINE.json',
)
const maxSourceBytes = 2 * 1024 * 1024
const tagPattern = /^rust-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const shaPattern = /^[0-9a-f]{40}$/
const hashPattern = /^[0-9a-f]{64}$/
const sourceWhitelist = new Set([
  'codex-rs/login/src/pkce.rs',
  'codex-rs/login/src/callback_params.rs',
  'codex-rs/login/src/device_code_auth.rs',
  'codex-rs/login/src/server.rs',
  'codex-rs/login/src/token_data.rs',
  'codex-rs/login/src/auth/auth_headers.rs',
  'codex-rs/login/src/auth/manager.rs',
  'codex-rs/login/src/auth/revoke.rs',
  'codex-rs/login/src/auth/storage.rs',
  'codex-rs/login/src/outbound_proxy.rs',
  'codex-rs/codex-api/src/auth.rs',
  'codex-rs/codex-api/src/endpoint/models.rs',
  'codex-rs/codex-api/src/endpoint/responses.rs',
  'codex-rs/codex-api/src/requests/responses.rs',
  'codex-rs/codex-api/src/rate_limits.rs',
  'codex-rs/codex-api/src/sse/mod.rs',
  'codex-rs/codex-api/src/sse/responses.rs',
  'codex-rs/backend-client/src/client/rate_limit_resets.rs',
  'codex-rs/http-client/src/client_builder.rs',
])
const excludedResponsibilities = [
  'agent-loop',
  'prompt',
  'tool',
  'shell-or-file',
  'sandbox',
  'approval',
  'thread',
  'mcp',
  'plugin-or-skill',
  'cloud-or-remote',
  'telemetry',
  'update',
  'ui',
  'multi-agent',
  'memory',
  'web-image-or-voice',
  'background-task',
]

function assertSafeSourcePath(path: string): void {
  if (
    !path.startsWith('codex-rs/') ||
    !path.endsWith('.rs') ||
    path.includes('\\') ||
    path.split('/').includes('..') ||
    path.startsWith('/')
  ) {
    throw new Error(`Unsafe or non-whitelisted upstream path: ${path}`)
  }
}

export async function loadBaseline(
  path = baselinePath,
): Promise<UpstreamBaseline> {
  const value = JSON.parse(await readFile(path, 'utf8')) as UpstreamBaseline
  if (
    value.schemaVersion !== 1 ||
    value.repository !== 'https://github.com/openai/codex' ||
    !tagPattern.test(value.releaseTag) ||
    !shaPattern.test(value.tagObject) ||
    !shaPattern.test(value.commit) ||
    value.license !== 'Apache-2.0' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.auditedAt) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0
  ) {
    throw new Error('Invalid openai-proxy upstream baseline')
  }
  const paths = new Set<string>()
  for (const source of value.sources) {
    assertSafeSourcePath(source.path)
    if (
      !sourceWhitelist.has(source.path) ||
      paths.has(source.path) ||
      !hashPattern.test(source.sha256) ||
      source.scope.length === 0 ||
      source.localTargets.length === 0
    ) {
      throw new Error(`Invalid upstream source entry: ${source.path}`)
    }
    paths.add(source.path)
  }
  if (paths.size !== sourceWhitelist.size) {
    throw new Error('Upstream baseline must contain the exact source whitelist')
  }
  return value
}

async function fetchJson(
  url: string,
  fetchImpl: AuditFetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
  })
  if (!response.ok) {
    throw new Error(`Upstream metadata request failed (${response.status})`)
  }
  return (await response.json()) as Record<string, unknown>
}

export async function resolveReleaseCommit(
  tag: string,
  fetchImpl: AuditFetch = fetch,
): Promise<string> {
  if (!tagPattern.test(tag)) {
    throw new Error(
      'Tag must use the official rust-v<major>.<minor>.<patch> form',
    )
  }
  const ref = await fetchJson(
    `https://api.github.com/repos/openai/codex/git/ref/tags/${encodeURIComponent(tag)}`,
    fetchImpl,
  )
  let object = ref.object as Record<string, unknown> | undefined
  for (let depth = 0; depth < 4; depth += 1) {
    const sha = object?.sha
    const type = object?.type
    if (typeof sha !== 'string' || !shaPattern.test(sha)) {
      throw new Error('Official tag returned an invalid object SHA')
    }
    if (type === 'commit') return sha
    if (type !== 'tag')
      throw new Error(`Unsupported official tag object: ${type}`)
    const tagObject = await fetchJson(
      `https://api.github.com/repos/openai/codex/git/tags/${sha}`,
      fetchImpl,
    )
    object = tagObject.object as Record<string, unknown> | undefined
  }
  throw new Error('Official tag indirection exceeded the audit limit')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function auditUpstream(options: {
  tag: string
  fetchImpl?: AuditFetch
  baseline?: UpstreamBaseline
  tempRoot?: string
}): Promise<AuditResult> {
  const baseline = options.baseline ?? (await loadBaseline())
  const fetchImpl = options.fetchImpl ?? fetch
  const commit = await resolveReleaseCommit(options.tag, fetchImpl)
  const temporaryDirectory = await mkdtemp(
    join(options.tempRoot ?? tmpdir(), 'openai-proxy-upstream-'),
  )
  try {
    const files: AuditResult['files'] = []
    for (const source of baseline.sources) {
      assertSafeSourcePath(source.path)
      const url = `https://raw.githubusercontent.com/openai/codex/${commit}/${source.path}`
      const response = await fetchImpl(url, { redirect: 'error' })
      if (!response.ok) {
        throw new Error(
          `Whitelisted source request failed for ${source.path} (${response.status})`,
        )
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maxSourceBytes) {
        throw new Error(`Whitelisted source is too large: ${source.path}`)
      }
      const target = resolve(temporaryDirectory, source.path)
      if (!target.startsWith(`${resolve(temporaryDirectory)}${sep}`)) {
        throw new Error(`Temporary download escaped its root: ${source.path}`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)
      const digest = sha256(bytes)
      files.push({
        path: source.path,
        sha256: digest,
        baselineSha256: source.sha256,
        status: digest === source.sha256 ? 'unchanged' : 'changed',
        scope: source.scope,
        localTargets: source.localTargets,
      })
    }
    const changedFiles = files
      .filter(file => file.status === 'changed')
      .map(file => file.path)
    return {
      repository: baseline.repository,
      requestedTag: options.tag,
      resolvedCommit: commit,
      baselineTag: baseline.releaseTag,
      baselineCommit: baseline.commit,
      files,
      semanticReview: {
        required: changedFiles.length > 0 || commit !== baseline.commit,
        changedFiles,
        allowedScopes: [...new Set(files.flatMap(file => file.scope))].sort(),
        excludedResponsibilities,
      },
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export function parseTag(args: string[]): string {
  const index = args.indexOf('--tag')
  const tag = index >= 0 ? args[index + 1] : undefined
  if (!tag || args.filter(value => value === '--tag').length !== 1) {
    throw new Error(
      'Usage: bun run audit:openai-proxy-upstream -- --tag <version>',
    )
  }
  return tag
}

if (import.meta.main) {
  try {
    const result = await auditUpstream({ tag: parseTag(process.argv.slice(2)) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[openai-proxy-upstream-audit] ${message}\n`)
    process.exitCode = 1
  }
}
