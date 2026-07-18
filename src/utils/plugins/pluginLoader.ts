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

async function loadLocalDirectoryPlugins(): Promise<{ plugins: LoadedPlugin[]; errors: PluginError[] }> {
  const plugins: LoadedPlugin[] = []
  const errors: PluginError[] = []
  for (const [index, inputPath] of getInlinePlugins().entries()) {
    const path = resolve(inputPath)
    if (!(await pathExists(path))) {
      errors.push({ type: 'path-not-found', source: `inline[${index}]`, path, component: 'commands' })
      continue
    }
    try {
      const loaded = await createPluginFromPath(path, `${basename(path)}@inline`, true, basename(path))
      loaded.plugin.source = `${loaded.plugin.name}@inline`
      loaded.plugin.repository = loaded.plugin.source
      plugins.push(loaded.plugin)
      errors.push(...loaded.errors)
    } catch (error) {
      errors.push({ type: 'generic-error', source: `inline[${index}]`, error: errorMessage(error) })
    }
  }
  return { plugins, errors }
}

async function assemblePluginLoadResult(): Promise<PluginLoadResult> {
  const local = await loadLocalDirectoryPlugins()
  const builtin = getBuiltinPlugins()
  const localNames = new Set(local.plugins.map(plugin => plugin.name))
  const builtins = [...builtin.enabled, ...builtin.disabled].filter(plugin => !localNames.has(plugin.name))
  const plugins = [...local.plugins, ...builtins]
  const { demoted, errors } = verifyAndDemote(plugins)
  for (const plugin of plugins) if (demoted.has(plugin.source)) plugin.enabled = false
  cachePluginSettings(plugins.filter(plugin => plugin.enabled))
  return {
    enabled: plugins.filter(plugin => plugin.enabled),
    disabled: plugins.filter(plugin => !plugin.enabled),
    errors: [...local.errors, ...errors],
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
