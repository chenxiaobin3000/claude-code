#!/usr/bin/env bun

import {
  CHROME_DOM_PROTOCOL_VERSION,
  type ChromeDomSnapshotNode,
  type ChromeDomSnapshotResult,
} from '../../plugins/chrome/protocol/index.js'
import {
  assertChromeDomMcpOutputWithinLimit,
  ChromeDomOutputLimitError,
  compareDomAndVisual,
  createChromeDomCursor,
  makeUniqueColumnNames,
  parseChromeDomCursor,
  parseDomList,
  parseDomTable,
  validateDomSelector,
} from '../../plugins/chrome/dom/index.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[chrome-dom-parsers] ${message}`)
}

const bounds = { x: 0, y: 0, width: 100, height: 20 }
function node(
  id: string,
  tag: string,
  parentId: string | undefined,
  childIds: string[],
  extra: Partial<ChromeDomSnapshotNode> = {},
): ChromeDomSnapshotNode {
  return {
    id,
    parentId,
    childIds,
    tag,
    visible: true,
    bounds,
    ...extra,
  }
}

const nodes: ChromeDomSnapshotNode[] = [
  node('root', 'main', undefined, ['table', 'list']),
  node('table', 'table', 'root', ['thead', 'tbody']),
  node('thead', 'thead', 'table', ['header-1', 'header-2']),
  node('header-1', 'tr', 'thead', ['asset', 'quote']),
  node('asset', 'th', 'header-1', [], {
    text: 'Asset',
    table: { rowIndex: 0, columnIndex: 0, rowSpan: 2, colSpan: 1 },
  }),
  node('quote', 'th', 'header-1', [], {
    text: 'Quote',
    table: { rowIndex: 0, columnIndex: 1, rowSpan: 1, colSpan: 2 },
  }),
  node('header-2', 'tr', 'thead', ['price', 'change']),
  node('price', 'th', 'header-2', [], {
    text: 'Price',
    table: { rowIndex: 1, columnIndex: 0, rowSpan: 1, colSpan: 1 },
  }),
  node('change', 'th', 'header-2', [], {
    text: 'Change',
    table: { rowIndex: 1, columnIndex: 1, rowSpan: 1, colSpan: 1 },
  }),
  node('tbody', 'tbody', 'table', ['btc-row', 'eth-row']),
  node('btc-row', 'tr', 'tbody', ['btc', 'btc-price', 'btc-change']),
  node('btc', 'td', 'btc-row', [], {
    text: '比特币 BTC',
    table: { rowIndex: 2, columnIndex: 0, rowSpan: 1, colSpan: 1 },
  }),
  node('btc-price', 'td', 'btc-row', [], {
    text: '61234.123456789012345678',
    table: { rowIndex: 2, columnIndex: 1, rowSpan: 1, colSpan: 1 },
  }),
  node('btc-change', 'td', 'btc-row', [], {
    text: '+1.25%',
    table: { rowIndex: 2, columnIndex: 2, rowSpan: 1, colSpan: 1 },
  }),
  node('eth-row', 'tr', 'tbody', ['eth', 'eth-price', 'eth-change']),
  node('eth', 'td', 'eth-row', [], {
    text: '以太坊 ETH',
    table: { rowIndex: 3, columnIndex: 0, rowSpan: 1, colSpan: 1 },
  }),
  node('eth-price', 'td', 'eth-row', [], {
    text: '3456.000000000000000001',
    table: { rowIndex: 3, columnIndex: 1, rowSpan: 1, colSpan: 1 },
  }),
  node('eth-change', 'td', 'eth-row', [], {
    table: { rowIndex: 3, columnIndex: 2, rowSpan: 1, colSpan: 1 },
  }),
  node('list', 'ol', 'root', ['item-1', 'item-2']),
  node('item-1', 'li', 'list', ['item-link'], {
    text: '账户甲',
    list: { level: 1, itemIndex: 0 },
    data: { label: 'primary' },
  }),
  node('item-link', 'a', 'item-1', [], {
    text: '订单',
    href: 'https://example.test/orders',
  }),
  node('item-2', 'li', 'list', [], {
    text: '账户乙',
    list: { level: 1, itemIndex: 1 },
  }),
]

const snapshot: ChromeDomSnapshotResult = {
  schemaVersion: CHROME_DOM_PROTOCOL_VERSION,
  profileId: '00000000-0000-4000-8000-000000000001',
  tabId: 7,
  url: 'https://example.test/markets',
  title: 'Markets',
  documentId: 'document-1',
  capturedAt: '2026-08-09T00:00:00.000Z',
  contentHash: 'fixture:1',
  rootNodeIds: ['root'],
  nodes,
  partial: false,
  partialReasons: [],
}

