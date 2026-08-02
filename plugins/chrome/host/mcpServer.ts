import {
  createClaudeForChromeMcpServer,
  type Logger,
  type LoggerDetail,
} from '../mcp/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { format } from 'node:util'
import { getAvailableSocketEndpoints } from './paths.js'

class StderrLogger implements Logger {
  silly(message: string, detail?: LoggerDetail): void {
    this.write('debug', message, detail)
  }

  debug(message: string, detail?: LoggerDetail): void {
    this.write('debug', message, detail)
  }

  info(message: string, detail?: LoggerDetail): void {
    this.write('info', message, detail)
  }

  warn(message: string, detail?: LoggerDetail): void {
    this.write('warn', message, detail)
  }

  error(message: string, detail?: LoggerDetail): void {
    this.write('error', message, detail)
  }

  private write(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    detail?: LoggerDetail,
  ): void {
    const suffix = detail ? ` ${format(detail)}` : ''
    console.error(`[chrome:${level}] ${message}${suffix}`)
  }
}

export async function runChromeMcpServer(): Promise<void> {
  const logger = new StderrLogger()
  const server = createClaudeForChromeMcpServer({
    serverName: 'claude-in-chrome',
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
    await server.close().catch(error => {
      logger.warn('Failed to close MCP server cleanly', error as Error)
    })
  }
  process.stdin.once('end', () => void close())
  process.stdin.once('error', () => void close())

  await server.connect(transport)
}
