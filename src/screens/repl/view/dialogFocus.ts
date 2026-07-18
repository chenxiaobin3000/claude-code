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
  | 'search-extra-tools-hint'
  | 'desktop-upsell'
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
  ideOnboarding: boolean
  modelSwitch: boolean
  undercoverCallout: boolean
  effortCallout: boolean
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
  if (state.ideOnboarding) return 'ide-onboarding'
  if (process.env.USER_TYPE === 'ant' && state.modelSwitch)
    return 'model-switch'
  if (process.env.USER_TYPE === 'ant' && state.undercoverCallout)
    return 'undercover-callout'
  if (state.effortCallout) return 'effort-callout'
  if (state.searchExtraToolsHint) return 'search-extra-tools-hint'
  if (state.desktopUpsell) return 'desktop-upsell'
  return undefined
}
