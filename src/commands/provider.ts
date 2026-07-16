import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getModelRegistryError,
  getModelsConfigPath,
} from '../utils/model/modelRegistry.js'

const call: LocalCommandCall = async args => {
  const arg = args.trim().toLowerCase()
  if (arg && arg !== 'openai') {
    return {
      type: 'text',
      value: `Invalid provider: ${arg}\nValid: openai`,
    }
  }

  const error = getModelRegistryError()
  return {
    type: 'text',
    value: error
      ? `Current API provider: ${getAPIProvider()}\nModel configuration: ${error}`
      : `Current API provider: ${getAPIProvider()}\nModels: ${getModelsConfigPath()}`,
  }
}

const provider = {
  type: 'local',
  name: 'provider',
  description: 'Show the OpenAI-compatible API provider configuration',
  aliases: ['api'],
  argumentHint: '[openai]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default provider
