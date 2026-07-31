import { dirname, join, resolve } from 'node:path'
import { isInBundledMode } from '../bundledMode.js'

export const AUTOMATIC_PLUGINS_DIRECTORY_NAME = 'plugins'

/**
 * Resolve the only automatic plugin root: the `plugins` directory beside the
 * standalone executable. Plugin discovery may inspect only direct children of
 * this root; it must never treat the cwd or the user plugin cache as a source.
 */
export function resolveAutomaticPluginDirectory(
  executablePath: string,
): string {
  return join(
    dirname(resolve(executablePath)),
    AUTOMATIC_PLUGINS_DIRECTORY_NAME,
  )
}

/** Source/Bun development keeps the existing explicit --plugin-dir behavior. */
export function getAutomaticPluginDirectory(): string | undefined {
  if (!isInBundledMode()) return undefined
  return resolveAutomaticPluginDirectory(process.execPath)
}
