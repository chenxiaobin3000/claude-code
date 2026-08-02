import { execFile } from 'node:child_process'
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import { CHROME_NATIVE_HOST_NAME } from '../protocol/index.js'
import {
  ALLOWED_EXTENSION_ORIGIN,
  getManifestPath,
  getWindowsRegistryKey,
} from './paths.js'

const execFileAsync = promisify(execFile)

type NativeHostManifest = {
  name: string
  description: string
  path: string
  type: 'stdio'
  allowed_origins: string[]
}

export type DoctorResult = {
  ok: boolean
  manifestPath: string
  hostPath?: string
  checks: Array<{ name: string; ok: boolean; detail: string }>
}

export type RegistrationOptions = {
  manifestPath?: string
  updateSystemRegistration?: boolean
}

function registrationTarget(options: RegistrationOptions): {
  manifestPath: string
  updateSystemRegistration: boolean
} {
  return {
    manifestPath: options.manifestPath ?? getManifestPath(),
    updateSystemRegistration:
      options.updateSystemRegistration ?? options.manifestPath === undefined,
  }
}

async function resolveHostPath(hostPath: string): Promise<string> {
  const absolute = isAbsolute(hostPath) ? hostPath : resolve(hostPath)
  await access(absolute)
  const resolved = await realpath(absolute)
  if (!(await stat(resolved)).isFile()) {
    throw new Error(`Native Host path is not a file: ${resolved}`)
  }
  if (platform() !== 'win32') await chmod(resolved, 0o755)
  return resolved
}

function createManifest(hostPath: string): NativeHostManifest {
  return {
    name: CHROME_NATIVE_HOST_NAME,
    description: 'chrome local Native Messaging Host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [ALLOWED_EXTENSION_ORIGIN],
  }
}

async function writeManifest(
  manifestPath: string,
  manifest: NativeHostManifest,
): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true })
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  await rename(temporaryPath, manifestPath)
}

async function addWindowsRegistry(manifestPath: string): Promise<void> {
  await execFileAsync('reg.exe', [
    'add',
    getWindowsRegistryKey(),
    '/ve',
    '/t',
    'REG_SZ',
    '/d',
    manifestPath,
    '/f',
  ])
}

async function removeWindowsRegistry(): Promise<void> {
  await execFileAsync('reg.exe', [
    'delete',
    getWindowsRegistryKey(),
    '/f',
  ]).catch(error => {
    const code = (error as NodeJS.ErrnoException & { code?: number }).code
    if (code !== 1) throw error
  })
}

export async function registerNativeHost(
  hostPath: string,
  options: RegistrationOptions = {},
): Promise<string> {
  const resolvedHostPath = await resolveHostPath(hostPath)
  const { manifestPath, updateSystemRegistration } =
    registrationTarget(options)
  await writeManifest(manifestPath, createManifest(resolvedHostPath))
  if (platform() === 'win32' && updateSystemRegistration) {
    await addWindowsRegistry(manifestPath)
  }
  return manifestPath
}

export async function unregisterNativeHost(
  options: RegistrationOptions = {},
): Promise<void> {
  const { manifestPath, updateSystemRegistration } =
    registrationTarget(options)
  await rm(manifestPath, { force: true })
  if (platform() === 'win32' && updateSystemRegistration) {
    await removeWindowsRegistry()
  }
}

async function readManifest(
  manifestPath: string,
): Promise<NativeHostManifest | null> {
  try {
    const value = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (
      !value ||
      typeof value !== 'object' ||
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !('description' in value) ||
      typeof value.description !== 'string' ||
      !('path' in value) ||
      typeof value.path !== 'string' ||
      !('type' in value) ||
      value.type !== 'stdio' ||
      !('allowed_origins' in value) ||
      !Array.isArray(value.allowed_origins) ||
      !value.allowed_origins.every(origin => typeof origin === 'string')
    ) {
      return null
    }
    return value as NativeHostManifest
  } catch {
    return null
  }
}

async function windowsRegistryMatches(manifestPath: string): Promise<boolean> {
  if (platform() !== 'win32') return true
  try {
    const { stdout } = await execFileAsync('reg.exe', [
      'query',
      getWindowsRegistryKey(),
      '/ve',
    ])
    return stdout.toLowerCase().includes(manifestPath.toLowerCase())
  } catch {
    return false
  }
}

export async function doctorNativeHost(
  expectedHostPath?: string,
  options: RegistrationOptions = {},
): Promise<DoctorResult> {
  const { manifestPath, updateSystemRegistration } =
    registrationTarget(options)
  const manifest = await readManifest(manifestPath)
  const checks: DoctorResult['checks'] = []

  checks.push({
    name: 'manifest',
    ok: manifest !== null,
    detail: manifest ? manifestPath : `Missing ${manifestPath}`,
  })
  if (!manifest) return { ok: false, manifestPath, checks }

  const hostExists = await access(manifest.path)
    .then(() => true)
    .catch(() => false)
  checks.push({
    name: 'host executable',
    ok: hostExists,
    detail: manifest.path,
  })
  checks.push({
    name: 'host name',
    ok: manifest.name === CHROME_NATIVE_HOST_NAME,
    detail: manifest.name,
  })
  const originsMatch =
    manifest.allowed_origins.length === 1 &&
    manifest.allowed_origins[0] === ALLOWED_EXTENSION_ORIGIN
  checks.push({
    name: 'allowed extension',
    ok: originsMatch,
    detail: manifest.allowed_origins.join(', '),
  })
  const registryMatches =
    !updateSystemRegistration ||
    (await windowsRegistryMatches(manifestPath))
  checks.push({
    name: 'Chrome registration',
    ok: registryMatches,
    detail:
      platform() === 'win32'
        ? getWindowsRegistryKey()
        : 'NativeMessagingHosts manifest directory',
  })

  if (expectedHostPath) {
    const expected = await resolveHostPath(expectedHostPath).catch(() => null)
    const actual = await realpath(manifest.path).catch(() => manifest.path)
    checks.push({
      name: 'installed wrapper',
      ok: expected !== null && actual === expected,
      detail: `expected ${expected ?? expectedHostPath}; installed ${actual}`,
    })
  }

  return {
    ok: checks.every(check => check.ok),
    manifestPath,
    hostPath: manifest.path,
    checks,
  }
}
