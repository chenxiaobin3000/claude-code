/** Local-only plugin loader: --plugin-dir entries plus built-in plugins. */
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import memoize from 'lodash-es/memoize.js'
import { getInlinePlugins } from '../../bootstrap/state.js'
import { getBuiltinPlugins } from '../../plugins/builtinPlugins.js'
import type {
  LoadedPlugin,
  PluginComponent,
  PluginError,
  PluginLoadResult,
  PluginManifest,
} from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { isBareMode } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { pathExists } from '../file.js'
import { jsonParse } from '../slowOperations.js'
import {
  clearPluginSettingsBase,
  getPluginSettingsBase,
  resetSettingsCache,
  setPluginSettingsBase,
} from '../settings/settingsCache.js'
import type { HooksSettings } from '../settings/types.js'
import { discoverAutomaticPlugins } from './automaticPluginDiscovery.js'
import { getPluginsDirectory } from './pluginDirectories.js'
import { verifyAndDemote } from './dependencyResolver.js'
import {
  type CommandMetadata,
  PluginHooksSchema,
  PluginManifestSchema,
} from './schemas.js'

export function getPluginCachePath(): string {
  return join(getPluginsDirectory(), 'cache')
}

export async function loadPluginManifest(
  manifestPath: string,
  pluginName: string,
  source: string,
): Promise<PluginManifest> {
  if (!(await pathExists(manifestPath))) {
    return { name: pluginName, description: `Local plugin from ${source}` }
  }
  const parsed = jsonParse(await readFile(manifestPath, 'utf8'))
  const result = PluginManifestSchema().safeParse(parsed)
  if (result.success) return result.data
  const details = result.error.issues
    .map(issue => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
    .join(', ')
  throw new Error(`Invalid local plugin manifest ${manifestPath}: ${details}`)
}

function resolveLocalComponent(
  root: string,
  value: string,
  plugin: string,
  source: string,
  component: PluginComponent,
  errors: PluginError[],
): string | null {
  const path = resolve(root, value)
  const rel = relative(root, path)
  if (rel.startsWith('..') || resolve(path) === resolve(root)) {
    errors.push({ type: 'path-not-found', source, plugin, path, component })
    return null
  }
  return path
}

async function existingPaths(
  root: string,
  values: string | string[] | undefined,
  plugin: string,
  source: string,
  component: PluginComponent,
  errors: PluginError[],
): Promise<string[]> {
  if (!values) return []
  const paths = (Array.isArray(values) ? values : [values])
    .map(value => resolveLocalComponent(root, value, plugin, source, component, errors))
    .filter((value): value is string => value !== null)
  const checks = await Promise.all(paths.map(pathExists))
  return paths.filter((path, index) => {
    if (checks[index]) return true
    errors.push({ type: 'path-not-found', source, plugin, path, component })
    return false
  })
}

async function readHooks(path: string, pluginName: string): Promise<HooksSettings> {
  const parsed = jsonParse(await readFile(path, 'utf8'))
  return PluginHooksSchema().parse(parsed).hooks as HooksSettings
}

function mergeHooks(base: HooksSettings | undefined, extra: HooksSettings): HooksSettings {
  const merged = { ...(base ?? {}) } as HooksSettings
  for (const [event, matchers] of Object.entries(extra)) {
    const key = event as keyof HooksSettings
    merged[key] = [...(merged[key] ?? []), ...matchers] as never
  }
  return merged
}

export async function createPluginFromPath(
  pluginPath: string,
  source: string,
  enabled: boolean,
  fallbackName: string,
  _strict = true,
): Promise<{ plugin: LoadedPlugin; errors: PluginError[] }> {
  const root = resolve(pluginPath)
  const manifest = await loadPluginManifest(
    join(root, '.claude-plugin', 'plugin.json'),
    fallbackName,
    source,
  )
  const errors: PluginError[] = []
  const plugin: LoadedPlugin = {
    name: manifest.name,
    manifest,
    path: root,
    source,
    repository: source,
    enabled,
  }

  if (!manifest.commands && (await pathExists(join(root, 'commands')))) plugin.commandsPath = join(root, 'commands')
  if (!manifest.agents && (await pathExists(join(root, 'agents')))) plugin.agentsPath = join(root, 'agents')
  if (!manifest.skills && (await pathExists(join(root, 'skills')))) plugin.skillsPath = join(root, 'skills')
  if (!manifest.outputStyles && (await pathExists(join(root, 'output-styles')))) {
    plugin.outputStylesPath = join(root, 'output-styles')
  }

  if (manifest.commands) {
    if (!Array.isArray(manifest.commands) && typeof manifest.commands === 'object') {
      plugin.commandsMetadata = manifest.commands as Record<string, CommandMetadata>
      plugin.commandsPaths = await existingPaths(
        root,
        Object.values(plugin.commandsMetadata).flatMap(item => item.source ? [item.source] : []),
        plugin.name,
        source,
        'commands',
        errors,
      )
    } else {
      plugin.commandsPaths = await existingPaths(root, manifest.commands, plugin.name, source, 'commands', errors)
    }
  }
  plugin.agentsPaths = await existingPaths(root, manifest.agents, plugin.name, source, 'agents', errors)
  plugin.skillsPaths = await existingPaths(root, manifest.skills, plugin.name, source, 'skills', errors)
  plugin.outputStylesPaths = await existingPaths(
    root,
    manifest.outputStyles,
    plugin.name,
    source,
    'output-styles',
    errors,
  )

  const standardHooks = join(root, 'hooks', 'hooks.json')
  if (await pathExists(standardHooks)) plugin.hooksConfig = await readHooks(standardHooks, plugin.name)
  if (manifest.hooks) {
    const hookSpecs = Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks]
    for (const spec of hookSpecs) {
      if (typeof spec === 'string') {
        const path = resolveLocalComponent(root, spec, plugin.name, source, 'hooks', errors)
        if (path && (await pathExists(path))) plugin.hooksConfig = mergeHooks(plugin.hooksConfig, await readHooks(path, plugin.name))
      } else if (spec && typeof spec === 'object') {
        plugin.hooksConfig = mergeHooks(plugin.hooksConfig, spec as HooksSettings)
      }
    }
  }
  return { plugin, errors }
}

