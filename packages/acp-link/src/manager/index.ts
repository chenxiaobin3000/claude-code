import { ProcessManager } from './manager.js'
import { createApp } from './routes.js'

export async function startManager(port: number): Promise<void> {
  const manager = new ProcessManager()
  const app = createApp(manager)
  app.get('/health', c => c.json({ status: 'ok' }))

  let server: Bun.Server<undefined>
  try {
    server = Bun.serve({ fetch: app.fetch, port })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('EADDRINUSE') || message.includes('in use')) {
      console.error(
        `\n  Error: port ${port} is already in use. Use --port to specify a different port.\n`,
      )
    } else {
      console.error(`\n  Error: ${message}\n`)
    }
    process.exit(1)
  }

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('Shutting down...')
    await manager.shutdownAll()
    await server.stop(true)
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  console.log()
  console.log(`  🖥️  ACP Manager`)
  console.log()
  console.log(`    URL:   http://localhost:${server.port}`)
  console.log()
  console.log(`  Press Ctrl+C to stop`)
  console.log()

  await new Promise(() => {})
}
