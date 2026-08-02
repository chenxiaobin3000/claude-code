#!/usr/bin/env bun

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  doctorNativeHost,
  registerNativeHost,
  unregisterNativeHost,
} from '../../plugins/chrome/host/registration.js'
import {
  CHROME_SOCKET_HOST,
  getAvailableSocketEndpoints,
  getEndpointDescriptorPath,
  getSocketDirectory,
} from '../../plugins/chrome/host/paths.js'
import { ChromeNativeHost } from '../../plugins/chrome/host/nativeHost.js'
import {
  CHROME_NATIVE_HOST_NAME,
  CLAUDEINCHROME_EXTENSION_ID,
} from '../../plugins/chrome/protocol/index.js'

const root = resolve(import.meta.dir, '../..')
const hostRoot = join(root, 'plugins', 'chrome', 'host')
const sources = await Promise.all(
  [
    'entry.ts',
    'mcpServer.ts',
    'nativeHost.ts',
    'paths.ts',
    'registration.ts',
  ].map(file => readFile(join(hostRoot, file), 'utf8')),
)
const combinedSource = sources.join('\n')
if (!sources[2]!.includes('listen({ host: CHROME_SOCKET_HOST, port: 0 }')) {
  throw new Error(
    '[claudeinchrome-host] Native Host must use a dynamic loopback TCP socket',
  )
}
for (const forbiddenTransport of [
  '\\\\.\\pipe\\',
  '.sock`',
  'listen({ path:',
]) {
  if (combinedSource.includes(forbiddenTransport)) {
    throw new Error(
      `[claudeinchrome-host] platform-specific transport remains: ${forbiddenTransport}`,
    )
  }
}
for (const forbidden of [
  'sideQuery',
  'USER_TYPE',
  'CLAUDE_CODE_ENABLE_CFC',
  'getGlobalConfig',
  'src/utils',
  '@anthropic-ai/sdk',
]) {
  if (combinedSource.includes(forbidden)) {
    throw new Error(
      `[claudeinchrome-host] plugin Host retained forbidden main/internal dependency: ${forbidden}`,
    )
  }
}
for (const command of ['mcp', 'register', 'unregister', 'doctor']) {
  if (!sources[0]!.includes(`command === '${command}'`)) {
    throw new Error(`[claudeinchrome-host] missing Host command: ${command}`)
  }
}
for (const marker of [
  'args[0] !== ALLOWED_EXTENSION_ORIGIN',
  '/^--parent-window=\\d+$/.test(argument)',
  'if (isChromeNativeInvocation(args))',
]) {
  if (!sources[0]!.includes(marker)) {
    throw new Error(
      `[claudeinchrome-host] Chrome Native Messaging launch boundary is missing: ${marker}`,
    )
  }
}
for (const marker of [
  'if (this.mcpClients.size === 0)',
  'Dropping oversized Chrome notification',
  'request.auth_token !== this.endpoint?.token',
  'Chrome tool request exceeds the $' +
    '{MAX_CHROME_BRIDGE_MESSAGE_BYTES}-byte bridge limit.',
]) {
  if (!combinedSource.includes(marker)) {
    throw new Error(
      `[claudeinchrome-host] missing lifecycle/message boundary: ${marker}`,
    )
  }
}

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), 'claudeinchrome-host-validation-'),
)
const fakeHost = join(
  temporaryDirectory,
  process.platform === 'win32' ? 'host.exe' : 'host',
)
const otherHost = join(
  temporaryDirectory,
  process.platform === 'win32' ? 'other.exe' : 'other',
)
const manifestPath = join(temporaryDirectory, 'native-host.json')
const options = {
  manifestPath,
  updateSystemRegistration: false,
}

const originalValidationSuffix =
  process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX
delete process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX
const productionSocketDirectory = getSocketDirectory()
process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX = `verify_${process.pid}`
const validationSocketDirectory = getSocketDirectory()
if (
  validationSocketDirectory === productionSocketDirectory ||
  !validationSocketDirectory.includes(`verify_${process.pid}`)
) {
  throw new Error(
    '[claudeinchrome-host] validation socket suffix did not isolate the endpoint',
  )
}
process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX = '../escape'
let rejectedUnsafeSuffix = false
try {
  getSocketDirectory()
} catch {
  rejectedUnsafeSuffix = true
}
if (!rejectedUnsafeSuffix) {
  throw new Error(
    '[claudeinchrome-host] unsafe validation socket suffix was accepted',
  )
}

