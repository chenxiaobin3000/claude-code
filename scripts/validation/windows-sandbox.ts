#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assert } from './assertions.js'
import { buildWindowsSandboxConfiguration } from '../../src/utils/sandbox/windowsSandboxProtocol.js'

const root = resolve(import.meta.dir, '../..')
const source = (path: string): Promise<string> =>
  readFile(join(root, path), 'utf8')

const configuration = buildWindowsSandboxConfiguration(
  [
    {
      hostFolder: 'C:\\work\\project',
      sandboxFolder: 'C:\\claude\\workspace',
      readOnly: false,
    },
  ],
  'powershell.exe -NoProfile',
)
for (const boundary of [
  '<AudioInput>Disable</AudioInput>',
  '<ClipboardRedirection>Disable</ClipboardRedirection>',
  '<Networking>Disable</Networking>',
  '<VGpu>Disable</VGpu>',
]) {
  assert(configuration.includes(boundary), `Windows Sandbox configuration is missing ${boundary}`)
}

const shellSource = await source('src/utils/Shell.ts')
assert(
  shellSource.includes('getWindowsSandboxRuntimeLayout(shellType, provider)') &&
    shellSource.includes('runtime.runtimeRoots'),
  'Windows Sandbox must use the stable multi-shell runtime layout',
)
assert(
  shellSource.includes('SandboxManager.getSandboxUnavailableReason()') &&
    shellSource.includes('return createFailedCommand(unavailableReason)'),
  'unavailable Windows Sandbox policy must fail closed at the Shell execution boundary',
)

const sessionSource = await source('src/utils/sandbox/windowsSandboxSession.ts')
assert(
  sessionSource.includes('registerCleanup(closeWindowsSandboxSession)'),
  'Windows Sandbox session must participate in graceful shutdown cleanup',
)

const adapterSource = await source('src/utils/sandbox/sandbox-adapter.ts')
assert(
  adapterSource.includes('await closeWindowsSandboxSession()'),
  'SandboxManager.reset must close an active Windows Sandbox session',
)

const nativeHost = await source('native/windows-sandbox-host/src/sandbox_launch.cpp')
assert(
  nativeHost.includes('CREATE_SUSPENDED') &&
    nativeHost.includes('AssignProcessToJobObject') &&
    nativeHost.includes('ResumeThread'),
  'native AppContainer launch must join the Job Object before it begins executing',
)

console.log('Windows Sandbox validation passed.')
