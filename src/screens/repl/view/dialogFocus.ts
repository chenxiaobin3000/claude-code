import { feature } from 'bun:bundle'

export type FocusedInputDialog =
  | 'message-selector'
  | 'sandbox-permission'
  | 'tool-permission'
  | 'prompt'
  | 'worker-sandbox-permission'
  | 'elicitation'
  | 'cost'
  | 'idle-return'
  | 'ide-onboarding'
  | 'model-switch'
  | 'undercover-callout'
  | 'effort-callout'
  | 'remote-callout'
  | 'lsp-recommendation'
  | 'plugin-hint'
  | 'search-extra-tools-hint'
  | 'desktop-upsell'
  | 'ultraplan-choice'
  | 'ultraplan-launch'
  | undefined

type DialogAvailability = {
  exiting: boolean
  messageSelector: boolean
  promptInputActive: boolean
  sandboxPermission: boolean
  toolPermission: boolean
  prompt: boolean
  workerSandboxPermission: boolean
  elicitation: boolean
  cost: boolean
  idleReturn: boolean
  allowDialogsWithAnimation: boolean
  isLoading: boolean
  ultraplanChoice: boolean
  ultraplanLaunch: boolean
  ideOnboarding: boolean
  modelSwitch: boolean
  undercoverCallout: boolean
  effortCallout: boolean
  remoteCallout: boolean
  lspRecommendation: boolean
  pluginHint: boolean
  searchExtraToolsHint: boolean
  desktopUpsell: boolean
}

export function selectFocusedInputDialog(
  state: DialogAvailability,
): FocusedInputDialog {
  if (state.exiting) return undefined
  if (state.messageSelector) return 'message-selector'
  if (state.promptInputActive) return undefined
  if (state.sandboxPermission) return 'sandbox-permission'
  if (!state.allowDialogsWithAnimation) return undefined
  if (state.toolPermission) return 'tool-permission'
  if (state.prompt) return 'prompt'
  if (state.workerSandboxPermission) return 'worker-sandbox-permission'
  if (state.elicitation) return 'elicitation'
  if (state.cost) return 'cost'
  if (state.idleReturn) return 'idle-return'
  if (feature('ULTRAPLAN') && !state.isLoading && state.ultraplanChoice)
    return 'ultraplan-choice'
  if (feature('ULTRAPLAN') && !state.isLoading && state.ultraplanLaunch)
    return 'ultraplan-launch'
  if (state.ideOnboarding) return 'ide-onboarding'
  if (process.env.USER_TYPE === 'ant' && state.modelSwitch)
    return 'model-switch'
  if (process.env.USER_TYPE === 'ant' && state.undercoverCallout)
    return 'undercover-callout'
  if (state.effortCallout) return 'effort-callout'
  if (state.remoteCallout) return 'remote-callout'
  if (state.lspRecommendation) return 'lsp-recommendation'
  if (state.pluginHint) return 'plugin-hint'
  if (state.searchExtraToolsHint) return 'search-extra-tools-hint'
  if (state.desktopUpsell) return 'desktop-upsell'
  return undefined
}