const table = parseDomTable(snapshot)
assert(
  JSON.stringify(table.columns) ===
    JSON.stringify(['Asset', 'Quote / Price', 'Quote / Change']),
  `multi-row headers were parsed incorrectly: ${JSON.stringify(table.columns)}`,
)
assert(table.rows.length === 2, 'table row count mismatch')
assert(
  table.rows[0]?.['Quote / Price'] === '61234.123456789012345678',
  'financial value was coerced or rounded',
)
assert(
  table.rows[1]?.Asset === '以太坊 ETH',
  'Unicode table value was not preserved',
)
assert(
  table.rows[1]?.['Quote / Change'] === '',
  'empty table value was not preserved',
)
assert(
  JSON.stringify(makeUniqueColumnNames(['Value', 'Value', ''])) ===
    JSON.stringify(['Value', 'Value_2', 'column_3']),
  'duplicate or empty column normalization failed',
)
const limitedTable = parseDomTable(snapshot, {
  maxRows: 1,
  columnAliases: { Asset: '资产' },
})
assert(
  limitedTable.truncated && limitedTable.columns[0] === '资产',
  'table row limit or column alias failed',
)

const noHeaderNodes = nodes.map(item =>
  item.tag === 'th' ? { ...item, tag: 'td' } : item,
)
const noHeader = parseDomTable({ ...snapshot, nodes: noHeaderNodes })
assert(
  noHeader.columns[0] === 'column_1' && noHeader.rows.length === 4,
  'headerless table fallback failed',
)

const list = parseDomList(snapshot)
assert(list.ordered && list.items.length === 2, 'ordered list parsing failed')
assert(
  list.items[0]?.text === '账户甲 订单' &&
    list.items[0]?.links[0] === 'https://example.test/orders',
  'list text or link extraction failed',
)
const secondListPage = parseDomList(snapshot, { maxItems: 1, offset: 1 })
assert(
  secondListPage.offset === 1 &&
    secondListPage.items[0]?.text === '账户乙' &&
    !secondListPage.truncated,
  'list offset pagination failed',
)

const comparison = compareDomAndVisual(
  { symbol: 'BTC', price: '61234.12' },
  { price: '61234.12', symbol: 'BTC' },
)
assert(comparison.consistent === true, 'DOM/visual comparison failed')
assert(
  !('mergedValue' in comparison),
  'DOM/visual comparison silently merged evidence',
)

assert(validateDomSelector(' main > table ') === 'main > table', 'selector trim failed')
for (const invalidSelector of ['', ':has(.expensive)', 'main\u0000table']) {
  let rejected = false
  try {
    validateDomSelector(invalidSelector)
  } catch {
    rejected = true
  }
  assert(rejected, `unsafe selector was accepted: ${JSON.stringify(invalidSelector)}`)
}

const binding = {
  profileId: snapshot.profileId,
  tabId: snapshot.tabId,
  documentId: snapshot.documentId,
  contentHash: snapshot.contentHash,
}
const secret = '0123456789abcdef-validation-secret'
const cursor = createChromeDomCursor(binding, 25, secret)
assert(
  parseChromeDomCursor(cursor, binding, secret).offset === 25,
  'cursor round trip failed',
)
const [cursorPayload, cursorSignature] = cursor.split('.') as [string, string]
const tamperedCursor = `${cursorPayload.startsWith('A') ? 'B' : 'A'}${cursorPayload.slice(1)}.${cursorSignature}`
for (const [candidate, expected] of [
  [tamperedCursor, binding],
  [cursor, { ...binding, documentId: 'document-2' }],
] as const) {
  let rejected = false
  try {
    parseChromeDomCursor(candidate, expected, secret)
  } catch {
    rejected = true
  }
  assert(rejected, 'tampered or stale cursor was accepted')
}

assert(
  assertChromeDomMcpOutputWithinLimit({ ok: true }, 64) > 0,
  'bounded MCP output was rejected',
)
let outputLimitRejected = false
try {
  assertChromeDomMcpOutputWithinLimit({ value: 'x'.repeat(128) }, 64)
} catch (error) {
  outputLimitRejected =
    error instanceof ChromeDomOutputLimitError &&
    error.code === 'DOM_MCP_OUTPUT_TOO_LARGE'
}
assert(outputLimitRejected, 'oversized MCP output was not rejected structurally')

console.log('[chrome-dom-parsers] PASS')
