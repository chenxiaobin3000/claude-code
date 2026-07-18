import type { LocalJSXCommandOnDone } from 'src/types/command.js'

export type PluginSettingsProps = {
  onComplete: LocalJSXCommandOnDone
  args?: string
  showMcpRedirectMessage?: boolean
}
