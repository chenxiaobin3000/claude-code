import { classifyOpenAIError } from '../../services/api/openai/errorClassification.js'
import { sideQuery } from '../sideQuery.js'
import { isModelAllowed } from './modelAllowlist.js'
import { findConfiguredModel, getModelsConfigPath } from './modelRegistry.js'

const validModelCache = new Map<string, boolean>()

/** Validates a configured model by making one explicit minimal API request. */
export async function validateModel(
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedModel = model.trim()

  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  if (!isModelAllowed(normalizedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not in the list of available models`,
    }
  }

  if (!findConfiguredModel(normalizedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not configured in ${getModelsConfigPath()}`,
    }
  }

  if (validModelCache.has(normalizedModel)) {
    return { valid: true }
  }

  try {
    await sideQuery({
      model: normalizedModel,
      max_tokens: 1,
      maxRetries: 0,
      querySource: 'model_validation',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hi',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    })

    validModelCache.set(normalizedModel, true)
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: classifyOpenAIError(error).userMessage,
    }
  }
}
