/**
 * Logger 第二参数的可选类型。
 * 调用方通过 util.format 追加详情，实践中多为 catch 到的异常对象。
 */
export type LoggerDetail = Error | NodeJS.ErrnoException

/** 将 unknown 收窄为 LoggerDetail，供 catch 块传给 logger 使用。 */
export function toLoggerDetail(detail: unknown): LoggerDetail | undefined {
  return detail instanceof Error ? detail : undefined
}

/** 宿主注入的日志接口，与 DebugLogger（util.format）对齐。 */
export interface Logger {
  info: (message: string, detail?: LoggerDetail) => void // 信息
  error: (message: string, detail?: LoggerDetail) => void // 错误
  warn: (message: string, detail?: LoggerDetail) => void // 警告
  debug: (message: string, detail?: LoggerDetail) => void // 调试
  silly: (message: string, detail?: LoggerDetail) => void // 最细粒度调试
}

export type PermissionMode =
  | 'ask'
  | 'skip_all_permission_checks'
  | 'follow_a_plan'

export interface ClaudeForChromeContext {
  serverName: string
  logger: Logger
  socketPath: string
  // Optional dynamic resolver for socket path. When provided, called on each
  // connection attempt to handle runtime conditions (e.g., TMPDIR mismatch).
  getSocketPath?: () => string
  // Optional resolver returning all available socket paths (for multi-profile support).
  // When provided, a socket pool connects to all sockets and routes by tab ID.
  getSocketPaths?: () => string[]
  clientTypeId: string // "desktop" | "claude-code"
  onToolCallDisconnected: () => string
  onAuthenticationError: () => void
  isDisabled?: () => boolean
  /** If set, permission mode is sent to the local extension on connection. */
  initialPermissionMode?: PermissionMode
}

/**
 * Map Node's process.platform to the platform string reported by Chrome extensions
 * via navigator.userAgentData.platform.
 */
export function localPlatformLabel(): string {
  return process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'win32'
      ? 'Windows'
      : 'Linux'
}

/** Permission request forwarded from the extension to the desktop for user approval. */
export interface ChromePermissionRequest {
  /** Links to the pending tool_call */
  toolUseId: string
  /** Unique ID for this permission request */
  requestId: string
  /** Tool type, e.g. "navigate", "click", "execute_javascript" */
  toolType: string
  /** The URL/domain context */
  url: string
  /** Additional action data (click coordinates, text, etc.) */
  actionData?: Record<string, unknown>
}

/** Desktop response to a bridge permission request. */
export interface ChromePermissionResponse {
  requestId: string
  allowed: boolean
}

/** Per-call permission overrides, allowing each session to use its own permission state. */
export interface PermissionOverrides {
  permissionMode: PermissionMode
  allowedDomains?: string[]
  /** Callback invoked when the local extension requests user permission. */
  onPermissionRequest?: (request: ChromePermissionRequest) => Promise<boolean>
}

/** Shared interface for McpSocketClient and McpSocketPool */
export interface SocketClient {
  ensureConnected(): Promise<boolean>
  callTool(
    name: string,
    args: Record<string, unknown>,
    permissionOverrides?: PermissionOverrides,
  ): Promise<unknown>
  isConnected(): boolean
  disconnect(): void
  setNotificationHandler(
    handler: (notification: {
      method: string
      params?: Record<string, unknown>
    }) => void,
  ): void
  /** Set permission mode for the current local extension session. */
  setPermissionMode?(
    mode: PermissionMode,
    allowedDomains?: string[],
  ): Promise<void>
}
