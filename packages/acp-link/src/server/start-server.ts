import { getOrCreateCertificate, getLanIPs } from '../cert.js'
import { RcsUpstreamClient } from '../rcs-upstream.js'
import {
  MAX_CLIENT_WS_PAYLOAD_BYTES,
  WsPayloadTooLargeError,
  decodeJsonWsMessage,
  isJsonRpc2Message,
} from '../ws-message.js'
import { authTokensEqual, extractWebSocketAuthToken } from '../ws-auth.js'
import { cancelPendingPermissions } from './acp-client.js'
import { sendJsonRpcError } from './client-send.js'
import { dispatchClientMessage, dispatchJsonRpcMessage } from './dispatch.js'
import { handleDisconnect } from './handlers-agent.js'
import { decodeClientMessage } from './payload-decode.js'
import {
  HEARTBEAT_INTERVAL_MS,
  clients,
  createRelayWs,
  getAuthToken,
  getRcsUpstream,
  logRelay,
  logServer,
  logWs,
  setRcsUpstream,
  setServerConfig,
} from './runtime-state.js'
import {
  JSONRPC_PARSE_ERROR,
  createClientState,
  type ServerConfig,
  type WebSocketPeer,
} from './types.js'

type SocketData = {
  authorized: boolean
}

function selectWebSocketProtocol(header: string | null): string | undefined {
  return header
    ?.split(',')
    .map(value => value.trim())
    .find(Boolean)
}

async function handleSocketMessage(
  ws: WebSocketPeer,
  message: unknown,
): Promise<void> {
  try {
    const decoded = decodeJsonWsMessage(message)
    if (isJsonRpc2Message(decoded)) {
      logWs.debug({ method: decoded.method }, 'received jsonrpc')
      await dispatchJsonRpcMessage(ws, decoded)
    } else {
      const data = decodeClientMessage(decoded)
      logWs.debug({ type: data.type }, 'received')
      await dispatchClientMessage(ws, data)
    }
  } catch (error) {
    if (error instanceof WsPayloadTooLargeError) {
      logWs.warn({ error: error.message }, 'message too large')
      ws.close(1009, 'message too large')
      return
    }
    logWs.error({ error: (error as Error).message }, 'message error')
    const state = clients.get(ws)
    sendJsonRpcError(
      ws,
      state,
      state?.pendingJsonRpc?.id ?? null,
      JSONRPC_PARSE_ERROR,
      `Error: ${(error as Error).message}`,
    )
  }
}

