#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BROWSER_TOOLS } from '../../plugins/chrome/mcp/browserTools.js'
import {
  CHROME_DOM_PROTOCOL_VERSION,
  CHROME_NATIVE_HOST_NAME,
  CHROME_TOOL_TIMEOUT_MS,
  INTERNAL_CHROME_BRIDGE_METHOD_NAMES,
  IMPLEMENTED_CHROME_TOOL_NAMES,
  isAuthenticatedChromeBridgeRequest,
  isChromeDomSnapshotParams,
  isChromeDomSnapshotResult,
  MAX_CHROME_DOM_SNAPSHOT_BYTES,
  MAX_CHROME_DOM_MCP_OUTPUT_BYTES,
  MAX_CHROME_DOM_SNAPSHOT_NODES,
  MAX_CHROME_BRIDGE_MESSAGE_BYTES,
} from '../../plugins/chrome/protocol/index.js'

const root = resolve(import.meta.dir, '../..')
const extensionSource = await readFile(
  join(root, 'plugins', 'chrome', 'chrome-extension', 'background.js'),
  'utf8',
)
const contentSource = await readFile(
  join(root, 'plugins', 'chrome', 'chrome-extension', 'content.js'),
  'utf8',
)
const promptSource = await readFile(
  join(
    root,
    'plugins',
    'chrome',
    'skills',
    'claude-in-chrome',
    'SKILL.md',
  ),
  'utf8',
)
const nativeHostSource = await readFile(
  join(root, 'plugins', 'chrome', 'host', 'nativeHost.ts'),
  'utf8',
)
const socketClientSource = await readFile(
  join(root, 'plugins', 'chrome', 'mcp', 'mcpSocketClient.ts'),
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
      `[chrome-protocol] ${label} mismatch\nexpected: ${expectedSorted.join(', ')}\nactual: ${actualSorted.join(', ')}`,
    )
  }
}

const executeToolStart = extensionSource.indexOf('async function executeTool(')
const executeComputerStart = extensionSource.indexOf(
  'async function executeComputer(',
)
if (executeToolStart < 0 || executeComputerStart <= executeToolStart) {
  throw new Error(
    '[chrome-protocol] cannot locate extension tool dispatcher',
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
      `[chrome-protocol] ${tool.name} does not accept profileId`,
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
    '[chrome-protocol] computer schema advertises unsupported zoom',
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
      `[chrome-protocol] unsupported MCP tool advertised: ${name}`,
    )
  }
  if (promptSource.includes(`__${name}`)) {
    throw new Error(
      `[chrome-protocol] prompt advertises unsupported tool: ${name}`,
    )
  }
}

const nativeHostLiteral = extensionSource.match(
  /const NATIVE_HOST = '([^']+)'/,
)?.[1]
if (nativeHostLiteral !== CHROME_NATIVE_HOST_NAME) {
  throw new Error(
    `[chrome-protocol] native host mismatch: ${nativeHostLiteral}`,
  )
}
if (MAX_CHROME_BRIDGE_MESSAGE_BYTES !== 1024 * 1024) {
  throw new Error('[chrome-protocol] message limit changed')
}
if (CHROME_TOOL_TIMEOUT_MS !== 30_000) {
  throw new Error('[chrome-protocol] tool timeout changed')
}
if (
  CHROME_DOM_PROTOCOL_VERSION !== 1 ||
  MAX_CHROME_DOM_SNAPSHOT_NODES !== 5_000 ||
  MAX_CHROME_DOM_SNAPSHOT_BYTES !== 512 * 1024 ||
  MAX_CHROME_DOM_MCP_OUTPUT_BYTES !== 512 * 1024
) {
  throw new Error('[chrome-protocol] DOM protocol limits changed')
}
assertSame('internal bridge method registry', [
  ...INTERNAL_CHROME_BRIDGE_METHOD_NAMES,
], ['dom_snapshot'])
for (const method of INTERNAL_CHROME_BRIDGE_METHOD_NAMES) {
  if ((IMPLEMENTED_CHROME_TOOL_NAMES as readonly string[]).includes(method)) {
    throw new Error(
      `[chrome-protocol] internal bridge method leaked into public tools: ${method}`,
    )
  }
}

