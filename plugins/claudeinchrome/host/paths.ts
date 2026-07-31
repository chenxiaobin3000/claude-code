import { readdirSync } from 'node:fs'
import { homedir, platform, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  CHROME_NATIVE_HOST_NAME,
  CLAUDEINCHROME_EXTENSION_ID,
} from '../protocol/index.js'

export const NATIVE_HOST_MANIFEST_NAME = `${CHROME_NATIVE_HOST_NAME}.json`
export const ALLOWED_EXTENSION_ORIGIN = `chrome-extension://${CLAUDEINCHROME_EXTENSION_ID}/`
const VALIDATION_SOCKET_SUFFIX_ENV =
  'CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX'

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

export function getSocketDirectory(): string {
  return join(tmpdir(), `claudeinchrome-${username()}`)
}

export function getNativeSocketPath(): string {
  const suffix = validationSocketSuffix()
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\claudeinchrome-${username()}${suffix}`
  }
  return join(getSocketDirectory(), `${process.pid}${suffix}.sock`)
}

export function getAvailableSocketPaths(): string[] {
  if (platform() === 'win32') return [getNativeSocketPath()]

  const paths: string[] = []
  try {
    for (const file of readdirSync(getSocketDirectory())) {
      if (file.endsWith('.sock')) paths.push(join(getSocketDirectory(), file))
    }
  } catch {
    // Native Host has not created its socket directory yet.
  }
  return paths
}

export function getManifestPath(): string {
  if (platform() === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return join(
      localAppData,
      'claude-code-best',
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
