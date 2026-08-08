#!/usr/bin/env bun

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createChromeDomMcpServer } from '../../plugins/chrome/dom/mcpServer.js'
import { IMPLEMENTED_CHROME_DOM_TOOL_NAMES } from '../../plugins/chrome/dom/tools.js'
import type { SocketClient } from '../../plugins/chrome/mcp/types.js'
import {
  CHROME_DOM_PROTOCOL_VERSION,
  type ChromeDomSnapshotNode,
  type ChromeDomSnapshotResult,
} from '../../plugins/chrome/protocol/index.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[chrome-dom-tools] ${message}`)
}

const bounds = { x: 0, y: 0, width: 100, height: 20 }
function node(
  id: string,
  tag: string,
  parentId: string | undefined,
  childIds: string[],
  extra: Partial<ChromeDomSnapshotNode> = {},
): ChromeDomSnapshotNode {
  return { id, tag, parentId, childIds, visible: true, bounds, ...extra }
}

function snapshot(
  nodes: ChromeDomSnapshotNode[],
  rootNodeIds: string[],
  contentHash: string,
): ChromeDomSnapshotResult {
  return {
    schemaVersion: CHROME_DOM_PROTOCOL_VERSION,
    profileId: 'profile-primary',
    tabId: 17,
    url: 'https://example.test/fixture',
    title: 'DOM Fixture',
    documentId: 'document-fixture',
    capturedAt: '2026-08-09T00:00:00.000Z',
    contentHash,
    rootNodeIds,
    nodes,
    partial: false,
    partialReasons: [],
  }
}

const inspectSnapshot = snapshot(
  [node('inspect-root', 'main', undefined, [], { text: 'Overview' })],
  ['inspect-root'],
  'fixture:inspect',
)
const tableSnapshot = snapshot(
  [
    node('table', 'table', undefined, ['row-header', 'row-data']),
    node('row-header', 'tr', 'table', ['header-name', 'header-value']),
    node('header-name', 'th', 'row-header', [], {
      text: 'Name',
      table: { rowIndex: 0, columnIndex: 0, rowSpan: 1, colSpan: 1 },
    }),
    node('header-value', 'th', 'row-header', [], {
      text: 'Value',
      table: { rowIndex: 0, columnIndex: 1, rowSpan: 1, colSpan: 1 },
    }),
    node('row-data', 'tr', 'table', ['cell-name', 'cell-value']),
    node('cell-name', 'td', 'row-data', [], {
      text: 'BTC',
      table: { rowIndex: 1, columnIndex: 0, rowSpan: 1, colSpan: 1 },
    }),
    node('cell-value', 'td', 'row-data', [], {
      text: '61234.123456789012345678',
      table: { rowIndex: 1, columnIndex: 1, rowSpan: 1, colSpan: 1 },
    }),
  ],
  ['table'],
  'fixture:table',
)
const listSnapshot = snapshot(
  [
    node('cards', 'div', undefined, ['card-1', 'card-2'], {
      scroll: { scrollTop: 0, scrollHeight: 400, clientHeight: 200 },
    }),
    node('card-1', 'article', 'cards', ['card-name'], { matches: ['item'] }),
    node('card-name', 'span', 'card-1', [], {
      text: '账户甲',
      matches: ['field_0'],
    }),
    node('card-2', 'article', 'cards', ['card-name-2'], { matches: ['item'] }),
    node('card-name-2', 'span', 'card-2', [], {
      text: '账户乙',
      matches: ['field_0'],
    }),
  ],
  ['cards'],
  'fixture:list',
)

const bridgeCalls: Array<Record<string, unknown>> = []
const socketClient: SocketClient = {
  ensureConnected: async () => true,
  callTool: async () => {
    throw new Error('Chrome DOM MCP must not call browser-control tools')
  },
  callBridgeMethod: async (method, args) => {
    assert(method === 'dom_snapshot', 'unexpected internal bridge method')
    bridgeCalls.push(args)
    const selector = args.scopeSelector
    if (selector === '#missing') {
      return {
        protocol_version: CHROME_DOM_PROTOCOL_VERSION,
        error: { code: 'DOM_SCOPE_NOT_FOUND', message: 'not found' },
      }
    }
    const result =
      args.metadataOnly === true
        ? snapshot([], [], 'fixture:stable')
        : selector === '#table'
          ? tableSnapshot
          : selector === '#cards'
            ? listSnapshot
            : inspectSnapshot
    return { protocol_version: CHROME_DOM_PROTOCOL_VERSION, result }
  },
  isConnected: () => true,
  disconnect: () => {},
  setNotificationHandler: () => {},
}

