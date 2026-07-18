import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')

const removedPaths = [
  'src/services/analytics/datadog.ts',
  'src/services/analytics/firstPartyEventLogger.ts',
  'src/services/analytics/firstPartyEventLoggingExporter.ts',
  'src/services/analytics/sink.ts',
  'src/services/analytics/sinkKillswitch.ts',
  'src/services/api/metricsOptOut.ts',
  'src/services/langfuse/client.ts',
  'src/services/langfuse/convert.ts',
  'src/services/langfuse/index.ts',
  'src/services/langfuse/sanitize.ts',
  'src/services/langfuse/tracing.ts',
  'src/utils/sentry.ts',
  'src/utils/telemetry/betaSessionTracing.ts',
  'src/utils/telemetry/bigqueryExporter.ts',
  'src/utils/telemetry/instrumentation.ts',
  'src/utils/telemetry/logger.ts',
  'src/utils/telemetry/perfettoTracing.ts',
]

for (const path of removedPaths) {
  if (await Bun.file(join(root, path)).exists()) {
    throw new Error(`[observability-boundary] removed path restored: ${path}`)
  }
}

const packageJson = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}
for (const name of Object.keys(dependencies)) {
  if (
    name === '@growthbook/growthbook' ||
    name.startsWith('@langfuse/') ||
    name.startsWith('@opentelemetry/') ||
    name.startsWith('@sentry/')
  ) {
    throw new Error(`[observability-boundary] forbidden dependency: ${name}`)
  }
}

async function sourceFiles(path: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(path)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const absolute = join(path, entry)
    const info = await stat(absolute)
    if (info.isDirectory()) result.push(...(await sourceFiles(absolute)))
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry)) result.push(absolute)
  }
  return result
}

const forbidden = [
  /from\s+['"]@growthbook\//,
  /from\s+['"]@langfuse\//,
  /from\s+['"]@opentelemetry\//,
  /from\s+['"]@sentry\//,
  /\b(?:LANGFUSE|SENTRY|OTEL|ANT_OTEL|BETA_TRACING|DATADOG)_[A-Z0-9_]+\b/,
  /CLAUDE_CODE_ENABLE_TELEMETRY/,
]
const runtimeFiles = [
  ...(await sourceFiles(join(root, 'src'))),
  ...(await sourceFiles(join(root, 'packages'))),
]
for (const file of runtimeFiles) {
  const text = await readFile(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      throw new Error(
        `[observability-boundary] ${relative(root, file)} contains ${pattern}`,
      )
    }
  }
}

for (const marker of [
  'initializeAnalyticsSink',
  'shutdownDatadog',
  'shutdown1PEventLogging',
]) {
  for (const file of runtimeFiles) {
    if ((await readFile(file, 'utf8')).includes(marker)) {
      throw new Error(
        `[observability-boundary] ${relative(root, file)} restores ${marker}`,
      )
    }
  }
}

const policy = await readFile(join(root, 'scripts/feature-policy.ts'), 'utf8')
if (!/export const RUNTIME_FEATURE_DEFAULTS/.test(policy)) {
  throw new Error('[observability-boundary] local runtime feature policy missing')
}
const growthbookFacade = await readFile(
  join(root, 'src/services/analytics/growthbook.ts'),
  'utf8',
)
for (const required of [
  /RUNTIME_FEATURE_DEFAULTS/,
  /CLAUDE_LOCAL_FEATURE_OVERRIDES/,
  /localFeatureOverrides/,
]) {
  if (!required.test(growthbookFacade)) {
    throw new Error(`[observability-boundary] local feature facade missing ${required}`)
  }
}

console.log('[observability-boundary] PASS')
