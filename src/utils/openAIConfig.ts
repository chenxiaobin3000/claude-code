import { getSettingsForSource } from './settings/settings.js'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_OPENAI_MODEL = 'gpt-4o'

export type EffectiveOpenAIConfig = {
  apiKey: string
  baseURL: string
  model: string
}

function configuredValue(name: string): string {
  const processValue = process.env[name]?.trim()
  if (processValue) return processValue

  const settingsValue = getSettingsForSource('userSettings')?.env?.[name]
  return typeof settingsValue === 'string' ? settingsValue.trim() : ''
}

export function getEffectiveOpenAIConfig(): EffectiveOpenAIConfig {
  return {
    apiKey: configuredValue('OPENAI_API_KEY'),
    baseURL: configuredValue('OPENAI_BASE_URL') || DEFAULT_OPENAI_BASE_URL,
    model: configuredValue('OPENAI_MODEL'),
  }
}

export function openAIEndpointRequiresKey(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname.toLowerCase() === 'api.openai.com'
  } catch {
    return true
  }
}

export function getMissingOpenAIConfig(): string[] {
  if (process.env.OPENAI_AUTH_MODE === 'chatgpt') return []

  const config = getEffectiveOpenAIConfig()
  const missing: string[] = []
  if (!config.model) missing.push('OPENAI_MODEL')
  if (openAIEndpointRequiresKey(config.baseURL) && !config.apiKey) {
    missing.push('OPENAI_API_KEY')
  }
  return missing
}

export function shouldShowOpenAISetup(): boolean {
  return getMissingOpenAIConfig().length > 0
}
