import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getModelProfile } from './modelProfiles.js'

export interface ModelRegistryEntry {
  model: string
  baseUrl: string
  apiKeyEnv?: string
  displayName?: string
  description?: string
}

export interface ModelRegistry {
  defaultModel: string
  models: ModelRegistryEntry[]
}

export type ResolvedModelTarget = ModelRegistryEntry & {
  apiKey: string
}

let cachedRegistry: ModelRegistry | null = null

export function getModelsConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'models.json')
}

export function isModelRegistryMissing(): boolean {
  return !existsSync(getModelsConfigPath())
}

export function clearModelRegistryCache(): void {
  cachedRegistry = null
}

export function saveSingleModelRegistry(entry: ModelRegistryEntry): void {
  const registry = parseModelRegistry({
    defaultModel: entry.model,
    models: [entry],
  })
  const path = getModelsConfigPath()
  const temporaryPath = `${path}.${process.pid}.tmp`

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(temporaryPath, path)
  cachedRegistry = registry
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, path)
}

function parseModelEntry(value: unknown, index: number): ModelRegistryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`models.${index} must be an object`)
  }
  const entry = value as Record<string, unknown>
  const model = requiredString(entry.model, `models.${index}.model`)
  const baseUrl = requiredString(entry.baseUrl, `models.${index}.baseUrl`)
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`models.${index}.baseUrl must be a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`models.${index}.baseUrl must use HTTP or HTTPS`)
  }

  return {
    model,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKeyEnv: optionalString(entry.apiKeyEnv, `models.${index}.apiKeyEnv`),
    displayName: optionalString(
      entry.displayName,
      `models.${index}.displayName`,
    ),
    description: optionalString(
      entry.description,
      `models.${index}.description`,
    ),
  }
}

function parseModelRegistry(value: unknown): ModelRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('configuration root must be an object')
  }
  const config = value as Record<string, unknown>
  const defaultModel = requiredString(config.defaultModel, 'defaultModel')
  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new Error('models must contain at least one model')
  }

  const models = config.models.map(parseModelEntry)
  const seen = new Set<string>()
  for (const entry of models) {
    if (seen.has(entry.model)) {
      throw new Error(`duplicate model: ${entry.model}`)
    }
    seen.add(entry.model)
    getModelProfile(entry.model)
  }
  if (!seen.has(defaultModel)) {
    throw new Error(`defaultModel is not present in models: ${defaultModel}`)
  }
  return { defaultModel, models }
}

export function loadModelRegistry(): ModelRegistry {
  if (cachedRegistry) return cachedRegistry

  const path = getModelsConfigPath()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(
      `Unable to read model configuration at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    cachedRegistry = parseModelRegistry(parsed)
  } catch (error) {
    throw new Error(
      `Invalid model configuration at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return cachedRegistry
}

export function getModelRegistryError(): string | null {
  try {
    loadModelRegistry()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function getConfiguredModels(): ModelRegistryEntry[] {
  return loadModelRegistry().models
}

export function getDefaultConfiguredModel(): string {
  return loadModelRegistry().defaultModel
}

export function findConfiguredModel(
  model: string,
): ModelRegistryEntry | undefined {
  return loadModelRegistry().models.find(entry => entry.model === model)
}

export function resolveModelTarget(model?: string | null): ResolvedModelTarget {
  const registry = loadModelRegistry()
  const selected = model ?? registry.defaultModel
  const entry = registry.models.find(candidate => candidate.model === selected)
  if (!entry) {
    throw new Error(
      `Model ${JSON.stringify(selected)} is not configured in ${getModelsConfigPath()}`,
    )
  }

  const apiKeyEnv = entry.apiKeyEnv ?? 'OPENAI_API_KEY'
  return {
    ...entry,
    apiKey: process.env[apiKeyEnv] ?? 'not-required',
  }
}
