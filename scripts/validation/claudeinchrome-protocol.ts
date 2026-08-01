#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BROWSER_TOOLS } from '../../plugins/claudeinchrome/mcp/browserTools.js'
import {
  CHROME_NATIVE_HOST_NAME,
  CHROME_TOOL_TIMEOUT_MS,
  IMPLEMENTED_CHROME_TOOL_NAMES,
  MAX_CHROME_BRIDGE_MESSAGE_BYTES,
} from '../../plugins/claudeinchrome/protocol/index.js'

const root = resolve(import.meta.dir, '../..')
const extensionSource = await readFile(
  join(root, 'plugins', 'claudeinchrome', 'chrome-extension', 'background.js'),
  'utf8',
)
const promptSource = await readFile(
  join(
    root,
    'plugins',
    'claudeinchrome',
    'skills',
    'claude-in-chrome',
    'SKILL.md',
  ),
  'utf8',
)
const nativeHostSource = await readFile(
  join(root, 'plugins', 'claudeinchrome', 'host', 'nativeHost.ts'),
  'utf8',
)
const socketClientSource = await readFile(
  join(root, 'plugins', 'claudeinchrome', 'mcp', 'mcpSocketClient.ts'),
  'utf8',
)

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function assertSame(label: string, actual: string[], expected: string[]): void {
  const actualSorted = sorted(actual)
  const expectedSorted = sorted(expected)
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `[claudeinchrome-protocol] ${label} mismatch\nexpected: ${expectedSorted.join(', ')}\nactual: ${actualSorted.join(', ')}`,
    )
  }
}

const executeToolStart = extensionSource.indexOf('async function executeTool(')
const executeComputerStart = extensionSource.indexOf(
  'async function executeComputer(',
)
if (executeToolStart < 0 || executeComputerStart <= executeToolStart) {
  throw new Error(
    '[claudeinchrome-protocol] cannot locate extension tool dispatcher',
  )
}
const executeToolSource = extensionSource.slice(
  executeToolStart,
  executeComputerStart,
)
const extensionTools = [...executeToolSource.matchAll(/case '([^']+)'/g)].map(
  match => match[1]!,
)
assertSame('extension dispatcher', extensionTools, [
  ...IMPLEMENTED_CHROME_TOOL_NAMES,
])

const advertisedTools = BROWSER_TOOLS.map(tool => tool.name)
assertSame('MCP advertised tools', advertisedTools, [
  ...IMPLEMENTED_CHROME_TOOL_NAMES,
])
for (const tool of BROWSER_TOOLS) {
  const profileId = tool.inputSchema.properties.profileId as
    | { type?: string }
    | undefined
  if (profileId?.type !== 'string') {
    throw new Error(
      `[claudeinchrome-protocol] ${tool.name} does not accept profileId`,
    )
  }
}

const computerTool = BROWSER_TOOLS.find(tool => tool.name === 'computer')
const computerActions = (
  computerTool?.inputSchema.properties.action as
    | { enum?: unknown[] }
    | undefined
)?.enum
if (!computerActions || computerActions.includes('zoom')) {
  throw new Error(
    '[claudeinchrome-protocol] computer schema advertises unsupported zoom',
  )
}

const unsupportedTools = [
  'gif_creator',
  'upload_image',
  'read_console_messages',
  'read_network_requests',
  'shortcuts_list',
  'shortcuts_execute',
]
for (const name of unsupportedTools) {
  if (advertisedTools.includes(name)) {
    throw new Error(
      `[claudeinchrome-protocol] unsupported MCP tool advertised: ${name}`,
    )
  }
  if (promptSource.includes(`__${name}`)) {
    throw new Error(
      `[claudeinchrome-protocol] prompt advertises unsupported tool: ${name}`,
    )
  }
}

const nativeHostLiteral = extensionSource.match(
  /const NATIVE_HOST = '([^']+)'/,
)?.[1]
if (nativeHostLiteral !== CHROME_NATIVE_HOST_NAME) {
  throw new Error(
    `[claudeinchrome-protocol] native host mismatch: ${nativeHostLiteral}`,
  )
}
if (MAX_CHROME_BRIDGE_MESSAGE_BYTES !== 1024 * 1024) {
  throw new Error('[claudeinchrome-protocol] message limit changed')
}
if (CHROME_TOOL_TIMEOUT_MS !== 30_000) {
  throw new Error('[claudeinchrome-protocol] tool timeout changed')
}

for (const [label, source, markers] of [
  [
    'extension',
    extensionSource,
    [
      'message.request_id',
      'request_id: requestId',
      'chrome.storage.local',
      "type: 'profile_hello'",
      "type === 'set_profile_name'",
    ],
  ],
  [
    'native host',
    nativeHostSource,
    [
      'requestOwners',
      'request.request_id',
      'message.request_id',
      "case 'profile_hello'",
      'await this.publishEndpoint()',
    ],
  ],
  [
    'MCP socket client',
    socketClientSource,
    ['pendingResponses', 'request_id: randomUUID()'],
  ],
] as const) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(
        `[claudeinchrome-protocol] ${label} does not enforce ${marker}`,
      )
    }
  }
}

console.log('[claudeinchrome-protocol] PASS')