const domMcp = createChromeDomMcpServer(
  {
    serverName: 'chrome-dom',
    logger: {
      silly: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    clientTypeId: 'claude-code',
    onAuthenticationError: () => {},
    onToolCallDisconnected: () => 'disconnected',
  },
  socketClient,
)
const client = new Client({ name: 'chrome-dom-tools-validation', version: '1.0.0' })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await Promise.all([
  domMcp.server.connect(serverTransport),
  client.connect(clientTransport),
])

function responseJson(response: Awaited<ReturnType<Client['callTool']>>): any {
  const content = 'content' in response ? response.content : undefined
  const first = Array.isArray(content) ? content[0] : undefined
  assert(first?.type === 'text', 'tool response is not text JSON')
  return JSON.parse(first.text)
}

try {
  const listed = await client.listTools()
  assert(
    JSON.stringify(listed.tools.map(tool => tool.name)) ===
      JSON.stringify(IMPLEMENTED_CHROME_DOM_TOOL_NAMES),
    'advertised DOM tool surface mismatch',
  )
  assert(
    listed.tools.every(
      tool =>
        tool.annotations?.readOnlyHint === true &&
        tool.annotations?.destructiveHint === false &&
        Array.isArray(tool.inputSchema.required) &&
        tool.inputSchema.required.includes('profileId') &&
        tool.inputSchema.required.includes('tabId'),
    ),
    'DOM tools are not marked read-only',
  )

  const inspected = responseJson(
    await client.callTool({
      name: 'dom_inspect',
      arguments: { profileId: 'profile-primary', tabId: 17 },
    }),
  )
  assert(inspected.nodeCount === 1 && inspected.tags.main === 1, 'inspect failed')

  const table = responseJson(
    await client.callTool({
      name: 'dom_extract_table',
      arguments: {
        profileId: 'profile-primary',
        tabId: 17,
        selector: '#table',
      },
    }),
  )
  assert(
    table.table.rows[0].Value === '61234.123456789012345678',
    'table tool coerced a financial value',
  )

  const list = responseJson(
    await client.callTool({
      name: 'dom_extract_list',
      arguments: {
        profileId: 'profile-primary',
        tabId: 17,
        selector: '#cards',
        itemSelector: '.card',
        fields: { account: '.name' },
        maxItems: 1,
      },
    }),
  )
  assert(
    list.list.items[0].fields.account === '账户甲',
    'list item/field selector mapping failed',
  )
  assert(
    typeof list.nextCursor === 'string' &&
      list.requiresExternalScroll === true &&
      list.provenance.pipeline === 'dom' &&
      list.visualFallback.automaticMerge === false,
    'list pagination or DOM/visual boundary is missing',
  )
  const secondListPage = responseJson(
    await client.callTool({
      name: 'dom_extract_list',
      arguments: {
        profileId: 'profile-primary',
        tabId: 17,
        selector: '#cards',
        itemSelector: '.card',
        fields: { account: '.name' },
        maxItems: 1,
        cursor: list.nextCursor,
      },
    }),
  )
  assert(
    secondListPage.list.items[0].fields.account === '账户乙' &&
      secondListPage.nextCursor === undefined,
    'signed list cursor did not return the next page',
  )

  const missing = responseJson(
    await client.callTool({
      name: 'dom_wait',
      arguments: {
        profileId: 'profile-primary',
        tabId: 17,
        selector: '#missing',
        condition: 'not_exists',
        timeoutMs: 500,
      },
    }),
  )
  assert(missing.matched === true, 'not_exists wait failed')

  const stable = responseJson(
    await client.callTool({
      name: 'dom_wait',
      arguments: {
        profileId: 'profile-primary',
        tabId: 17,
        selector: '#stable',
        condition: 'stable',
        quietMs: 100,
        timeoutMs: 500,
      },
    }),
  )
  assert(stable.matched === true, 'stable wait failed')

  const invalid = await client.callTool({
    name: 'dom_inspect',
    arguments: { tabId: 17 },
  })
  assert(invalid.isError === true, 'missing profileId did not fail closed')
  assert(
    bridgeCalls.every(
      call => call.profileId === 'profile-primary' && call.tabId === 17,
    ),
    'DOM bridge call lost explicit profile or tab routing',
  )
  const mismatch = await client.callTool({
    name: 'dom_inspect',
    arguments: { profileId: 'profile-other', tabId: 17 },
  })
  assert(mismatch.isError === true, 'mismatched snapshot route was accepted')
} finally {
  await client.close()
  await domMcp.server.close()
}

console.log('[chrome-dom-tools] PASS')
