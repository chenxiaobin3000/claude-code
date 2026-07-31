import { Box, Text } from '@anthropic/ink'
import * as React from 'react'
import { useEffect } from 'react'
import type { PluginSettingsProps } from './types.js'
import { ValidatePlugin } from './ValidatePlugin.js'
import { parsePluginArgs } from './parseArgs.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { getPluginSourceLabel } from '../../utils/plugins/pluginIdentifier.js'

/** Local-only plugin command surface. Remote marketplace distribution is not supported. */
export function PluginSettings({ onComplete, args }: PluginSettingsProps): React.ReactNode {
  const command = parsePluginArgs(args)

  if (command.type === 'validate') {
    return <ValidatePlugin onComplete={onComplete} path={command.path} />
  }

  return <LocalPluginSummary onComplete={onComplete} showHelp={command.type === 'help'} />
}

function LocalPluginSummary({
  onComplete,
  showHelp,
}: {
  onComplete: PluginSettingsProps['onComplete']
  showHelp: boolean
}): React.ReactNode {
  useEffect(() => {
    void loadAllPluginsCacheOnly().then(result => {
      const plugins = [...result.enabled, ...result.disabled]
      const lines = plugins.map(plugin =>
        `  ${plugin.enabled ? '✓' : '○'} ${plugin.name} (${getPluginSourceLabel(plugin.source)})`,
      )
      const header = showHelp
        ? [
            'Local plugin commands:',
            '  /plugin                 List loaded local and built-in plugins',
            '  /plugin validate <path> Validate a local plugin manifest or directory',
            '',
            'Standalone builds automatically load direct plugin directories from the plugins folder beside claude.exe.',
            'Use --plugin-dir <path> for an explicit session plugin; it overrides an automatic plugin with the same name.',
            'Remote marketplaces, downloads, and updates are disabled.',
          ]
        : [
            'Loaded local and built-in plugins:',
            ...(lines.length > 0 ? lines : ['  No plugins loaded']),
            '',
            'Standalone builds also scan one directory level under the plugins folder beside claude.exe.',
            'Use --plugin-dir <path> to explicitly load or override a local plugin, or /plugin validate <path> to validate one.',
          ]
      onComplete(header.join('\n'))
    })
  }, [onComplete, showHelp])

  return (
    <Box>
      <Text>Loading local plugins…</Text>
    </Box>
  )
}
