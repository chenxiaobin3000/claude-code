import { randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  getUserSettingsEnvValue,
  getUserSettingsPath,
  readUserSettings,
  type UserSettings,
} from '../../userSettingsEnv.js'

export const OPENAI_PROXY_HOST = '127.0.0.1' as const
export const OPENAI_PROXY_DEFAULT_PORT = 48_481
export const OPENAI_PROXY_LOCAL_TOKEN_ENV = 'OPENAI_PROXY_LOCAL_TOKEN' as const
export const OPENAI_PROXY_URL_ENV = 'OPENAI_PROXY_URL' as const
const MIN_LOCAL_TOKEN_LENGTH = 32
const MIN_CONFIGURABLE_PORT = 1_024
const MAX_CONFIGURABLE_PORT = 65_535
const MAX_USER_SETTINGS_BYTES = 1024 * 1024
const SETTINGS_LOCK_TIMEOUT_MS = 10_000
const SETTINGS_LOCK_STALE_MS = 30_000

export interface OpenAIProxyUserConfig {
  token: string
  port: number
  settingsPath: string
  generatedToken: boolean
}

interface EnsureUserConfigOptions {
  env?: NodeJS.ProcessEnv
  settingsPath?: string
  generateToken?: () => string
}

function validLocalToken(value: string | undefined): value is string {
  return Boolean(value && value.trim().length >= MIN_LOCAL_TOKEN_LENGTH)
}

function validatePort(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < MIN_CONFIGURABLE_PORT ||
    Number(value) > MAX_CONFIGURABLE_PORT
  ) {
    throw new Error(
      `openaiProxy.port must be an integer from ${MIN_CONFIGURABLE_PORT} through ${MAX_CONFIGURABLE_PORT}.`,
    )
  }
  return Number(value)
}

function settingsPort(settings: UserSettings): number {
  const value = settings.openaiProxy?.port
  return value === undefined ? OPENAI_PROXY_DEFAULT_PORT : validatePort(value)
}

export function resolveOpenAIProxyPort(
  readSettings: () => { settings: UserSettings } = readUserSettings,
): number {
  try {
    return settingsPort(readSettings().settings)
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist')) {
      return OPENAI_PROXY_DEFAULT_PORT
    }
    throw error
  }
}

export function getOpenAIProxyBaseUrl(port = resolveOpenAIProxyPort()): string {
  return `http://${OPENAI_PROXY_HOST}:${port}`
}

export function resolveLocalToken(
  env: NodeJS.ProcessEnv = process.env,
  readUserEnv: (name: string) => string | undefined = getUserSettingsEnvValue,
): string {
  const processToken = env[OPENAI_PROXY_LOCAL_TOKEN_ENV]?.trim()
  if (processToken !== undefined && !validLocalToken(processToken)) {
    throw new Error(
      `${OPENAI_PROXY_LOCAL_TOKEN_ENV} must contain at least ${MIN_LOCAL_TOKEN_LENGTH} non-whitespace characters.`,
    )
  }
  if (processToken) return processToken
  let settingsToken: string | undefined
  try {
    settingsToken = readUserEnv(OPENAI_PROXY_LOCAL_TOKEN_ENV)?.trim()
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('does not exist'))) {
      throw error
    }
  }
  if (!validLocalToken(settingsToken)) {
    throw new Error(
      `${OPENAI_PROXY_LOCAL_TOKEN_ENV} must contain at least ${MIN_LOCAL_TOKEN_LENGTH} non-whitespace characters in the process or user settings.json env. Run openai-proxy-host login to create it.`,
    )
  }
  return settingsToken
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(
        `Refusing symbolic link in openai-proxy settings path: ${path}`,
      )
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function readSettingsForUpdate(path: string): Promise<{
  raw: string | undefined
  settings: UserSettings
}> {
  await rejectSymlink(path)
  try {
    const raw = await readFile(path, 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_USER_SETTINGS_BYTES) {
      throw new Error('User settings.json exceeded 1 MiB.')
    }
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('User settings.json must contain a JSON object.')
    }
    return { raw, settings: value as UserSettings }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { raw: undefined, settings: {} }
    }
    throw error
  }
}

