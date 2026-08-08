import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

export async function runOpenAIProxyMcp(version: string): Promise<void> {
  const server = new Server(
    { name: 'openai-proxy', version },
    { capabilities: {} },
  )
  const transport = new StdioServerTransport()
  try {
    await server.connect(transport)
    await new Promise<void>(resolve => {
      process.stdin.once('end', resolve)
      process.stdin.once('close', resolve)
    })
  } finally {
    await server.close().catch(() => undefined)
  }
}
