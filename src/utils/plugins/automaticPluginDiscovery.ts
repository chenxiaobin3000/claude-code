import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { errorMessage } from '../errors.js'
import { getAutomaticPluginDirectory } from './automaticPluginDirectory.js'

const PLUGIN_MANIFEST_PARTS = ['.claude-plugin', 'plugin.json'] as const

export type AutomaticPluginCandidate = {
  directoryName: string
  pluginPath: string
  manifestPath: string
}

export type AutomaticPluginDiscoveryError = {
  path: string
  error: string
  directoryName?: string
}

export type AutomaticPluginDiscoveryResult = {
  candidates: AutomaticPluginCandidate[]
  errors: AutomaticPluginDiscoveryError[]
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function isPathInsideDirectory(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  )
}

/**
 * Discover plugins from immediate child directories of the automatic plugin
 * root. This function never recursively searches for manifests.
 */
export async function discoverAutomaticPluginDirectories(
  automaticRoot: string,
): Promise<AutomaticPluginDiscoveryResult> {
  const candidates: AutomaticPluginCandidate[] = []
  const errors: AutomaticPluginDiscoveryError[] = []

  let rootPath: string
  try {
    const rootStat = await lstat(automaticRoot)
    if (rootStat.isSymbolicLink()) {
      return {
        candidates,
        errors: [
          {
            path: automaticRoot,
            error: 'automatic plugin root must not be a symbolic link or Junction',
          },
        ],
      }
    }
    if (!rootStat.isDirectory()) {
      return {
        candidates,
        errors: [
          {
            path: automaticRoot,
            error: 'automatic plugin root is not a directory',
          },
        ],
      }
    }
    rootPath = await realpath(automaticRoot)
  } catch (error) {
    if (isMissingPath(error)) return { candidates, errors }
    return {
      candidates,
      errors: [{ path: automaticRoot, error: errorMessage(error) }],
    }
  }

  let entries
  try {
    entries = await readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    return {
      candidates,
      errors: [{ path: rootPath, error: errorMessage(error) }],
    }
  }

  entries.sort((left, right) => compareNames(left.name, right.name))
  for (const entry of entries) {
    const childPath = join(rootPath, entry.name)
    if (entry.isSymbolicLink()) {
      errors.push({
        path: childPath,
        error: 'automatic plugin entry must not be a symbolic link or Junction',
        directoryName: entry.name,
      })
      continue
    }
    if (!entry.isDirectory()) continue

    try {
      const childStat = await lstat(childPath)
      if (childStat.isSymbolicLink()) {
        errors.push({
          path: childPath,
          error: 'automatic plugin entry must not be a symbolic link or Junction',
          directoryName: entry.name,
        })
        continue
      }
      if (!childStat.isDirectory()) continue

      const pluginPath = await realpath(childPath)
      if (!isPathInsideDirectory(rootPath, pluginPath)) {
        errors.push({
          path: childPath,
          error: 'automatic plugin entry resolves outside the automatic plugin root',
          directoryName: entry.name,
        })
        continue
      }

      const manifestPath = join(pluginPath, ...PLUGIN_MANIFEST_PARTS)
      let manifestStat
      try {
        manifestStat = await lstat(manifestPath)
      } catch (error) {
        if (isMissingPath(error)) continue
        errors.push({
          path: manifestPath,
          error: errorMessage(error),
          directoryName: entry.name,
        })
        continue
      }
      if (manifestStat.isSymbolicLink()) {
        errors.push({
          path: manifestPath,
          error: 'automatic plugin manifest must not be a symbolic link',
          directoryName: entry.name,
        })
        continue
      }
      if (!manifestStat.isFile()) continue

      const resolvedManifestPath = await realpath(manifestPath)
      if (!isPathInsideDirectory(pluginPath, resolvedManifestPath)) {
        errors.push({
          path: manifestPath,
          error: 'automatic plugin manifest resolves outside its plugin directory',
          directoryName: entry.name,
        })
        continue
      }

      candidates.push({
        directoryName: entry.name,
        pluginPath,
        manifestPath: resolvedManifestPath,
      })
    } catch (error) {
      errors.push({
        path: childPath,
        error: errorMessage(error),
        directoryName: entry.name,
      })
    }
  }

  return { candidates, errors }
}

export async function discoverAutomaticPlugins(): Promise<AutomaticPluginDiscoveryResult> {
  const automaticRoot = getAutomaticPluginDirectory()
  return automaticRoot
    ? discoverAutomaticPluginDirectories(automaticRoot)
    : { candidates: [], errors: [] }
}
