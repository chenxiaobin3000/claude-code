import { basename, dirname } from 'node:path'
import figures from 'figures'
import { errorMessage } from '../../utils/errors.js'
import { setUseCoworkPlugins } from '../../bootstrap/state.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import {
  validateManifest,
  validatePluginContents,
  type ValidationResult,
} from '../../utils/plugins/validatePlugin.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/* eslint-disable custom-rules/no-process-exit -- terminal CLI subcommands must terminate after printing */

function printValidationResult(result: ValidationResult): void {
  for (const error of result.errors) console.log(`  ${figures.cross} ${error.path}: ${error.message}`)
  for (const warning of result.warnings) console.log(`  ${figures.warning} ${warning.path}: ${warning.message}`)
}

export async function pluginValidateHandler(
  manifestPath: string,
  options: { cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  try {
    const result = await validateManifest(manifestPath)
    console.log(`Validating ${result.fileType} manifest: ${result.filePath}`)
    printValidationResult(result)
    let contentResults: ValidationResult[] = []
    const manifestDir = dirname(result.filePath)
    if (result.fileType === 'plugin' && basename(manifestDir) === '.claude-plugin') {
      contentResults = await validatePluginContents(dirname(manifestDir))
      contentResults.forEach(printValidationResult)
    }
    process.exit(result.success && contentResults.every(item => item.success) ? 0 : 1)
  } catch (error) {
    console.error(`${figures.cross} Validation failed: ${errorMessage(error)}`)
    process.exit(2)
  }
}

export async function pluginListHandler(options: { json?: boolean; cowork?: boolean }): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  const result = await loadAllPlugins()
  const plugins = [...result.enabled, ...result.disabled].map(plugin => ({
    name: plugin.name,
    source: plugin.source,
    path: plugin.path,
    enabled: plugin.enabled,
    version: plugin.manifest.version,
  }))
  if (options.json) {
    console.log(jsonStringify(plugins, null, 2))
    process.exit(0)
  }
  if (plugins.length === 0) {
    console.log('No local or built-in plugins loaded.')
    process.exit(0)
  }
  console.log('Loaded local and built-in plugins:')
  for (const plugin of plugins) console.log(`  ${plugin.enabled ? figures.tick : '○'} ${plugin.name} (${plugin.source})`)
  process.exit(0)
}