export async function startServer(config: ServerConfig): Promise<void> {
  const { port, host, command, args, cwd, token, https } = config

  setServerConfig({
    command,
    args,
    cwd,
    port,
    host,
    token,
    permissionMode: config.permissionMode || process.env.ACP_PERMISSION_MODE,
  })

  const rcsUrl = process.env.ACP_RCS_URL
  const rcsToken = process.env.ACP_RCS_TOKEN
  const rcsGroup = config.group || process.env.ACP_RCS_GROUP
  if (rcsGroup && !/^[a-zA-Z0-9_-]+$/.test(rcsGroup)) {
    throw new Error(
      `Invalid ACP_RCS_GROUP "${rcsGroup}": only letters, digits, hyphens, and underscores are allowed`,
    )
  }
  let rcsUpstream: RcsUpstreamClient | null = null
  if (rcsUrl) {
    rcsUpstream = new RcsUpstreamClient({
      rcsUrl,
      apiToken: rcsToken || '',
      agentName: command,
      channelGroupId: rcsGroup || undefined,
      maxSessions: 1,
    })

    const relayWs = createRelayWs()
    clients.set(relayWs, createClientState())
    rcsUpstream.setMessageHandler(async message => {
      try {
        if (isJsonRpc2Message(message)) {
          logRelay.debug({ method: message.method }, 'processing jsonrpc')
          await dispatchJsonRpcMessage(relayWs, message)
        } else {
          const data = decodeClientMessage(message)
          logRelay.debug({ type: data.type }, 'processing')
          await dispatchClientMessage(relayWs, data)
        }
      } catch (error) {
        logRelay.error({ error: (error as Error).message }, 'handler error')
      }
    })
    void rcsUpstream.connect().catch(error => {
      logRelay.warn(
        { error: (error as Error).message },
        'initial connection failed',
      )
    })
    logRelay.info({ url: rcsUrl }, 'upstream enabled')
  }
  setRcsUpstream(rcsUpstream)

  const tls = https ? await getOrCreateCertificate() : undefined
  const server = Bun.serve<SocketData>({
    hostname: host,
    port,
    ...(tls ? { tls } : {}),
    fetch(request, bunServer) {
      const url = new URL(request.url)
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok' })
      }
      if (url.pathname !== '/ws') {
        return Response.json({ error: 'not found' }, { status: 404 })
      }

      const expectedToken = getAuthToken()
      const protocolHeader = request.headers.get('Sec-WebSocket-Protocol')
      const providedToken = extractWebSocketAuthToken({
        authorization: request.headers.get('Authorization') ?? undefined,
        protocol: protocolHeader ?? undefined,
      })
      const authorized =
        expectedToken === undefined ||
        authTokensEqual(providedToken, expectedToken)
      const selectedProtocol = selectWebSocketProtocol(protocolHeader)
      const upgraded = bunServer.upgrade(request, {
        data: { authorized },
        ...(selectedProtocol
          ? { headers: { 'Sec-WebSocket-Protocol': selectedProtocol } }
          : {}),
      })
      return upgraded
        ? undefined
        : Response.json({ error: 'websocket upgrade failed' }, { status: 400 })
    },
    websocket: {
      maxPayloadLength: MAX_CLIENT_WS_PAYLOAD_BYTES,
      open(ws) {
        if (!ws.data.authorized) {
          logWs.warn('connection rejected: invalid token')
          ws.close(4001, 'Unauthorized: Invalid token')
          return
        }
        logWs.info('client connected')
        clients.set(ws, createClientState())
      },
      message(ws, message) {
        if (!ws.data.authorized) return
        void handleSocketMessage(ws, message)
      },
      pong(ws) {
        const state = clients.get(ws)
        if (state) state.isAlive = true
      },
      close(ws) {
        if (!clients.has(ws)) return
        logWs.info('client disconnected')
        const state = clients.get(ws)
        if (state) cancelPendingPermissions(state)
        handleDisconnect(ws)
        clients.delete(ws)
      },
    },
  })

  const heartbeat = setInterval(() => {
    for (const [ws, state] of clients) {
      if (ws.isVirtual) continue
      if (!ws.ping || !ws.terminate) {
        clients.delete(ws)
        continue
      }
      if (!state.isAlive) {
        logWs.info('heartbeat timeout, terminating')
        ws.terminate()
        continue
      }
      state.isAlive = false
      ws.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)

  const wsProtocol = https ? 'wss' : 'ws'
  let displayHost = host
  if (host === '0.0.0.0') {
    displayHost = getLanIPs()[0] || 'localhost'
  }
  const actualPort = server.port
  const localWsUrl = `${wsProtocol}://localhost:${actualPort}/ws`
  const networkWsUrl = `${wsProtocol}://${displayHost}:${actualPort}/ws`

  console.log()
  console.log(`  🚀 ACP Proxy Server${https ? ' (HTTPS)' : ''}`)
  console.log()
  console.log(`  Connection:`)
  console.log(`    URL:   ${host === '0.0.0.0' ? networkWsUrl : localWsUrl}`)
  if (token) console.log(`    Token: configured`)
  console.log()
  if (!token) {
    console.log(`  ⚠️  Authentication disabled (--no-auth)`)
    console.log()
  }
  const agentDisplay =
    args.length > 0 ? `${command} ${args.join(' ')}` : command
  console.log(`  📦 Agent: ${agentDisplay}`)
  console.log(`     CWD:   ${cwd}`)
  console.log()
  console.log(`  Press Ctrl+C to stop`)
  console.log()

  logServer.info(
    {
      port: actualPort,
      host,
      https,
      wsEndpoint: `${wsProtocol}://${displayHost}:${actualPort}/ws`,
      agent: command,
      agentArgs: args,
      cwd,
      authEnabled: !!token,
    },
    'started',
  )

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(heartbeat)
    for (const ws of clients.keys()) {
      if (!ws.isVirtual) {
        handleDisconnect(ws)
        ws.close(1001, 'server shutdown')
      }
    }
    clients.clear()
    const upstream = getRcsUpstream()
    if (upstream) await upstream.close()
    await server.stop(true)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise(() => {})
}
