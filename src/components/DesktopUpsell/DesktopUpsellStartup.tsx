import type React from 'react'

type DesktopUpsellConfig = {
  enable_shortcut_tip: boolean
  enable_startup_dialog: boolean
}

export function getDesktopUpsellConfig(): DesktopUpsellConfig {
  return { enable_shortcut_tip: false, enable_startup_dialog: false }
}

export function shouldShowDesktopUpsellStartup(): boolean {
  return false
}

export function DesktopUpsellStartup(_props: {
  onDone: () => void
}): React.ReactNode {
  return null
}
