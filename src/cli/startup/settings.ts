import chalk from 'chalk'
import { readFileSync } from 'fs'
import {
  setAllowedSettingSources,
  setFlagSettingsPath,
} from '../../bootstrap/state.js'
import { eagerParseCliFlag } from '../../utils/cliArgs.js'
import { errorMessage, isENOENT } from '../../utils/errors.js'
import {
  getFsImplementation,
  safeResolvePath,
} from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { parseSettingSourcesFlag } from '../../utils/settings/constants.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { writeFileSync_DEPRECATED } from '../../utils/slowOperations.js'
import { profileCheckpoint } from '../../utils/startupProfiler.js'
import { generateTempFilePath } from '../../utils/tempfile.js'

function loadSettingsFromFlag(settingsFile: string): void {
  try {
    const trimmedSettings = settingsFile.trim()
    const looksLikeJson =
      trimmedSettings.startsWith('{') && trimmedSettings.endsWith('}')
    let settingsPath: string

    if (looksLikeJson) {
      if (!safeParseJSON(trimmedSettings)) {
        process.stderr.write(
          chalk.red('Error: Invalid JSON provided to --settings\n'),
        )
        process.exit(1)
      }
      settingsPath = generateTempFilePath('claude-settings', '.json', {
        contentHash: trimmedSettings,
      })
      writeFileSync_DEPRECATED(settingsPath, trimmedSettings, 'utf8')
    } else {
      const { resolvedPath } = safeResolvePath(
        getFsImplementation(),
        settingsFile,
      )
      try {
        readFileSync(resolvedPath, 'utf8')
      } catch (error) {
        if (isENOENT(error)) {
          process.stderr.write(
            chalk.red(`Error: Settings file not found: ${resolvedPath}\n`),
          )
          process.exit(1)
        }
        throw error
      }
      settingsPath = resolvedPath
    }

    setFlagSettingsPath(settingsPath)
    resetSettingsCache()
  } catch (error) {
    if (error instanceof Error) logError(error)
    process.stderr.write(
      chalk.red(`Error processing settings: ${errorMessage(error)}\n`),
    )
    process.exit(1)
  }
}

function loadSettingSourcesFromFlag(settingSourcesArg: string): void {
  try {
    setAllowedSettingSources(parseSettingSourcesFlag(settingSourcesArg))
    resetSettingsCache()
  } catch (error) {
    if (error instanceof Error) logError(error)
    process.stderr.write(
      chalk.red(`Error processing --setting-sources: ${errorMessage(error)}\n`),
    )
    process.exit(1)
  }
}

export function eagerLoadSettings(): void {
  profileCheckpoint('eagerLoadSettings_start')
  const settingsFile = eagerParseCliFlag('--settings')
  if (settingsFile) loadSettingsFromFlag(settingsFile)

  const settingSources = eagerParseCliFlag('--setting-sources')
  if (settingSources !== undefined) loadSettingSourcesFromFlag(settingSources)
  profileCheckpoint('eagerLoadSettings_end')
}
