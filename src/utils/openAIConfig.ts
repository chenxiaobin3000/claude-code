import {
  getModelRegistryError,
  getModelsConfigPath,
} from './model/modelRegistry.js'

export function getMissingOpenAIConfig(): string[] {
  const error = getModelRegistryError()
  return error ? [error] : []
}

export function shouldShowOpenAISetup(): boolean {
  return getModelRegistryError() !== null
}

export function getOpenAIModelsConfigPath(): string {
  return getModelsConfigPath()
}