const validDomParams = {
  client_id: 'claude-code',
  profileId: '00000000-0000-0000-0000-000000000001',
  tabId: 7,
  scopeSelector: 'main',
  include: { tables: true, lists: true, links: false, forms: false },
  visibleOnly: true,
  maxNodes: 500,
  maxBytes: 64 * 1024,
  metadataOnly: false,
  matchSelectors: { item: '.row', field_0: '.price' },
}
if (
  !isChromeDomSnapshotParams(validDomParams) ||
  !isAuthenticatedChromeBridgeRequest({
    request_id: 'dom-request-1',
    auth_token: 'local-token',
    protocol_version: CHROME_DOM_PROTOCOL_VERSION,
    method: 'dom_snapshot',
    params: validDomParams,
  })
) {
  throw new Error('[chrome-protocol] valid DOM snapshot request was rejected')
}
const validDomResult = {
  schemaVersion: CHROME_DOM_PROTOCOL_VERSION,
  profileId: validDomParams.profileId,
  tabId: validDomParams.tabId,
  url: 'https://example.test/table',
  title: 'Fixture',
  documentId: 'document-1',
  capturedAt: '2026-08-09T00:00:00.000Z',
  contentHash: 'fnv1a32:01234567',
  rootNodeIds: ['node_1'],
  nodes: [
    {
      id: 'node_1',
      childIds: [],
      tag: 'main',
      text: 'Fixture text',
      matches: ['item'],
      visible: true,
      treeScope: 'document',
      frameDepth: 0,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      scroll: { scrollTop: 0, scrollHeight: 1200, clientHeight: 600 },
    },
  ],
  partial: true,
  partialReasons: ['visual_content_not_included'],
}
if (
  !isChromeDomSnapshotResult(validDomResult) ||
  isChromeDomSnapshotResult({ ...validDomResult, profileId: '' }) ||
  isChromeDomSnapshotResult({ ...validDomResult, url: 'chrome://settings' }) ||
  isChromeDomSnapshotResult({
    ...validDomResult,
    nodes: [{ ...validDomResult.nodes[0], value: 'secret' }],
  }) ||
  isChromeDomSnapshotResult({
    ...validDomResult,
    nodes: [{ ...validDomResult.nodes[0], matches: ['invalid:name'] }],
  }) ||
  isChromeDomSnapshotResult({
    ...validDomResult,
    nodes: [{ ...validDomResult.nodes[0], treeScope: 'closed-shadow' }],
  }) ||
  isChromeDomSnapshotResult({
    ...validDomResult,
    nodes: [{ ...validDomResult.nodes[0], frameDepth: -1 }],
  }) ||
  isChromeDomSnapshotResult({
    ...validDomResult,
    nodes: [
      {
        ...validDomResult.nodes[0],
        scroll: { scrollTop: 0, scrollHeight: 10, clientHeight: 20 },
      },
    ],
  }) ||
  isChromeDomSnapshotResult({
    ...validDomResult,
    partial: false,
    partialReasons: ['unexpected'],
  })
) {
  throw new Error('[chrome-protocol] DOM snapshot response validation failed')
}
if (
  isChromeDomSnapshotResult({
    ...validDomResult,
    nodes: Array(MAX_CHROME_DOM_SNAPSHOT_NODES + 1).fill(
      validDomResult.nodes[0],
    ),
  })
) {
  throw new Error('[chrome-protocol] oversized DOM node set was accepted')
}
for (const invalid of [
  { ...validDomParams, profileId: '' },
  { ...validDomParams, tabId: -1 },
  { ...validDomParams, scopeSelector: '' },
  { ...validDomParams, maxNodes: MAX_CHROME_DOM_SNAPSHOT_NODES + 1 },
  { ...validDomParams, maxBytes: MAX_CHROME_DOM_SNAPSHOT_BYTES + 1 },
  { ...validDomParams, visibleOnly: 'yes' },
  { ...validDomParams, matchSelectors: { 'invalid:name': '.row' } },
]) {
  if (isChromeDomSnapshotParams(invalid)) {
    throw new Error(
      `[chrome-protocol] invalid DOM snapshot parameters were accepted: ${JSON.stringify(invalid)}`,
    )
  }
}
if (
  isAuthenticatedChromeBridgeRequest({
    request_id: 'dom-request-2',
    auth_token: 'local-token',
    protocol_version: CHROME_DOM_PROTOCOL_VERSION + 1,
    method: 'dom_snapshot',
    params: validDomParams,
  }) ||
  isAuthenticatedChromeBridgeRequest({
    request_id: 'dom-request-3',
    auth_token: 'local-token',
    method: 'execute_tool',
    params: { tool: 'dom_snapshot', args: validDomParams },
  })
) {
  throw new Error(
    '[chrome-protocol] DOM bridge accepted a wrong version or public-tool envelope',
  )
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
      "case 'bridge_request'",
      'executeBridgeRequest(message)',
      'MAX_DOM_SNAPSHOT_BYTES',
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
      "case 'bridge_response'",
      'isAuthenticatedChromeBridgeRequest(request)',
      'await this.publishEndpoint()',
    ],
  ],
  [
    'MCP socket client',
    socketClientSource,
    [
      'pendingResponses',
      'request_id: randomUUID()',
      'callBridgeMethod(',
      'isChromeDomSnapshotParams(params)',
      'isChromeDomSnapshotResult(response.result)',
    ],
  ],
] as const) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(
        `[chrome-protocol] ${label} does not enforce ${marker}`,
      )
    }
  }
}

for (const marker of [
  'domDocumentId',
  'domDocumentRevision',
  'domContentHash()',
  '__CLAUDE_CHROME_DOM_SNAPSHOT__',
  "message.action === 'dom_snapshot'",
]) {
  if (!contentSource.includes(marker)) {
    throw new Error(
      `[chrome-protocol] phase-two DOM metadata boundary is missing: ${marker}`,
    )
  }
}

const extensionManifest = JSON.parse(
  await readFile(
    join(root, 'plugins', 'chrome', 'chrome-extension', 'manifest.json'),
    'utf8',
  ),
) as { content_scripts?: Array<{ js?: string[] }> }
const contentScripts = extensionManifest.content_scripts?.[0]?.js
if (
  JSON.stringify(contentScripts) !==
  JSON.stringify(['dom-snapshot.js', 'content.js'])
) {
  throw new Error(
    '[chrome-protocol] DOM sanitizer must load before the Chrome content dispatcher',
  )
}

console.log('[chrome-protocol] PASS')