async function acquireSettingsLock(path: string): Promise<{
  close(): Promise<void>
}> {
  const deadline = Date.now() + SETTINGS_LOCK_TIMEOUT_MS
  while (true) {
    try {
      const handle = await open(path, 'wx', 0o600)
      if (process.platform !== 'win32') await chmod(path, 0o600)
      return {
        async close(): Promise<void> {
          await handle.close()
          await rm(path, { force: true })
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const state = await lstat(path).catch(() => undefined)
      if (state && Date.now() - state.mtimeMs > SETTINGS_LOCK_STALE_MS) {
        await rm(path, { force: true })
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting to update user settings.json.')
      }
      await Bun.sleep(50)
    }
  }
}

async function writeSettingsAtomic(
  path: string,
  settings: UserSettings,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `.settings-openai-proxy-${process.pid}-${randomUUID()}.tmp`,
  )
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    if (process.platform !== 'win32') await chmod(temporary, 0o600)
    await rename(temporary, path)
    if (process.platform !== 'win32') await chmod(path, 0o600)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function ensureOpenAIProxyUserConfig(
  options: EnsureUserConfigOptions = {},
): Promise<OpenAIProxyUserConfig> {
  const env = options.env ?? process.env
  const settingsPath = options.settingsPath ?? getUserSettingsPath()
  const settingsDirectory = dirname(settingsPath)
  await rejectSymlink(dirname(settingsDirectory))
  await rejectSymlink(settingsDirectory)
  await mkdir(settingsDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(settingsDirectory, 0o700)
  const lock = await acquireSettingsLock(
    join(settingsDirectory, '.openai-proxy-settings.lock'),
  )
  try {
    const { settings } = await readSettingsForUpdate(settingsPath)
    if (
      settings.env !== undefined &&
      (typeof settings.env !== 'object' || Array.isArray(settings.env))
    ) {
      throw new Error('User settings.json env must be an object.')
    }
    if (
      settings.openaiProxy !== undefined &&
      (typeof settings.openaiProxy !== 'object' ||
        Array.isArray(settings.openaiProxy))
    ) {
      throw new Error('User settings.json openaiProxy must be an object.')
    }

    const configuredToken =
      typeof settings.env?.[OPENAI_PROXY_LOCAL_TOKEN_ENV] === 'string'
        ? settings.env[OPENAI_PROXY_LOCAL_TOKEN_ENV].trim()
        : undefined
    const processToken = env[OPENAI_PROXY_LOCAL_TOKEN_ENV]?.trim()
    if (processToken !== undefined && !validLocalToken(processToken)) {
      throw new Error(
        `${OPENAI_PROXY_LOCAL_TOKEN_ENV} must contain at least ${MIN_LOCAL_TOKEN_LENGTH} non-whitespace characters.`,
      )
    }
    if (configuredToken !== undefined && !validLocalToken(configuredToken)) {
      throw new Error(
        `User settings.json env.${OPENAI_PROXY_LOCAL_TOKEN_ENV} must contain at least ${MIN_LOCAL_TOKEN_LENGTH} non-whitespace characters.`,
      )
    }
    if (processToken && configuredToken && processToken !== configuredToken) {
      throw new Error(
        `${OPENAI_PROXY_LOCAL_TOKEN_ENV} differs between the process and user settings.json. Clear the process value or make both values match.`,
      )
    }

    const generatedToken = !processToken && !configuredToken
    const token =
      processToken ||
      configuredToken ||
      (options.generateToken ?? (() => randomBytes(32).toString('hex')))()
    if (!validLocalToken(token)) {
      throw new Error('Generated openai-proxy local token was invalid.')
    }
    const port = settingsPort(settings)
    settings.env = {
      ...(settings.env ?? {}),
      [OPENAI_PROXY_LOCAL_TOKEN_ENV]: token,
    }
    settings.openaiProxy = {
      ...(settings.openaiProxy ?? {}),
      port,
    }
    await writeSettingsAtomic(settingsPath, settings)
    env[OPENAI_PROXY_LOCAL_TOKEN_ENV] = token
    return { token, port, settingsPath, generatedToken }
  } finally {
    await lock.close()
  }
}

export function resolveOpenAIProxyUrl(
  env: NodeJS.ProcessEnv = process.env,
  readUserEnv: (name: string) => string | undefined = getUserSettingsEnvValue,
): string | undefined {
  const processValue = env[OPENAI_PROXY_URL_ENV]?.trim()
  if (processValue) return processValue
  try {
    return readUserEnv(OPENAI_PROXY_URL_ENV)?.trim() || undefined
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist')) {
      return undefined
    }
    throw new Error(
      `Cannot resolve ${OPENAI_PROXY_URL_ENV} from user settings.json env.`,
    )
  }
}
