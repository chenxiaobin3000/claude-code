import * as acp from '@agentclientprotocol/sdk'
import { send, sendJsonRpcError } from './client-send.js'
import { cancelPendingPermissions, createClient } from './acp-client.js'
import { buildAgentEnv } from './permission-mode.js'
import { clients, getAgentConfig, logAgent } from './runtime-state.js'
import {
  JSONRPC_INTERNAL_ERROR,
  type AgentSubprocess,
  type AgentCapabilities,
  type ClientState,
  type WebSocketPeer,
} from './types.js'

export async function handleConnect(ws: WebSocketPeer): Promise<void> {
  const state = clients.get(ws)
  if (!state) return

  const {
    command: AGENT_COMMAND,
    args: AGENT_ARGS,
    cwd: AGENT_CWD,
  } = getAgentConfig()

  // If already connected to a running agent, just resend status
  // This handles frontend reconnections without restarting the agent process
  // Check both .killed and .exitCode to detect crashed processes
  if (
    state.connection &&
    state.process &&
    !state.process.killed &&
    state.process.exitCode === null
  ) {
    logAgent.info('already connected, resending status')
    send(ws, 'status', {
      connected: true,
      agentInfo: state.agentInfo ?? { name: AGENT_COMMAND },
      capabilities: state.agentCapabilities,
      protocolVersion: state.protocolVersion,
    })
    return
  }

  // Kill existing process if any (only if not healthy)
  if (state.process) {
    cancelPendingPermissions(state)
    state.process.kill()
    state.process = null
    state.connection = null
  }

  try {
    logAgent.info({ command: AGENT_COMMAND, args: AGENT_ARGS }, 'spawning')

    const agentProcess = Bun.spawn([AGENT_COMMAND, ...AGENT_ARGS], {
      cwd: AGENT_CWD,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
      env: buildAgentEnv(),
    }) as unknown as AgentSubprocess

    state.process = agentProcess

    // Clean up state when agent process exits unexpectedly
    void agentProcess.exited.then(code => {
      logAgent.info({ exitCode: code }, 'agent process exited')
      // Only clear if this is still the current process
      if (state.process === agentProcess) {
        state.process = null
        state.connection = null
        state.sessionId = null
      }
    })

    const input = new WritableStream<Uint8Array>({
      async write(chunk) {
        agentProcess.stdin.write(chunk)
        await agentProcess.stdin.flush()
      },
      close() {
        agentProcess.stdin.end()
      },
      abort() {
        agentProcess.stdin.end()
      },
    })
    const output = agentProcess.stdout

    const stream = acp.ndJsonStream(input, output)
    const connection = new acp.ClientSideConnection(
      _agent => createClient(ws, state),
      stream,
    )

    state.connection = connection

    const initResult = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      // Forward the real client identity/capabilities (audit §8.7). Falls back
      // to the Zed defaults only when the client did not provide any.
      clientInfo: state.clientInfo,
      clientCapabilities: state.clientCapabilities,
    })

    // Pass the raw agentCapabilities through unchanged so present and future
    // capability fields (auth, terminal, ...) reach the client (audit §8.6).
    const agentCaps = initResult.agentCapabilities
    state.agentCapabilities = (agentCaps as AgentCapabilities | null) ?? null
    state.promptCapabilities = agentCaps?.promptCapabilities ?? null
    // Remember the negotiated protocolVersion + agentInfo so reconnects and
    // JSON-RPC initialize responses can forward them to the client (§8.13).
    state.protocolVersion = initResult.protocolVersion
    state.agentInfo =
      (initResult.agentInfo as ClientState['agentInfo'] | null | undefined) ??
      null

    logAgent.info(
      {
        protocolVersion: initResult.protocolVersion,
        loadSession: !!state.agentCapabilities?.loadSession,
        sessionList: !!state.agentCapabilities?.sessionCapabilities?.list,
        sessionResume: !!state.agentCapabilities?.sessionCapabilities?.resume,
        hasMcp: !!state.agentCapabilities?.mcpCapabilities,
      },
      'initialized',
    )

    send(ws, 'status', {
      connected: true,
      agentInfo: initResult.agentInfo,
      capabilities: state.agentCapabilities,
      // Surface the negotiated protocolVersion to downstream clients (audit §8.13).
      protocolVersion: initResult.protocolVersion,
    })

    connection.closed.then(() => {
      logAgent.info('connection closed')
      state.connection = null
      state.sessionId = null
      send(ws, 'status', { connected: false })
    })
  } catch (error) {
    logAgent.error({ error: (error as Error).message }, 'connect failed')
    sendJsonRpcError(
      ws,
      state,
      null,
      JSONRPC_INTERNAL_ERROR,
      `Failed to connect: ${(error as Error).message}`,
    )
  }
}

export function handleDisconnect(ws: WebSocketPeer): void {
  const state = clients.get(ws)
  if (!state) return

  if (state.process) {
    state.process.kill()
    state.process = null
  }
  state.connection = null
  state.sessionId = null

  send(ws, 'status', { connected: false })
}
