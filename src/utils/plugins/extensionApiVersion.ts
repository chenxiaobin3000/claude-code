import { satisfies, validRange } from 'semver'

/**
 * Declarative Plugin API exposed by this distribution.
 *
 * This is intentionally independent from the CLI package version: patch and
 * feature releases may change the product without changing Plugin contracts.
 */
export const EXTENSION_API_VERSION = '1.0.0'

/**
 * Manifests created before apiVersion existed are treated as Plugin API v1.
 * Removing this fallback would be a breaking change and requires API v2.
 */
export const LEGACY_EXTENSION_API_RANGE = '^1.0.0'

export type ExtensionApiNegotiation =
  | {
      compatible: true
      negotiatedVersion: string
      requiredRange: string
      declaration: 'explicit' | 'legacy'
    }
  | {
      compatible: false
      runtimeVersion: string
      requiredRange: string
      declaration: 'explicit'
    }

export function negotiateExtensionApiVersion(
  requestedRange: string | undefined,
): ExtensionApiNegotiation {
  const requiredRange = requestedRange ?? LEGACY_EXTENSION_API_RANGE
  const declaration = requestedRange === undefined ? 'legacy' : 'explicit'

  if (
    validRange(requiredRange) !== null &&
    satisfies(EXTENSION_API_VERSION, requiredRange, {
      includePrerelease: false,
    })
  ) {
    return {
      compatible: true,
      negotiatedVersion: EXTENSION_API_VERSION,
      requiredRange,
      declaration,
    }
  }

  // Invalid explicit ranges are rejected by PluginManifestSchema. Keeping this
  // branch fail-closed protects programmatic callers that construct a manifest
  // without parsing it first.
  return {
    compatible: false,
    runtimeVersion: EXTENSION_API_VERSION,
    requiredRange,
    declaration: 'explicit',
  }
}

