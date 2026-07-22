#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { SandboxSettingsSchema } from '../../src/entrypoints/sandboxTypes.js'
import { convertToSandboxRuntimeConfig } from '../../src/utils/sandbox/sandbox-adapter.js'
import {
  getCredentialDenyReadPaths,
  getCredentialProtectionConfig,
  getCredentialSearchIgnorePatterns,
  isCredentialFilePath,
  isSecretEnvironmentVariable,
  scrubCredentialEnvironment,
  type CredentialProtectionConfig,
} from '../../src/utils/sandbox/credentials.js'
import type { SettingsJson } from '../../src/utils/settings/types.js'
import { assert, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const config: CredentialProtectionConfig = {
  enabled: true,
  additionalFilePatterns: [join(root, 'private', '**')],
  additionalEnvPatterns: ['COMPANY_*_TOKEN'],
}

const parsed = SandboxSettingsSchema().parse({
  enabled: true,
  credentials: {
    enabled: true,
    additionalFilePatterns: config.additionalFilePatterns,
    additionalEnvPatterns: config.additionalEnvPatterns,
  },
})
assertEqual(parsed?.credentials?.enabled, true, 'credentials schema enabled')
assert(
  !SandboxSettingsSchema().safeParse({
    credentials: { enabled: true, unknown: true },
  }).success,
  'credentials schema accepted an unknown field',
)

for (const path of [
  join(root, '.env'),
  join(root, '.env.production'),
  join(root, 'credentials.json'),
  join(root, 'service-account-prod.json'),
  join(root, 'server.pem'),
  join(homedir(), '.ssh', 'id_custom'),
  join(root, 'private', 'token.txt'),
]) {
  assert(isCredentialFilePath(path, config), `credential path was allowed: ${path}`)
}
for (const path of [
  join(root, '.env.example'),
  join(root, '.env.sample'),
  join(root, 'src', 'credentials.ts'),
  join(root, 'public-key.txt'),
]) {
  assert(!isCredentialFilePath(path, config), `ordinary path was blocked: ${path}`)
}
assert(
  !isCredentialFilePath(join(root, '.env'), { ...config, enabled: false }),
  'disabled credential protection blocked a path',
)

for (const name of [
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'DATABASE_PASSWORD',
  'company_deploy_token',
]) {
  assert(
    isSecretEnvironmentVariable(name, config),
    `secret environment variable was allowed: ${name}`,
  )
}
assert(
  !isSecretEnvironmentVariable('PATH', config),
  'ordinary environment variable was blocked',
)

const parentEnvironment = {
  PATH: 'safe-path',
  OPENAI_API_KEY: 'never-log-this-value',
  COMPANY_DEPLOY_TOKEN: 'never-log-this-either',
}
const childEnvironment = scrubCredentialEnvironment(parentEnvironment, config)
assertEqual(childEnvironment.PATH, 'safe-path', 'safe child environment')
assertEqual(childEnvironment.OPENAI_API_KEY, undefined, 'API key scrub')
assertEqual(childEnvironment.COMPANY_DEPLOY_TOKEN, undefined, 'custom scrub')
assertEqual(
  parentEnvironment.OPENAI_API_KEY,
  'never-log-this-value',
  'parent environment was mutated',
)

const settings = {
  sandbox: {
    enabled: true,
    filesystem: { allowRead: [homedir()] },
    credentials: {
      enabled: true,
      additionalFilePatterns: config.additionalFilePatterns,
      additionalEnvPatterns: config.additionalEnvPatterns,
    },
  },
} as SettingsJson
const effective = getCredentialProtectionConfig(settings)
assert(effective.enabled, 'settings did not enable credential protection')
const runtime = convertToSandboxRuntimeConfig(settings)
const denyRead = runtime.filesystem?.denyRead ?? []
for (const protectedPath of getCredentialDenyReadPaths(effective)) {
  assert(denyRead.includes(protectedPath), `runtime denyRead missing ${protectedPath}`)
}
assertEqual(
  runtime.filesystem?.allowRead?.length ?? 0,
  0,
  'allowRead remained enabled during credential protection',
)
assert(
  getCredentialSearchIgnorePatterns(effective).includes('**/.env'),
  'search ignore patterns do not hide .env',
)

const filesystemSource = await readFile(
  join(root, 'src', 'utils', 'permissions', 'filesystem.ts'),
  'utf8',
)
const credentialCheck = filesystemSource.indexOf('isCredentialFilePath(pathToCheck)')
const ordinaryDenyCheck = filesystemSource.indexOf(
  '// 3. Check for READ-SPECIFIC deny rules first',
  credentialCheck,
)
assert(credentialCheck >= 0, 'read permission path lacks credential check')
assert(
  ordinaryDenyCheck > credentialCheck,
  'credential hard deny does not precede ordinary rules',
)

for (const relative of [
  'packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts',
  'packages/builtin-tools/src/tools/GlobTool/GlobTool.ts',
  'packages/builtin-tools/src/tools/GrepTool/GrepTool.ts',
]) {
  const source = await readFile(join(root, relative), 'utf8')
  assert(
    source.includes('isCredentialFilePath'),
    `${relative} lacks pre-I/O credential validation`,
  )
}
for (const relative of [
  'packages/builtin-tools/src/tools/BashTool/BashTool.tsx',
  'packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.tsx',
]) {
  const source = await readFile(join(root, relative), 'utf8')
  assert(
    source.includes('protectCredentials: true'),
    `${relative} does not request credential isolation`,
  )
}
const shellSource = await readFile(join(root, 'src', 'utils', 'Shell.ts'), 'utf8')
assert(
  /scrubCredentialEnvironment\([\s\S]*\.\.\.envOverrides/.test(shellSource),
  'Shell environment is not scrubbed after provider overrides',
)
assert(
  shellSource.includes('Credential protection requires this command'),
  'unsandboxed Shell credential fail-closed check is missing',
)

console.log('[sandbox-credentials] PASS')
