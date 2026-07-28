export type McpHookInvocation = {
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  signal: AbortSignal
}

/**
 * Supplied by the normal tool execution layer so hooks cannot bypass MCP
 * discovery, input validation, or the active permission policy.
 */
export type InvokeMcpHookTool = (
  invocation: McpHookInvocation,
) => Promise<unknown>
