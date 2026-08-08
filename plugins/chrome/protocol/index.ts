export const CHROME_NATIVE_HOST_NAME =
  'com.anthropic.claude_code_browser_extension'
export const CHROME_EXTENSION_ID = 'dlpofjonbnceelbmpelkfblmnghclmkm'

export const MAX_CHROME_BRIDGE_MESSAGE_BYTES = 1024 * 1024
export const CHROME_TOOL_TIMEOUT_MS = 30_000
export const CHROME_DOM_PROTOCOL_VERSION = 1 as const
export const MAX_CHROME_DOM_SNAPSHOT_NODES = 5_000
export const MAX_CHROME_DOM_MCP_OUTPUT_BYTES = 512 * 1024
export const MAX_CHROME_DOM_SNAPSHOT_BYTES = MAX_CHROME_DOM_MCP_OUTPUT_BYTES

export const IMPLEMENTED_CHROME_TOOL_NAMES = [
  'javascript_tool',
  'read_page',
  'find',
  'form_input',
  'computer',
  'navigate',
  'resize_window',
  'get_page_text',
  'tabs_context_mcp',
  'tabs_create_mcp',
  'update_plan',
] as const

export type ImplementedChromeToolName =
  (typeof IMPLEMENTED_CHROME_TOOL_NAMES)[number]

const implementedChromeToolNames = new Set<string>(
  IMPLEMENTED_CHROME_TOOL_NAMES,
)

export function isImplementedChromeToolName(
  value: string,
): value is ImplementedChromeToolName {
  return implementedChromeToolNames.has(value)
}

export const INTERNAL_CHROME_BRIDGE_METHOD_NAMES = ['dom_snapshot'] as const

export type InternalChromeBridgeMethodName =
  (typeof INTERNAL_CHROME_BRIDGE_METHOD_NAMES)[number]

const internalChromeBridgeMethodNames = new Set<string>(
  INTERNAL_CHROME_BRIDGE_METHOD_NAMES,
)

export function isInternalChromeBridgeMethodName(
  value: string,
): value is InternalChromeBridgeMethodName {
  return internalChromeBridgeMethodNames.has(value)
}

export type ChromeDomSnapshotContentTypes = {
  tables: boolean
  lists: boolean
  links: boolean
  forms: boolean
}

export type ChromeDomSnapshotParams = {
  client_id?: string
  profileId: string
  tabId: number
  scopeSelector: string
  include: ChromeDomSnapshotContentTypes
  visibleOnly: boolean
  maxNodes: number
  maxBytes: number
  metadataOnly?: boolean
  matchSelectors?: Record<string, string>
}

export type ChromeDomSnapshotNode = {
  id: string
  parentId?: string
  childIds: string[]
  tag: string
  role?: string
  text?: string
  aria?: Record<string, string>
  data?: Record<string, string>
  href?: string
  visible: boolean
  treeScope?: 'document' | 'shadow-root' | 'iframe'
  frameDepth?: number
  bounds: { x: number; y: number; width: number; height: number }
  scroll?: { scrollTop: number; scrollHeight: number; clientHeight: number }
  table?: {
    rowIndex: number
    columnIndex: number
    rowSpan: number
    colSpan: number
    scope?: string
    headers?: string
  }
  list?: { level: number; itemIndex: number }
  matches?: string[]
}

export type ChromeDomSnapshotResult = {
  schemaVersion: typeof CHROME_DOM_PROTOCOL_VERSION
  profileId: string
  tabId: number
  url: string
  title: string
  documentId: string
  capturedAt: string
  contentHash: string
  rootNodeIds: string[]
  nodes: ChromeDomSnapshotNode[]
  partial: boolean
  partialReasons: string[]
}

export type ChromeDomSnapshotRequest = {
  request_id: string
  protocol_version: typeof CHROME_DOM_PROTOCOL_VERSION
  method: 'dom_snapshot'
  params: ChromeDomSnapshotParams
}

export type ChromeBridgeToolRequest = {
  request_id: string
  method: 'execute_tool'
  params: {
    client_id?: string
    tool: ImplementedChromeToolName
    args: Record<string, unknown>
  }
}

export type ChromeBridgeRequest =
  | ChromeBridgeToolRequest
  | ChromeDomSnapshotRequest

/** TCP-only request envelope; the Host removes auth_token before forwarding. */
export type AuthenticatedChromeBridgeRequest = ChromeBridgeRequest & {
  auth_token: string
}

export type AuthenticatedChromeBridgeToolRequest =
  AuthenticatedChromeBridgeRequest & ChromeBridgeToolRequest

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every(item => typeof item === 'string')
  )
}

const chromeDomSnapshotNodeKeys = new Set([
  'id',
  'parentId',
  'childIds',
  'tag',
  'role',
  'text',
  'aria',
  'data',
  'href',
  'visible',
  'treeScope',
  'frameDepth',
  'bounds',
  'scroll',
  'table',
  'list',
  'matches',
])
const chromeDomSnapshotAriaKeys = new Set([
  'label',
  'labelledby',
  'describedby',
  'expanded',
  'checked',
  'selected',
  'pressed',
  'current',
  'level',
  'rowindex',
  'colindex',
  'rowcount',
  'colcount',
  'sort',
  'haspopup',
])
const chromeDomSnapshotDataKeys = new Set([
  'testid',
  'test',
  'qa',
  'label',
  'name',
])

