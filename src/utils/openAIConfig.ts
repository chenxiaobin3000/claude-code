import {
  getModelRegistryError,
  getModelsConfigPath,
  isModelRegistryMissing,
} from './model/modelRegistry.js'

export function getMissingOpenAIConfig(): string[] {
  const error = getModelRegistryError()
  return error ? [error] : []
}

export function shouldShowOpenAISetup(): boolean {
  return isModelRegistryMissing()
}

export function getOpenAIModelsConfigPath(): string {
  return getModelsConfigPath()
}
