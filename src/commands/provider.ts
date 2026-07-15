import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'

// Get merged env: process.env + settings.env (from userSettings)
function getMergedEnv(): Record<string, string> {
  const settings = getSettings_DEPRECATED()
  const merged: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  )
  if (settings?.env) {
    Object.assign(merged, settings.env)
  }
  return merged
}

const call: LocalCommandCall = async (args, _context) => {
  const arg = args.trim().toLowerCase()

  // No argument: show current provider
  if (!arg) {
    const current = getAPIProvider()
    return { type: 'text', value: `Current API provider: ${current}` }
  }

  // unset - clear settings, fallback to env vars
  if (arg === 'unset') {
    updateSettingsForSource('userSettings', { modelType: undefined })
    return {
      type: 'text',
      value: 'API provider cleared (OpenAI is the default).',
    }
  }

  // Validate provider
  const validProviders = ['openai']
  if (!validProviders.includes(arg)) {
    return {
      type: 'text',
      value: `Invalid provider: ${arg}\nValid: ${validProviders.join(', ')}`,
    }
  }

  // Check env vars when switching to openai (including settings.env)
  if (arg === 'openai') {
    const mergedEnv = getMergedEnv()
    const hasChatGPTAuth = mergedEnv.OPENAI_AUTH_MODE === 'chatgpt'
    const hasKey = !!mergedEnv.OPENAI_API_KEY
    const hasUrl = !!mergedEnv.OPENAI_BASE_URL
    if (!hasChatGPTAuth && (!hasKey || !hasUrl)) {
      updateSettingsForSource('userSettings', { modelType: 'openai' })
      const missing = []
      if (!hasKey) missing.push('OPENAI_API_KEY')
      if (!hasUrl) missing.push('OPENAI_BASE_URL')
      return {
        type: 'text',
        value: `Switched to OpenAI provider.\nWarning: Missing env vars: ${missing.join(', ')}\nSet them in your environment or settings.json.`,
      }
    }
  }

  updateSettingsForSource('userSettings', { modelType: 'openai' })
  applyConfigEnvironmentVariables()
  return { type: 'text', value: 'API provider set to openai.' }
}

const provider = {
  type: 'local',
  name: 'provider',
  description:
    'Show or configure the OpenAI-compatible API provider',
  aliases: ['api'],
  argumentHint: '[openai|unset]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default provider