export function isChromeDomSnapshotParams(
  value: unknown,
): value is ChromeDomSnapshotParams {
  if (!isRecord(value) || !isRecord(value.include)) return false
  const include = value.include
  const matchSelectors = value.matchSelectors
  return (
    typeof value.profileId === 'string' &&
    value.profileId.length >= 1 &&
    value.profileId.length <= 128 &&
    isBoundedInteger(value.tabId, 0, Number.MAX_SAFE_INTEGER) &&
    typeof value.scopeSelector === 'string' &&
    value.scopeSelector.length >= 1 &&
    value.scopeSelector.length <= 2_048 &&
    typeof include.tables === 'boolean' &&
    typeof include.lists === 'boolean' &&
    typeof include.links === 'boolean' &&
    typeof include.forms === 'boolean' &&
    typeof value.visibleOnly === 'boolean' &&
    isBoundedInteger(value.maxNodes, 1, MAX_CHROME_DOM_SNAPSHOT_NODES) &&
    isBoundedInteger(value.maxBytes, 1_024, MAX_CHROME_DOM_SNAPSHOT_BYTES) &&
    (value.client_id === undefined || typeof value.client_id === 'string') &&
    (value.metadataOnly === undefined ||
      typeof value.metadataOnly === 'boolean') &&
    (matchSelectors === undefined ||
      (isStringRecord(matchSelectors) &&
        Object.keys(matchSelectors).length <= 32 &&
        Object.entries(matchSelectors).every(
          ([name, selector]) =>
            /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) &&
            selector.length >= 1 &&
            selector.length <= 2_048,
        )))
  )
}

export function isChromeDomSnapshotResult(
  value: unknown,
): value is ChromeDomSnapshotResult {
  if (
    !(
    isRecord(value) &&
    value.schemaVersion === CHROME_DOM_PROTOCOL_VERSION &&
    typeof value.profileId === 'string' &&
    value.profileId.length >= 1 &&
    isBoundedInteger(value.tabId, 0, Number.MAX_SAFE_INTEGER) &&
    typeof value.url === 'string' &&
    (value.url.startsWith('http://') || value.url.startsWith('https://')) &&
    typeof value.title === 'string' &&
    typeof value.documentId === 'string' &&
    value.documentId.length >= 1 &&
    typeof value.capturedAt === 'string' &&
    Number.isFinite(Date.parse(value.capturedAt)) &&
    typeof value.contentHash === 'string' &&
    value.contentHash.length >= 1 &&
    Array.isArray(value.rootNodeIds) &&
    value.rootNodeIds.every(id => typeof id === 'string') &&
    Array.isArray(value.nodes) &&
    value.nodes.length <= MAX_CHROME_DOM_SNAPSHOT_NODES &&
    typeof value.partial === 'boolean' &&
    Array.isArray(value.partialReasons) &&
    value.partialReasons.every(reason => typeof reason === 'string') &&
    (value.partial || value.partialReasons.length === 0)
    )
  ) {
    return false
  }
  const nodes = value.nodes
  const nodeIds = new Set<string>()
  const nodesById = new Map<string, Record<string, unknown>>()
  for (const candidate of nodes) {
    if (!isRecord(candidate) || !isRecord(candidate.bounds)) return false
    const bounds = candidate.bounds
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      nodeIds.has(candidate.id) ||
      (candidate.parentId !== undefined &&
        typeof candidate.parentId !== 'string') ||
      !Array.isArray(candidate.childIds) ||
      !candidate.childIds.every(id => typeof id === 'string') ||
      typeof candidate.tag !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.tag) ||
      !isOptionalString(candidate.role) ||
      (typeof candidate.role === 'string' && candidate.role.length > 80) ||
      !isOptionalString(candidate.text) ||
      (typeof candidate.text === 'string' && candidate.text.length > 500) ||
      (candidate.aria !== undefined && !isStringRecord(candidate.aria)) ||
      (candidate.data !== undefined && !isStringRecord(candidate.data)) ||
      !isOptionalString(candidate.href) ||
      (typeof candidate.href === 'string' &&
        !candidate.href.startsWith('http://') &&
        !candidate.href.startsWith('https://')) ||
      typeof candidate.visible !== 'boolean' ||
      (candidate.treeScope !== undefined &&
        !['document', 'shadow-root', 'iframe'].includes(
          String(candidate.treeScope),
        )) ||
      (candidate.frameDepth !== undefined &&
        !isBoundedInteger(candidate.frameDepth, 0, 32)) ||
      (candidate.matches !== undefined &&
        (!Array.isArray(candidate.matches) ||
          !candidate.matches.every(
            match =>
              typeof match === 'string' &&
              /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(match),
          ))) ||
      !['x', 'y', 'width', 'height'].every(
        key => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
      ) ||
      !Object.keys(candidate).every(key => chromeDomSnapshotNodeKeys.has(key))
    ) {
      return false
    }
    if (
      (isStringRecord(candidate.aria) &&
        !Object.keys(candidate.aria).every(key =>
          chromeDomSnapshotAriaKeys.has(key),
        )) ||
      (isStringRecord(candidate.data) &&
        !Object.keys(candidate.data).every(key =>
          chromeDomSnapshotDataKeys.has(key),
        )) ||
      (bounds.width as number) < 0 ||
      (bounds.height as number) < 0
    ) {
      return false
    }
    if (candidate.table !== undefined) {
      const table = candidate.table
      if (
        !isRecord(table) ||
        !Number.isInteger(table.rowIndex) ||
        !Number.isInteger(table.columnIndex) ||
        !Number.isInteger(table.rowSpan) ||
        !Number.isInteger(table.colSpan) ||
        (table.rowSpan as number) < 1 ||
        (table.colSpan as number) < 1 ||
        !isOptionalString(table.scope) ||
        !isOptionalString(table.headers)
      ) {
        return false
      }
    }
    if (candidate.scroll !== undefined) {
      const scroll = candidate.scroll
      if (
        !isRecord(scroll) ||
        !['scrollTop', 'scrollHeight', 'clientHeight'].every(
          key =>
            typeof scroll[key] === 'number' &&
            Number.isFinite(scroll[key]) &&
            (scroll[key] as number) >= 0,
        ) ||
        (scroll.scrollHeight as number) < (scroll.clientHeight as number)
      ) {
        return false
      }
    }
    if (
      candidate.list !== undefined &&
      (!isRecord(candidate.list) ||
        !Number.isInteger(candidate.list.level) ||
        !Number.isInteger(candidate.list.itemIndex) ||
        (candidate.list.level as number) < 0 ||
        (candidate.list.itemIndex as number) < 0)
    ) {
      return false
    }
    nodeIds.add(candidate.id)
    nodesById.set(candidate.id, candidate)
  }
  if (
    !value.rootNodeIds.every(id => {
      const node = nodesById.get(id)
      return node !== undefined && node.parentId === undefined
    })
  ) {
    return false
  }
  for (const candidate of nodes) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string') return false
    if (
      (typeof candidate.parentId === 'string' &&
        !nodeIds.has(candidate.parentId)) ||
      !(candidate.childIds as string[]).every(id => nodeIds.has(id))
    ) {
      return false
    }
    if (typeof candidate.parentId === 'string') {
      const parent = nodesById.get(candidate.parentId)
      if (!(parent?.childIds as string[] | undefined)?.includes(candidate.id)) {
        return false
      }
    }
    for (const childId of candidate.childIds as string[]) {
      if (nodesById.get(childId)?.parentId !== candidate.id) return false
    }
  }
  return true
}

