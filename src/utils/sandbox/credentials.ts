import { homedir } from 'node:os'
import { basename, join, normalize, resolve, sep } from 'node:path'
import picomatch from 'picomatch'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { expandPath } from '../path.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

export interface CredentialProtectionConfig {
  enabled: boolean
  additionalFilePatterns: string[]
  additionalEnvPatterns: string[]
}

const SECRET_ENV_SUFFIXES = [
  '_API_KEY',
  '_ACCESS_KEY',
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_PRIVATE_KEY',
  '_SIGNING_KEY',
  '_CREDENTIALS',
]

const ENV_TEMPLATE_NAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
])

const GLOBAL_CREDENTIAL_BASENAMES = new Set([
  '.netrc',
  '.git-credentials',
  '.npmrc',
  '.pypirc',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
])

const DEFAULT_SEARCH_IGNORE_PATTERNS = [
  '**/.env',
  '**/.env.local',
  '**/.env.development',
  '**/.env.production',
  '**/.env.test',
  '**/.ssh/**',
  '**/.aws/credentials',
  '**/.azure/**',
  '**/.config/gcloud/**',
  '**/.docker/config.json',
  '**/.kube/config',
  '**/.config/gh/hosts.yml',
  '**/.netrc',
  '**/.git-credentials',
  '**/.npmrc',
  '**/.pypirc',
  '**/credentials.json',
  '**/service-account*.json',
  '**/id_rsa',
  '**/id_ed25519',
  '**/*.pem',
  '**/*.key',
] as const

function normalizeForMatch(path: string): string {
  return normalize(path).split(sep).join('/')
}

function settingsConfig(settings: SettingsJson): CredentialProtectionConfig {
  const credentials = settings.sandbox?.credentials
  return {
    enabled: credentials?.enabled === true,
    additionalFilePatterns: credentials?.additionalFilePatterns ?? [],
    additionalEnvPatterns: credentials?.additionalEnvPatterns ?? [],
  }
}

export function getCredentialProtectionConfig(
  settings?: SettingsJson,
): CredentialProtectionConfig {
  const merged = settings ?? getSettings_DEPRECATED()
  const config = settingsConfig(merged)
  if (!settings) {
    const policy = getSettingsForSource('policySettings')
    if (policy?.sandbox?.credentials?.enabled === true) config.enabled = true
  }
  return config
}

export function isCredentialProtectionEnabled(
  settings?: SettingsJson,
): boolean {
  return getCredentialProtectionConfig(settings).enabled
}

function matchesAdditionalFilePattern(
  path: string,
  patterns: readonly string[],
): boolean {
  const normalizedPath = normalizeForMatch(resolve(path))
  return patterns.some(pattern => {
    const expanded = normalizeForMatch(expandPath(pattern, getOriginalCwd()))
    return picomatch.isMatch(normalizedPath, expanded, {
      dot: true,
      nocase: process.platform === 'win32',
    })
  })
}

export function isCredentialFilePath(
  path: string,
  config = getCredentialProtectionConfig(),
): boolean {
  if (!config.enabled) return false
  const absolute = resolve(expandPath(path))
  const normalized = normalizeForMatch(absolute).toLowerCase()
  const name = basename(absolute).toLowerCase()

  if (name === '.env' || (name.startsWith('.env.') && !ENV_TEMPLATE_NAMES.has(name))) {
    return true
  }
  if (GLOBAL_CREDENTIAL_BASENAMES.has(name)) return true
  if (name.startsWith('service-account') && name.endsWith('.json')) return true
  if (name.endsWith('.pem') || name.endsWith('.key')) return true

  const home = normalizeForMatch(homedir()).toLowerCase()
  const homeProtected = [
    '.ssh/',
    '.azure/',
    '.config/gcloud/',
  ].some(part => normalized.startsWith(`${home}/${part}`))
  if (homeProtected) return true

  const fixedHomeFiles = [
    '.aws/credentials',
    '.docker/config.json',
    '.kube/config',
    '.config/gh/hosts.yml',
  ]
  if (fixedHomeFiles.some(part => normalized === `${home}/${part}`)) return true

  return matchesAdditionalFilePattern(absolute, config.additionalFilePatterns)
}

export function getCredentialSearchIgnorePatterns(
  config = getCredentialProtectionConfig(),
): string[] {
  if (!config.enabled) return []
  return [
    ...DEFAULT_SEARCH_IGNORE_PATTERNS,
    ...config.additionalFilePatterns.map(pattern =>
      normalizeForMatch(expandPath(pattern, getOriginalCwd())),
    ),
  ]
}

export function getCredentialDenyReadPaths(
  config = getCredentialProtectionConfig(),
): string[] {
  if (!config.enabled) return []
  const home = homedir()
  const cwd = getOriginalCwd()
  return [
    join(home, '.ssh'),
    join(home, '.aws', 'credentials'),
    join(home, '.azure'),
    join(home, '.config', 'gcloud'),
    join(home, '.docker', 'config.json'),
    join(home, '.kube', 'config'),
    join(home, '.config', 'gh', 'hosts.yml'),
    join(home, '.netrc'),
    join(home, '.git-credentials'),
    join(home, '.npmrc'),
    join(home, '.pypirc'),
    join(cwd, '.env'),
    join(cwd, '.env.local'),
    join(cwd, '.env.development'),
    join(cwd, '.env.production'),
    join(cwd, '.env.test'),
    join(cwd, '.env.*'),
    join(cwd, '**', 'credentials.json'),
    join(cwd, '**', 'service-account*.json'),
    join(cwd, '**', '*.pem'),
    join(cwd, '**', '*.key'),
    ...config.additionalFilePatterns.map(pattern => expandPath(pattern, cwd)),
  ]
}

export function isSecretEnvironmentVariable(
  name: string,
  config = getCredentialProtectionConfig(),
): boolean {
  if (!config.enabled) return false
  const upper = name.toUpperCase()
  if (SECRET_ENV_SUFFIXES.some(suffix => upper.endsWith(suffix))) return true
  return config.additionalEnvPatterns.some(pattern =>
    picomatch.isMatch(name, pattern, { nocase: true }),
  )
}

export function scrubCredentialEnvironment(
  env: NodeJS.ProcessEnv,
  config = getCredentialProtectionConfig(),
): NodeJS.ProcessEnv {
  if (!config.enabled) return env
  const scrubbed = { ...env }
  for (const name of Object.keys(scrubbed)) {
    if (isSecretEnvironmentVariable(name, config)) delete scrubbed[name]
  }
  return scrubbed
}
