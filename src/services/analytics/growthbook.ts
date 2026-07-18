/** Pure local runtime feature-policy facade; no SDK, cache, refresh, or network I/O. */
import { RUNTIME_FEATURE_DEFAULTS } from '../../../scripts/feature-policy.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

export type GrowthBookUserAttributes = Record<string, never>
type Listener = () => void | Promise<void>

function environmentOverrides(): Record<string, unknown> {
  const raw = process.env.CLAUDE_LOCAL_FEATURE_OVERRIDES
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function configOverrides(): Record<string, unknown> {
  try {
    return getGlobalConfig().localFeatureOverrides ?? {}
  } catch {
    return {}
  }
}

function valueFor<T>(name: string, fallback: T): T {
  const environment = environmentOverrides()
  if (name in environment) return environment[name] as T
  const configured = configOverrides()
  if (name in configured) return configured[name] as T
  return name in RUNTIME_FEATURE_DEFAULTS
    ? (RUNTIME_FEATURE_DEFAULTS[name] as T)
    : fallback
}

export function onGrowthBookRefresh(_listener: Listener): () => void { return () => {} }
export function hasGrowthBookEnvOverride(feature: string): boolean { return feature in environmentOverrides() }
export function getAllGrowthBookFeatures(): Record<string, unknown> {
  return { ...RUNTIME_FEATURE_DEFAULTS, ...configOverrides(), ...environmentOverrides() }
}
export function getGrowthBookConfigOverrides(): Record<string, unknown> { return configOverrides() }
export function setGrowthBookConfigOverride(feature: string, value: unknown): void {
  saveGlobalConfig(config => ({
    ...config,
    localFeatureOverrides: { ...(config.localFeatureOverrides ?? {}), [feature]: value },
  }))
}
export function clearGrowthBookConfigOverrides(): void {
  saveGlobalConfig(config => {
    const { localFeatureOverrides: _, ...rest } = config
    return rest
  })
}
export function getApiBaseUrlHost(): undefined { return undefined }
export const initializeGrowthBook = async (): Promise<void> => {}
export async function getFeatureValue_DEPRECATED<T>(feature: string, fallback: T): Promise<T> { return valueFor(feature, fallback) }
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(feature: string, fallback: T): T { return valueFor(feature, fallback) }
export function getFeatureValue_CACHED_WITH_REFRESH<T>(feature: string, fallback: T, _refreshMs?: number): T { return valueFor(feature, fallback) }
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate: string): boolean { return Boolean(valueFor(gate, false)) }
export async function checkSecurityRestrictionGate(gate: string): Promise<boolean> { return Boolean(valueFor(gate, false)) }
export async function checkGate_CACHED_OR_BLOCKING(gate: string): Promise<boolean> { return Boolean(valueFor(gate, false)) }
export function refreshGrowthBookAfterAuthChange(): void {}
export function resetGrowthBook(): void {}
export async function refreshGrowthBookFeatures(): Promise<void> {}
export function setupPeriodicGrowthBookRefresh(): void {}
export function stopPeriodicGrowthBookRefresh(): void {}
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(name: string, fallback: T): Promise<T> { return valueFor(name, fallback) }
export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(name: string, fallback: T): T { return valueFor(name, fallback) }
