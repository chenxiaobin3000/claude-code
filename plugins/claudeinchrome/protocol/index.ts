export const CHROME_NATIVE_HOST_NAME =
  'com.anthropic.claude_code_browser_extension'
export const CLAUDEINCHROME_EXTENSION_ID = 'dlpofjonbnceelbmpelkfblmnghclmkm'

export const MAX_CHROME_BRIDGE_MESSAGE_BYTES = 1024 * 1024
export const CHROME_TOOL_TIMEOUT_MS = 30_000

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

export type ChromeBridgeToolRequest = {
  request_id: string
  method: 'execute_tool'
  params: {
    client_id?: string
    tool: ImplementedChromeToolName
    args: Record<string, unknown>
  }
}

/** TCP-only request envelope; the Host removes auth_token before forwarding. */
export type AuthenticatedChromeBridgeToolRequest = ChromeBridgeToolRequest & {
  auth_token: string
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

export type NativeToolRequestMessage = ChromeBridgeToolRequest & {
  type: 'tool_request'
}

export type NativeToolResponseMessage = ChromeBridgeToolResponse & {
  type: 'tool_response'
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
  | NativeBridgeStatusMessage
