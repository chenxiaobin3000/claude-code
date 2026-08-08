import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import {
  MAX_CHROME_DOM_MCP_OUTPUT_BYTES,
  MAX_CHROME_DOM_SNAPSHOT_BYTES,
  type ChromeDomSnapshotParams,
  type ChromeDomSnapshotResult,
} from '../protocol/index.js'
import type { ClaudeForChromeContext, SocketClient } from '../mcp/types.js'
import { toLoggerDetail } from '../mcp/types.js'
import { assertChromeDomMcpOutputWithinLimit } from './limits.js'
import { parseDomList } from './listParser.js'
import {
  createChromeDomCursor,
  parseChromeDomCursor,
  type ChromeDomCursorBinding,
} from './pagination.js'
import { parseChromeDomSnapshot } from './schema.js'
import { validateDomSelector } from './selector.js'
import { parseDomTable } from './tableParser.js'
import { IMPLEMENTED_CHROME_DOM_TOOL_NAMES } from './tools.js'

class ChromeDomBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ChromeDomBridgeError'
  }
}

export interface ChromeDomToolRuntime {
  cursorSecret: string
}

function requiredString(
  args: Record<string, unknown>,
  name: string,
  maximum = 128,
): string {
  const value = args[name]
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new Error(`${name} must contain 1 to ${maximum} characters`)
  }
  return value
}

function boundedInteger(
  args: Record<string, unknown>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = args[name] ?? fallback
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value as number
}

