import { Box, Text } from '@anthropic/ink'
import * as React from 'react'
import { useEffect } from 'react'
import type { PluginSettingsProps } from './types.js'
import { ValidatePlugin } from './ValidatePlugin.js'
import { parsePluginArgs } from './parseArgs.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'

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
        `  ${plugin.enabled ? '✓' : '○'} ${plugin.name} (${plugin.source})`,
      )
      const header = showHelp
        ? [
            'Local plugin commands:',
            '  /plugin                 List loaded local and built-in plugins',
            '  /plugin validate <path> Validate a local plugin manifest or directory',
            '',
            'Load a directory plugin with --plugin-dir <path>. Remote marketplaces, downloads, and updates are disabled.',
          ]
        : [
            'Loaded local and built-in plugins:',
            ...(lines.length > 0 ? lines : ['  No plugins loaded']),
            '',
            'Use --plugin-dir <path> to load a local plugin, or /plugin validate <path> to validate one.',
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
