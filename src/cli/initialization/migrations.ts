import { feature } from 'bun:bundle'
import { migrateBypassPermissionsAcceptedToSettings } from '../../migrations/migrateBypassPermissionsAcceptedToSettings.js'
import { migrateEnableAllProjectMcpServersToSettings } from '../../migrations/migrateEnableAllProjectMcpServersToSettings.js'
import { migrateFennecToOpus } from '../../migrations/migrateFennecToOpus.js'
import { migrateLegacyOpusToCurrent } from '../../migrations/migrateLegacyOpusToCurrent.js'
import { migrateOpusToOpus1m } from '../../migrations/migrateOpusToOpus1m.js'
import { migrateSonnet1mToSonnet45 } from '../../migrations/migrateSonnet1mToSonnet45.js'
import { resetAutoModeOptInForDefaultOffer } from '../../migrations/resetAutoModeOptInForDefaultOffer.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { migrateChangelogFromConfig } from '../../utils/releaseNotes.js'

// Bump this when adding a new synchronous migration.
const CURRENT_MIGRATION_VERSION = 11

export function runStartupMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateBypassPermissionsAcceptedToSettings()
    migrateEnableAllProjectMcpServersToSettings()
    migrateSonnet1mToSonnet45()
    migrateLegacyOpusToCurrent()
    migrateOpusToOpus1m()
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      resetAutoModeOptInForDefaultOffer()
    }
    if (process.env.USER_TYPE === 'ant') {
      migrateFennecToOpus()
    }
    saveGlobalConfig(previous =>
      previous.migrationVersion === CURRENT_MIGRATION_VERSION
        ? previous
        : { ...previous, migrationVersion: CURRENT_MIGRATION_VERSION },
    )
  }

  void migrateChangelogFromConfig().catch(() => {
    // Retried during the next startup.
  })
}