function booleanValue(
  args: Record<string, unknown>,
  name: string,
  fallback: boolean,
): boolean {
  const value = args[name] ?? fallback
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

function stringRecord(
  value: unknown,
  name: string,
  maximumEntries: number,
  validateValues: boolean,
): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object of string values`)
  }
  const entries = Object.entries(value)
  if (entries.length > maximumEntries) {
    throw new Error(`${name} supports at most ${maximumEntries} entries`)
  }
  const output: Record<string, string> = Object.create(null)
  for (const [key, entry] of entries) {
    if (
      !key ||
      key.length > 128 ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      typeof entry !== 'string' ||
      (!validateValues && entry.length > 128)
    ) {
      throw new Error(`${name} contains an invalid key or value`)
    }
    output[key] = validateValues ? validateDomSelector(entry) : entry
  }
  return output
}

function snapshotParams(
  args: Record<string, unknown>,
  options: Partial<ChromeDomSnapshotParams> = {},
): ChromeDomSnapshotParams {
  return {
    profileId: requiredString(args, 'profileId'),
    tabId: boundedInteger(args, 'tabId', -1, 0, Number.MAX_SAFE_INTEGER),
    scopeSelector: validateDomSelector(
      typeof args.selector === 'string' ? args.selector : 'html',
    ),
    include: {
      tables: false,
      lists: false,
      links: false,
      forms: false,
    },
    visibleOnly: booleanValue(args, 'visibleOnly', true),
    maxNodes: boundedInteger(args, 'maxNodes', 2_000, 1, 5_000),
    maxBytes: MAX_CHROME_DOM_SNAPSHOT_BYTES,
    ...options,
  }
}

async function requestSnapshot(
  socketClient: SocketClient,
  params: ChromeDomSnapshotParams,
): Promise<ChromeDomSnapshotResult> {
  const response = (await socketClient.callBridgeMethod(
    'dom_snapshot',
    params as unknown as Record<string, unknown>,
  )) as { result?: unknown; error?: unknown }
  if (response.error !== undefined) {
    const error = response.error as { code?: unknown; message?: unknown }
    throw new ChromeDomBridgeError(
      typeof error.code === 'string' ? error.code : 'DOM_SNAPSHOT_FAILED',
      typeof error.message === 'string'
        ? error.message
        : 'Chrome DOM snapshot failed',
    )
  }
  const snapshot = parseChromeDomSnapshot(response.result)
  if (
    snapshot.profileId !== params.profileId ||
    snapshot.tabId !== params.tabId
  ) {
    throw new ChromeDomBridgeError(
      'DOM_SNAPSHOT_ROUTE_MISMATCH',
      'Chrome DOM snapshot response does not match the requested profile and tab',
    )
  }
  return snapshot
}

function textResult(value: unknown): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  }
  assertChromeDomMcpOutputWithinLimit(result, MAX_CHROME_DOM_MCP_OUTPUT_BYTES)
  return result
}

function errorResult(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: {
            code:
              error instanceof ChromeDomBridgeError
                ? error.code
                : error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    typeof error.code === 'string'
                  ? error.code
                : 'CHROME_DOM_TOOL_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      },
    ],
    isError: true,
  }
}

function snapshotIdentity(snapshot: ChromeDomSnapshotResult) {
  return {
    profileId: snapshot.profileId,
    tabId: snapshot.tabId,
    url: snapshot.url,
    title: snapshot.title,
    documentId: snapshot.documentId,
    capturedAt: snapshot.capturedAt,
    contentHash: snapshot.contentHash,
    partial: snapshot.partial,
    partialReasons: snapshot.partialReasons,
  }
}

function domResult<T extends Record<string, unknown>>(
  snapshot: ChromeDomSnapshotResult,
  value: T,
): Record<string, unknown> {
  const visualReasons = snapshot.partialReasons.filter(reason =>
    [
      'visual_content_not_included',
      'cross_origin_iframe_unavailable',
      'closed_shadow_root_unavailable',
    ].includes(reason),
  )
  return {
    ...snapshotIdentity(snapshot),
    ...value,
    provenance: { pipeline: 'dom', rawHtml: false, readOnly: true },
    visualFallback: {
      required: visualReasons.length > 0,
      reasons: visualReasons,
      pipeline: 'screenshot+multimodal',
      comparisonFields: ['domValue', 'visualValue', 'consistent'],
      automaticMerge: false,
    },
  }
}

async function inspect(
  socketClient: SocketClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const snapshot = await requestSnapshot(
    socketClient,
    snapshotParams(args, {
      include: { tables: true, lists: true, links: true, forms: true },
    }),
  )
  const tags: Record<string, number> = Object.create(null)
  for (const node of snapshot.nodes) tags[node.tag] = (tags[node.tag] ?? 0) + 1
  return textResult(domResult(snapshot, {
    nodeCount: snapshot.nodes.length,
    rootNodeCount: snapshot.rootNodeIds.length,
    tags,
  }))
}

async function extractTable(
  socketClient: SocketClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  requiredString(args, 'selector', 2_048)
  const maxRows = boundedInteger(args, 'maxRows', 1_000, 1, 10_000)
  const columnAliases = stringRecord(
    args.columnAliases,
    'columnAliases',
    64,
    false,
  )
  const snapshot = await requestSnapshot(
    socketClient,
    snapshotParams(args, {
      include: { tables: true, lists: false, links: true, forms: false },
      maxNodes: 5_000,
    }),
  )
  return textResult(domResult(snapshot, {
    table: parseDomTable(snapshot, { maxRows, columnAliases }),
  }))
}

async function extractList(
  socketClient: SocketClient,
  args: Record<string, unknown>,
  runtime: ChromeDomToolRuntime,
): Promise<CallToolResult> {
  requiredString(args, 'selector', 2_048)
  const maxItems = boundedInteger(args, 'maxItems', 1_000, 1, 10_000)
  const itemSelector =
    typeof args.itemSelector === 'string'
      ? validateDomSelector(args.itemSelector)
      : undefined
  const fields = stringRecord(args.fields, 'fields', 16, true)
  const matchSelectors: Record<string, string> = Object.create(null)
  if (itemSelector) matchSelectors.item = itemSelector
  const fieldMatchNames: Record<string, string> = Object.create(null)
  let fieldIndex = 0
  for (const [fieldName, fieldSelector] of Object.entries(fields)) {
    const matchName = `field_${fieldIndex++}`
    matchSelectors[matchName] = fieldSelector
    fieldMatchNames[fieldName] = matchName
  }
  const snapshot = await requestSnapshot(
    socketClient,
    snapshotParams(args, {
      include: { tables: true, lists: true, links: true, forms: true },
      maxNodes: 5_000,
      matchSelectors,
    }),
  )
  const binding: ChromeDomCursorBinding = {
    profileId: snapshot.profileId,
    tabId: snapshot.tabId,
    documentId: snapshot.documentId,
    contentHash: snapshot.contentHash,
  }
  const cursor = args.cursor
  if (
    cursor !== undefined &&
    (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 4_096)
  ) {
    throw new Error('cursor must contain 1 to 4096 characters')
  }
  const offset = cursor
    ? parseChromeDomCursor(cursor, binding, runtime.cursorSecret).offset
    : 0
  const list = parseDomList(snapshot, {
    maxItems,
    offset,
    itemMatchName: itemSelector ? 'item' : undefined,
    fieldMatchNames,
  })
  const nextOffset = list.offset + list.returnedItemCount
  const nextCursor = list.truncated
    ? createChromeDomCursor(binding, nextOffset, runtime.cursorSecret)
    : undefined
  const requiresExternalScroll = snapshot.nodes.some(node => node.scroll)
  return textResult(domResult(snapshot, {
    list,
    nextCursor,
    requiresExternalScroll,
    continuation: requiresExternalScroll
      ? 'Use the browser-control MCP to scroll the same profile/tab, call dom_wait with condition=stable, then start a fresh dom_extract_list read. Do not reuse this cursor after page content changes.'
      : nextCursor
        ? 'Pass nextCursor to dom_extract_list while the page remains unchanged.'
        : undefined,
  }))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitForDom(
  socketClient: SocketClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  requiredString(args, 'selector', 2_048)
  const condition = args.condition ?? 'exists'
  if (!['exists', 'not_exists', 'stable'].includes(String(condition))) {
    throw new Error('condition must be exists, not_exists, or stable')
  }
  const quietMs = boundedInteger(args, 'quietMs', 500, 100, 5_000)
  const timeoutMs = boundedInteger(args, 'timeoutMs', 10_000, 100, 25_000)
  const deadline = Date.now() + timeoutMs
  let stableHash: string | undefined
  let stableSince = 0
  while (Date.now() <= deadline) {
    try {
      const snapshot = await requestSnapshot(
        socketClient,
        snapshotParams(args, {
          metadataOnly: true,
          maxNodes: 1,
          maxBytes: 16 * 1024,
        }),
      )
      if (condition === 'exists') {
        return textResult(domResult(snapshot, { condition, matched: true }))
      }
      if (condition === 'stable') {
        if (snapshot.contentHash !== stableHash) {
          stableHash = snapshot.contentHash
          stableSince = Date.now()
        } else if (Date.now() - stableSince >= quietMs) {
          return textResult(domResult(snapshot, {
            condition,
            matched: true,
            quietMs,
          }))
        }
      }
    } catch (error) {
      if (
        error instanceof ChromeDomBridgeError &&
        error.code === 'DOM_SCOPE_NOT_FOUND'
      ) {
        if (condition === 'not_exists') {
          return textResult({
            condition,
            matched: true,
            provenance: { pipeline: 'dom', rawHtml: false, readOnly: true },
          })
        }
        stableHash = undefined
        stableSince = 0
      } else {
        throw error
      }
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())))
  }
  throw new ChromeDomBridgeError(
    'DOM_WAIT_TIMEOUT',
    `DOM wait timed out after ${timeoutMs} ms`,
  )
}

export async function handleChromeDomToolCall(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
  name: string,
  args: Record<string, unknown>,
  runtime: ChromeDomToolRuntime,
): Promise<CallToolResult> {
  try {
    if (!(IMPLEMENTED_CHROME_DOM_TOOL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Chrome DOM tool "${name}" is not implemented`)
    }
    if (!(await socketClient.ensureConnected())) {
      throw new ChromeDomBridgeError(
        'CHROME_EXTENSION_DISCONNECTED',
        context.onToolCallDisconnected(),
      )
    }
    if (name === 'dom_inspect') return await inspect(socketClient, args)
    if (name === 'dom_extract_table') return await extractTable(socketClient, args)
    if (name === 'dom_extract_list') {
      return await extractList(socketClient, args, runtime)
    }
    return await waitForDom(socketClient, args)
  } catch (error) {
    context.logger.info(
      `[${context.serverName}] Chrome DOM tool failed: ${name}`,
      toLoggerDetail(error),
    )
    return errorResult(error)
  }
}
