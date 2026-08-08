import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createChromeDomMcpServer } from '../dom/index.js'
import { StderrLogger } from './mcpServer.js'
import { getAvailableSocketEndpoints } from './paths.js'

export async function runChromeDomMcpServer(): Promise<void> {
  const logger = new StderrLogger()
  const { server, socketClient } = createChromeDomMcpServer({
    serverName: 'chrome-dom',
    logger,
    getEndpoints: getAvailableSocketEndpoints,
    clientTypeId: 'claude-code',
    onAuthenticationError: () => {
      logger.warn('Unexpected authentication error from local Chrome bridge')
    },
    onToolCallDisconnected: () =>
      'Chrome extension is not connected. Register the chrome Native Host, load the local extension, and try again.',
  })
  const transport = new StdioServerTransport()

  let closing = false
  const close = async (): Promise<void> => {
    if (closing) return
    closing = true
    socketClient.disconnect()
    await server.close().catch(error => {
      logger.warn(
        'Failed to close Chrome DOM MCP server cleanly',
        error as Error,
      )
    })
  }
  process.stdin.once('end', () => void close())
  process.stdin.once('error', () => void close())

  await server.connect(transport)
}