process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX = `verify_${process.pid}`
try {
  await mkdir(getSocketDirectory(), { recursive: true })
  const endpoint = {
    id: `validation_${process.pid}`,
    host: CHROME_SOCKET_HOST,
    port: 43123,
    token: 'a'.repeat(64),
    pid: process.pid,
    profileId: '00000000-0000-4000-8000-000000000001',
    profileName: 'Validation Profile',
  } as const
  await writeFile(
    getEndpointDescriptorPath(endpoint.id),
    JSON.stringify(endpoint),
    'utf8',
  )
  const discovered = getAvailableSocketEndpoints()
  if (
    discovered.length !== 1 ||
    discovered[0]?.id !== endpoint.id ||
    discovered[0]?.token !== endpoint.token
  ) {
    throw new Error(
      '[claudeinchrome-host] loopback TCP endpoint discovery failed',
    )
  }
} finally {
  await rm(getSocketDirectory(), { recursive: true, force: true })
  if (originalValidationSuffix === undefined) {
    delete process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX
  } else {
    process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX =
      originalValidationSuffix
  }
}

process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX = `runtime_${process.pid}`
const runtimeHost = new ChromeNativeHost()
let stoppedEndpointCount = -1
try {
  await runtimeHost.start()
  await runtimeHost.handleMessage(
    JSON.stringify({
      type: 'profile_hello',
      profile_id: '00000000-0000-4000-8000-000000000002',
      profile_name: 'Runtime Validation',
    }),
  )
  const runtimeEndpoints = getAvailableSocketEndpoints()
  if (
    runtimeEndpoints.length !== 1 ||
    runtimeEndpoints[0]?.host !== CHROME_SOCKET_HOST ||
    runtimeEndpoints[0]?.pid !== process.pid ||
    runtimeEndpoints[0]?.profileName !== 'Runtime Validation'
  ) {
    throw new Error(
      '[claudeinchrome-host] live loopback TCP endpoint was not published',
    )
  }
} finally {
  await runtimeHost.stop()
  stoppedEndpointCount = getAvailableSocketEndpoints().length
  await rm(getSocketDirectory(), { recursive: true, force: true })
  if (originalValidationSuffix === undefined) {
    delete process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX
  } else {
    process.env.CLAUDEINCHROME_VALIDATION_SOCKET_SUFFIX =
      originalValidationSuffix
  }
}
if (stoppedEndpointCount !== 0) {
  throw new Error(
    '[claudeinchrome-host] stopped Host left a TCP endpoint record',
  )
}

try {
  await writeFile(fakeHost, 'host', 'utf8')
  await writeFile(otherHost, 'other', 'utf8')

  await registerNativeHost(fakeHost, options)
  await registerNativeHost(fakeHost, options)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    name: string
    path: string
    allowed_origins: string[]
  }
  if (
    manifest.name !== CHROME_NATIVE_HOST_NAME ||
    manifest.allowed_origins.length !== 1 ||
    manifest.allowed_origins[0] !==
      `chrome-extension://${CLAUDEINCHROME_EXTENSION_ID}/`
  ) {
    throw new Error('[claudeinchrome-host] unsafe Native Host manifest')
  }

  const healthy = await doctorNativeHost(fakeHost, options)
  if (!healthy.ok) {
    throw new Error(
      `[claudeinchrome-host] registered Host failed doctor: ${JSON.stringify(healthy.checks)}`,
    )
  }
  const mismatch = await doctorNativeHost(otherHost, options)
  if (mismatch.ok) {
    throw new Error(
      '[claudeinchrome-host] doctor accepted a mismatched installed wrapper',
    )
  }

  await writeFile(
    manifestPath,
    JSON.stringify({
      name: CHROME_NATIVE_HOST_NAME,
      path: fakeHost,
      type: 'stdio',
      allowed_origins: 'not-an-array',
    }),
    'utf8',
  )
  const malformed = await doctorNativeHost(fakeHost, options)
  if (malformed.ok) {
    throw new Error('[claudeinchrome-host] doctor accepted malformed manifest')
  }

  await registerNativeHost(fakeHost, options)
  await unregisterNativeHost(options)
  const removed = await access(manifestPath)
    .then(() => false)
    .catch(() => true)
  if (!removed) {
    throw new Error('[claudeinchrome-host] unregister left its manifest behind')
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

console.log('[claudeinchrome-host] PASS')
