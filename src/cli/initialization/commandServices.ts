import type { Command } from '@commander-js/extra-typings'
import { feature } from 'bun:bundle'
import { init } from '../../entrypoints/init.js'
import { setInlinePlugins } from '../../bootstrap/state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import { ensureMdmSettingsLoaded } from '../../utils/settings/mdm/settings.js'
import { profileCheckpoint } from '../../utils/startupProfiler.js'
import { runStartupMigrations } from './migrations.js'

export function registerCommandServiceInitialization(program: Command): void {
  program.hook('preAction', async thisCommand => {
    profileCheckpoint('preAction_start')
    await ensureMdmSettingsLoaded()
    profileCheckpoint('preAction_after_mdm')
    await init()
    profileCheckpoint('preAction_after_init')

    if (!isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE)) {
      process.title = 'claude'
    }

    const { initSinks } = await import('../../utils/sinks.js')
    initSinks()
    profileCheckpoint('preAction_after_sinks')

    const pluginDir = thisCommand.getOptionValue('pluginDir')
    if (
      Array.isArray(pluginDir) &&
      pluginDir.length > 0 &&
      pluginDir.every(path => typeof path === 'string')
    ) {
      setInlinePlugins(pluginDir)
      clearPluginCache('preAction: --plugin-dir inline plugins')
    }

    runStartupMigrations()
    profileCheckpoint('preAction_after_migrations')

  })
}
