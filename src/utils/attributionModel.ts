import { getMainLoopModel } from './model/model.js'
import { resolveModelTarget } from './model/modelRegistry.js'
import { getAPIProvider } from './model/providers.js'

function resolveProviderModel(anthropicModel: string): string {
  switch (getAPIProvider()) {
    case 'openai':
      return resolveModelTarget(anthropicModel).model
    default:
      return anthropicModel
  }
}

export function getRealModelName(): string {
  return resolveProviderModel(getMainLoopModel())
}
