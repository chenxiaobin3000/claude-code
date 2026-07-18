import React from 'react'
import { Box, Dialog, Text } from '@anthropic/ink'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { env } from '../../utils/env.js'
import { isChromeExtensionInstalled } from '../../utils/claudeInChrome/setup.js'

type Props = {
  onDone: (result?: string) => void
  installed: boolean
  enabled: boolean
  isWSL: boolean
}

function LocalChromeMenu({ onDone, installed, enabled, isWSL }: Props) {
  return (
    <Dialog title="Local Chrome extension" onCancel={() => onDone()} color="chromeYellow">
      <Box flexDirection="column" gap={1}>
        <Text>Only the local Native Messaging connection is supported.</Text>
        <Text>Extension: {installed ? 'Installed' : 'Not detected'}</Text>
        {isWSL && <Text color="error">The local Chrome extension is not supported in WSL.</Text>}
        <Text>
          Enabled by default: {enabled ? 'Yes' : 'No'} · press Enter to toggle
        </Text>
        <Text dimColor>No Claude account, OAuth, or cloud Bridge is used.</Text>
      </Box>
    </Dialog>
  )
}

export const call = async function (
  onDone: (result?: string) => void,
): Promise<React.ReactNode> {
  const installed = await isChromeExtensionInstalled()
  const config = getGlobalConfig()
  const enabled = config.claudeInChromeDefaultEnabled ?? false
  saveGlobalConfig(current => ({
    ...current,
    claudeInChromeDefaultEnabled: !enabled,
  }))
  return (
    <LocalChromeMenu
      onDone={onDone}
      installed={installed}
      enabled={!enabled}
      isWSL={env.isWslEnvironment()}
    />
  )
}