export function isAuthenticatedChromeBridgeRequest(
  value: unknown,
): value is AuthenticatedChromeBridgeRequest {
  if (
    !isRecord(value) ||
    typeof value.request_id !== 'string' ||
    value.request_id.length === 0 ||
    typeof value.auth_token !== 'string' ||
    !isRecord(value.params)
  ) {
    return false
  }
  if (value.method === 'execute_tool') {
    return (
      typeof value.params.tool === 'string' &&
      isImplementedChromeToolName(value.params.tool) &&
      isRecord(value.params.args)
    )
  }
  return (
    value.method === 'dom_snapshot' &&
    value.protocol_version === CHROME_DOM_PROTOCOL_VERSION &&
    isChromeDomSnapshotParams(value.params)
  )
}

export type ChromeSocketEndpoint = {
  id: string
  host: '127.0.0.1'
  port: number
  token: string
  pid: number
  profileId: string
  profileName: string
}

export type ChromeProfileHelloMessage = {
  type: 'profile_hello'
  profile_id: string
  profile_name: string
}

export type ChromeBridgeToolResponse = {
  request_id: string
  result?: unknown
  error?: unknown
}

export type ChromeBridgeResponse = ChromeBridgeToolResponse & {
  protocol_version?: typeof CHROME_DOM_PROTOCOL_VERSION
}

export type NativeToolRequestMessage = ChromeBridgeToolRequest & {
  type: 'tool_request'
}

export type NativeToolResponseMessage = ChromeBridgeToolResponse & {
  type: 'tool_response'
}

export type NativeBridgeRequestMessage = ChromeDomSnapshotRequest & {
  type: 'bridge_request'
}

export type NativeBridgeResponseMessage = ChromeBridgeResponse & {
  type: 'bridge_response'
}

export type NativeBridgeStatusMessage =
  | ChromeProfileHelloMessage
  | { type: 'get_status' }
  | {
      type: 'status_response'
      native_host_version: string
    }
  | { type: 'mcp_connected' }
  | { type: 'mcp_disconnected' }
  | {
      type: 'error'
      error: string
      request_id?: string
    }

export type ChromeNativeMessage =
  | NativeToolRequestMessage
  | NativeToolResponseMessage
  | NativeBridgeRequestMessage
  | NativeBridgeResponseMessage
  | NativeBridgeStatusMessage
