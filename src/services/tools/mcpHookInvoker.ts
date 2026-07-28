import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import type { InvokeMcpHookTool } from '../../utils/hooks/mcpHook.js'
import { formatZodValidationError } from '../../utils/toolErrors.js'
import { isMcpTool } from '../mcp/utils.js'
import { resolveHookPermissionDecision } from './toolHooks.js'

export function createMcpHookInvoker(
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
): InvokeMcpHookTool {
  return async ({ toolName, input, toolUseId, signal }) => {
    const targetTool = findToolByName(toolUseContext.options.tools, toolName)
    if (!targetTool || !isMcpTool(targetTool)) {
      throw new Error(`MCP hook tool is unavailable: ${toolName}`)
    }
    const parsed = targetTool.inputSchema.safeParse(input)
    if (!parsed.success) {
      throw new Error(
        `Invalid input for MCP hook tool ${toolName}: ${formatZodValidationError(toolName, parsed.error)}`,
      )
    }
    const resolved = await resolveHookPermissionDecision(
      undefined,
      targetTool,
      parsed.data,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseId,
    )
    if (resolved.decision.behavior !== 'allow') {
      throw new Error(
        resolved.decision.message ||
          `Permission denied for MCP hook tool ${toolName}`,
      )
    }
    const abortController = new AbortController()
    if (signal.aborted) abortController.abort(signal.reason)
    else
      signal.addEventListener(
        'abort',
        () => abortController.abort(signal.reason),
        { once: true },
      )
    const result = await targetTool.call(
      resolved.input,
      {
        ...toolUseContext,
        abortController,
        toolUseId,
        userModified: resolved.decision.userModified ?? false,
      },
      canUseTool,
      assistantMessage,
    )
    return result.data
  }
}
