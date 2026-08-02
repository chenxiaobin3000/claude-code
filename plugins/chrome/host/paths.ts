import { readFileSync, readdirSync } from 'node:fs'
import { homedir, platform, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { ChromeSocketEndpoint } from '../protocol/index.js'
import {
  CHROME_NATIVE_HOST_NAME,
  CLAUDEINCHROME_EXTENSION_ID,
} from '../protocol/index.js'

export const NATIVE_HOST_MANIFEST_NAME = `${CHROME_NATIVE_HOST_NAME}.json`
export const ALLOWED_EXTENSION_ORIGIN = `chrome-extension://${CLAUDEINCHROME_EXTENSION_ID}/`
export const CHROME_SOCKET_HOST = '127.0.0.1' as const
const VALIDATION_SOCKET_SUFFIX_ENV = 'CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX'

function username(): string {
  let value = 'default'
  try {
    value = userInfo().username || value
  } catch {
    value = process.env.USER || process.env.USERNAME || value
  }
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function validationSocketSuffix(): string {
  const value = process.env[VALIDATION_SOCKET_SUFFIX_ENV]?.trim()
  if (!value) return ''
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error(
      `${VALIDATION_SOCKET_SUFFIX_ENV} must contain only ASCII letters, numbers, underscores, or hyphens`,
    )
  }
  return `-${value}`
}

/** Per-user discovery directory shared by all local Chrome profile instances. */
export function getSocketDirectory(): string {
  return join(
    tmpdir(),
    `claudeinchrome-${username()}${validationSocketSuffix()}`,
  )
}

export function getEndpointDescriptorPath(instanceId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId)) {
    throw new Error('Invalid claudeinchrome instance ID')
  }
  return join(getSocketDirectory(), `${instanceId}.json`)
}

export function isChromeSocketEndpoint(
  value: unknown,
): value is ChromeSocketEndpoint {
  if (!value || typeof value !== 'object') return false
  const endpoint = value as Partial<ChromeSocketEndpoint>
  return (
    typeof endpoint.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(endpoint.id) &&
    endpoint.host === CHROME_SOCKET_HOST &&
    Number.isInteger(endpoint.port) &&
    Number(endpoint.port) >= 1 &&
    Number(endpoint.port) <= 65535 &&
    typeof endpoint.token === 'string' &&
    /^[a-f0-9]{64}$/.test(endpoint.token) &&
    Number.isInteger(endpoint.pid) &&
    Number(endpoint.pid) > 0 &&
    typeof endpoint.profileId === 'string' &&
    /^[a-f0-9-]{36}$/.test(endpoint.profileId) &&
    typeof endpoint.profileName === 'string' &&
    endpoint.profileName.length >= 1 &&
    endpoint.profileName.length <= 64 &&
    ![...endpoint.profileName].some(character => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  )
}

/** Discover every live-profile Native Host endpoint without exposing secrets in logs. */
export function getAvailableSocketEndpoints(): ChromeSocketEndpoint[] {
  const endpoints: ChromeSocketEndpoint[] = []
  try {
    for (const file of readdirSync(getSocketDirectory())) {
      if (!file.endsWith('.json')) continue
      try {
        const value: unknown = JSON.parse(
          readFileSync(join(getSocketDirectory(), file), 'utf8'),
        )
        if (isChromeSocketEndpoint(value)) endpoints.push(value)
      } catch {
        // Ignore incomplete or stale discovery records. The owning Host cleans them.
      }
    }
  } catch {
    // No Native Host has published an endpoint yet.
  }
  return endpoints
}

export function getManifestPath(): string {
  if (platform() === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return join(
      localAppData,
      'claude-code',
      'claudeinchrome',
      NATIVE_HOST_MANIFEST_NAME,
    )
  }
  if (platform() === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      NATIVE_HOST_MANIFEST_NAME,
    )
  }
  return join(
    homedir(),
    '.config',
    'google-chrome',
    'NativeMessagingHosts',
    NATIVE_HOST_MANIFEST_NAME,
  )
}

export function getWindowsRegistryKey(): string {
  return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${CHROME_NATIVE_HOST_NAME}`
}
