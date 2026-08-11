#!/usr/bin/env bun

import * as acp from '@agentclientprotocol/sdk'

const sink = Bun.stdout.writer()
const input = new WritableStream<Uint8Array>({
  async write(chunk) {
    sink.write(chunk)
    await sink.flush()
  },
  close() {
    sink.end()
  },
  abort() {
    sink.end()
  },
})
const output = Bun.stdin.stream()
const stream = acp.ndJsonStream(input, output)

new acp.AgentSideConnection(
  connection => ({
    async initialize() {
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentInfo: { name: 'acp-link-fixture', version: '1.0.0' },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false },
        },
      }
    },
    async newSession() {
      return { sessionId: 'fixture-session' }
    },
    async authenticate() {
      return {}
    },
    async prompt(params) {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'fixture-output' },
        },
      })
      const permission = await connection.requestPermission({
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: 'fixture-tool',
          title: 'Fixture permission',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'fixture' },
        },
        options: [
          {
            optionId: 'allow',
            name: 'Allow fixture',
            kind: 'allow_once',
          },
        ],
      })
      if (
        permission.outcome.outcome !== 'selected' ||
        permission.outcome.optionId !== 'allow'
      ) {
        throw new Error('fixture permission was not relayed')
      }
      return { stopReason: 'end_turn' }
    },
    async cancel() {},
  }),
  stream,
)