type DirectoryPluginInput = {
  path: string
  fallbackName: string
  sourceLabel: string
}

type DirectoryPluginTier = {
  plugins: LoadedPlugin[]
  errors: PluginError[]
  claimedNames: Set<string>
}

async function readClaimedPluginName(
  path: string,
  fallbackName: string,
): Promise<string> {
  try {
    const parsed = jsonParse(
      await readFile(join(path, '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as unknown
    if (parsed && typeof parsed === 'object' && 'name' in parsed) {
      const name = (parsed as { name?: unknown }).name
      if (typeof name === 'string' && name.trim()) return name.trim()
    }
  } catch {
    // The regular manifest loader reports the actionable parsing/path error.
  }
  return fallbackName
}

export async function loadDirectoryPluginTier(
  inputs: readonly DirectoryPluginInput[],
  sourceKind: 'inline' | 'local',
): Promise<DirectoryPluginTier> {
  const plugins: LoadedPlugin[] = []
  const errors: PluginError[] = []
  const claims: string[] = []

  for (const input of inputs) {
    const path = resolve(input.path)
    const claimedName = await readClaimedPluginName(path, input.fallbackName)
    claims.push(claimedName)
    if (!(await pathExists(path))) {
      errors.push({
        type: 'path-not-found',
        source: input.sourceLabel,
        path,
        component: 'commands',
      })
      continue
    }
    try {
      const loaded = await createPluginFromPath(
        path,
        `${input.fallbackName}@${sourceKind}`,
        true,
        input.fallbackName,
      )
      loaded.plugin.source = `${loaded.plugin.name}@${sourceKind}`
      loaded.plugin.repository = loaded.plugin.source
      plugins.push(loaded.plugin)
      errors.push(...loaded.errors)
    } catch (error) {
      errors.push({
        type: 'generic-error',
        source: input.sourceLabel,
        plugin: claimedName,
        error: errorMessage(error),
      })
    }
  }

  const claimCounts = new Map<string, number>()
  for (const name of claims) {
    claimCounts.set(name, (claimCounts.get(name) ?? 0) + 1)
  }
  const duplicateNames = new Set(
    [...claimCounts]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  )
  for (const name of [...duplicateNames].sort()) {
    errors.push({
      type: 'generic-error',
      source: `${name}@${sourceKind}`,
      plugin: name,
      error: `Duplicate ${sourceKind} plugin name ${JSON.stringify(name)}; all same-priority candidates were disabled`,
    })
  }

  return {
    plugins: plugins.filter(plugin => !duplicateNames.has(plugin.name)),
    errors,
    claimedNames: new Set(claims),
  }
}

async function loadInlineDirectoryPlugins(): Promise<DirectoryPluginTier> {
  return loadDirectoryPluginTier(
    getInlinePlugins().map((inputPath, index) => ({
      path: inputPath,
      fallbackName: basename(resolve(inputPath)),
      sourceLabel: `inline[${index}]`,
    })),
    'inline',
  )
}

export function isAutomaticPluginDiscoveryEnabled(): boolean {
  return !isBareMode()
}

async function loadAutomaticDirectoryPlugins(): Promise<DirectoryPluginTier> {
  if (!isAutomaticPluginDiscoveryEnabled()) {
    return { plugins: [], errors: [], claimedNames: new Set() }
  }
  const discovery = await discoverAutomaticPlugins()
  const loaded = await loadDirectoryPluginTier(
    discovery.candidates.map(candidate => ({
      path: candidate.pluginPath,
      fallbackName: candidate.directoryName,
      sourceLabel: `${candidate.directoryName}@local`,
    })),
    'local',
  )
  loaded.errors.unshift(
    ...discovery.errors.map(
      (error): PluginError => ({
        type: 'generic-error',
        source: 'automatic-plugin-discovery',
        error: `${error.path}: ${error.error}`,
      }),
    ),
  )
  for (const error of discovery.errors) {
    if (error.directoryName) loaded.claimedNames.add(error.directoryName)
  }
  return loaded
}

export function selectPluginsByPriority(
  inline: DirectoryPluginTier,
  automatic: DirectoryPluginTier,
  builtin: { enabled: LoadedPlugin[]; disabled: LoadedPlugin[] },
): { plugins: LoadedPlugin[]; errors: PluginError[] } {
  const automaticPlugins = automatic.plugins.filter(
    plugin => !inline.claimedNames.has(plugin.name),
  )
  const claimedLocalNames = new Set([
    ...inline.claimedNames,
    ...automatic.claimedNames,
  ])
  const builtinPlugins = [...builtin.enabled, ...builtin.disabled].filter(
    plugin => !claimedLocalNames.has(plugin.name),
  )
  return {
    plugins: [...inline.plugins, ...automaticPlugins, ...builtinPlugins],
    errors: [...inline.errors, ...automatic.errors],
  }
}

async function assemblePluginLoadResult(): Promise<PluginLoadResult> {
  const [inline, automatic] = await Promise.all([
    loadInlineDirectoryPlugins(),
    loadAutomaticDirectoryPlugins(),
  ])
  const selected = selectPluginsByPriority(
    inline,
    automatic,
    getBuiltinPlugins(),
  )
  const plugins = selected.plugins
  const { demoted, errors } = verifyAndDemote(plugins)
  for (const plugin of plugins) if (demoted.has(plugin.source)) plugin.enabled = false
  cachePluginSettings(plugins.filter(plugin => plugin.enabled))
  return {
    enabled: plugins.filter(plugin => plugin.enabled),
    disabled: plugins.filter(plugin => !plugin.enabled),
    errors: [...selected.errors, ...errors],
  }
}

export const loadAllPlugins = memoize(assemblePluginLoadResult)
export const loadAllPluginsCacheOnly = memoize(assemblePluginLoadResult)

export function clearPluginCache(reason?: string): void {
  if (reason) logForDebugging(`Clearing local plugin cache: ${reason}`)
  loadAllPlugins.cache?.clear?.()
  loadAllPluginsCacheOnly.cache?.clear?.()
  if (getPluginSettingsBase() !== undefined) resetSettingsCache()
  clearPluginSettingsBase()
}

export function cachePluginSettings(plugins: LoadedPlugin[]): void {
  let merged: Record<string, unknown> | undefined
  for (const plugin of plugins) {
    if (!plugin.settings) continue
    merged = { ...(merged ?? {}), ...plugin.settings }
  }
  setPluginSettingsBase(merged)
}
