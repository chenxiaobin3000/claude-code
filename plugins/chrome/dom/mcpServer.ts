import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { randomBytes } from 'node:crypto'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { createChromeSocketClient } from '../mcp/mcpServer.js'
import type { ClaudeForChromeContext, SocketClient } from '../mcp/types.js'
import { handleChromeDomToolCall } from './toolCalls.js'
import { CHROME_DOM_TOOLS } from './tools.js'

export interface ChromeDomMcpServer {
  server: Server
  socketClient: SocketClient
}

/**
 * Create the read-only DOM MCP server beside the existing browser-control MCP.
 *
 * The dedicated server owns a plugin-local socket pool so DOM bridge methods
 * reuse endpoint discovery, authentication, profile, and tab routing without
 * nesting one MCP server inside another.
 */
export function createChromeDomMcpServer(
  context: ClaudeForChromeContext,
  existingSocketClient?: SocketClient,
): ChromeDomMcpServer {
  const socketClient = existingSocketClient ?? createChromeSocketClient(context)
  const cursorSecret = randomBytes(32).toString('hex')
  const server = new Server(
    {
      name: context.serverName,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: context.isDisabled?.() ? [] : [...CHROME_DOM_TOOLS],
  }))
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> =>
      handleChromeDomToolCall(
        context,
        socketClient,
        request.params.name,
        request.params.arguments ?? {},
        { cursorSecret },
      ),
  )

  return { server, socketClient }
}
