import {
  type ClaudeForChromeContext,
  createClaudeForChromeMcpServer,
  type Logger,
  type LoggerDetail,
  type PermissionMode,
} from '@ant/claude-for-chrome-mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { format } from 'util'
import { enableConfigs } from '../config.js'
import { logForDebugging } from '../debug.js'
import { sideQuery } from '../sideQuery.js'
import { getAllSocketPaths, getSecureSocketPath } from './common.js'

const PERMISSION_MODES: readonly PermissionMode[] = [
  'ask',
  'skip_all_permission_checks',
  'follow_a_plan',
]

function isPermissionMode(raw: string): raw is PermissionMode {
  return PERMISSION_MODES.some(m => m === raw)
}

/**
 * Build the ClaudeForChromeContext used by both the subprocess MCP server
 * and the in-process path in the MCP client.
 */
export function createChromeContext(
  env?: Record<string, string>,
): ClaudeForChromeContext {
  const logger = new DebugLogger()
  logger.info('Using local native socket')
  const rawPermissionMode =
    env?.CLAUDE_CHROME_PERMISSION_MODE ??
    process.env.CLAUDE_CHROME_PERMISSION_MODE
  let initialPermissionMode: PermissionMode | undefined
  if (rawPermissionMode) {
    if (isPermissionMode(rawPermissionMode)) {
      initialPermissionMode = rawPermissionMode
    } else {
      logger.warn(
        `Invalid CLAUDE_CHROME_PERMISSION_MODE "${rawPermissionMode}". Valid values: ${PERMISSION_MODES.join(', ')}`,
      )
    }
  }
  return {
    serverName: 'Claude in Chrome',
    logger,
    socketPath: getSecureSocketPath(),
    getSocketPaths: getAllSocketPaths,
    clientTypeId: 'claude-code',
    onAuthenticationError: () => {
      logger.warn(
        'Local browser extension authentication failed.',
      )
    },
    onToolCallDisconnected: () => {
      return 'Browser extension is not connected. Ensure the local extension and native messaging host are installed and running.'
    },
    ...(initialPermissionMode && { initialPermissionMode }),
    // Wire inference for the browser_task tool — the chrome-mcp server runs
    // a lightning-mode agent loop in Node and calls the extension's
    // lightning_turn tool once per iteration for execution.
    //
    // Ant-only: the extension's lightning_turn is build-time-gated via
    // import.meta.env.ANT_ONLY_BUILD — the whole lightning/ module graph is
    // tree-shaken from the public extension build (build:prod greps for a
    // marker to verify). Without this injection, the Node MCP server's
    // ListTools also filters browser_task + lightning_turn out, so external
    // users never see the tools advertised. Three independent gates.
    //
    // Types inlined: AnthropicMessagesRequest/Response live in
    // @ant/claude-for-chrome-mcp@0.4.0 which isn't published yet. CI installs
    // 0.3.0. The callAnthropicMessages field is also 0.4.0-only, but spreading
    // an extra property into ClaudeForChromeContext is fine against either
    // version — 0.3.0 sees an unknown field (allowed in spread), 0.4.0 sees a
    // structurally-matching one. Once 0.4.0 is published, this can switch to
    // the package's exported types and the dep can be bumped.
    ...(process.env.USER_TYPE === 'ant' && {
      callAnthropicMessages: async (req: {
        model: string
        max_tokens: number
        system: string
        messages: Parameters<typeof sideQuery>[0]['messages']
        stop_sequences?: string[]
        signal?: AbortSignal
      }): Promise<{
        content: Array<{ type: 'text'; text: string }>
        stop_reason: string | null
        usage?: { input_tokens: number; output_tokens: number }
      }> => {
        // sideQuery handles OAuth attribution fingerprint, proxy, model betas.
        // skipSystemPromptPrefix: the lightning prompt is complete on its own;
        // the CLI prefix would dilute the batching instructions.
        // tools: [] is load-bearing — without it Sonnet emits
        // <function_calls> XML before the text commands. Original
        // lightning-harness.js (apps repo) does the same.
        const response = await sideQuery({
          model: req.model,
          system: req.system,
          messages: req.messages,
          max_tokens: req.max_tokens,
          stop_sequences: req.stop_sequences,
          signal: req.signal,
          skipSystemPromptPrefix: true,
          tools: [],
          querySource: 'chrome_mcp',
        })
        // BetaContentBlock is TextBlock | ThinkingBlock | ToolUseBlock | ...
        // Only text blocks carry the model's command output.
        const textBlocks: Array<{ type: 'text'; text: string }> = []
        for (const b of response.content) {
          if (b.type === 'text') {
            textBlocks.push({ type: 'text', text: b.text })
          }
        }
        return {
          content: textBlocks,
          stop_reason: response.stop_reason,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
        }
      },
    }),
  }
}

export async function runClaudeInChromeMcpServer(): Promise<void> {
  enableConfigs()
  const context = createChromeContext()

  const server = createClaudeForChromeMcpServer(context)
  const transport = new StdioServerTransport()

  // Exit when parent process dies (stdin pipe closes).
  // Flush analytics before exiting so final-batch events (e.g. disconnect) aren't lost.
  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) {
      return
    }
    exiting = true
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())

  logForDebugging('[Claude in Chrome] Starting MCP server')
  await server.connect(transport)
  logForDebugging('[Claude in Chrome] MCP server started')
}

class DebugLogger implements Logger {
  silly(message: string, detail?: LoggerDetail): void {
    logForDebugging(format(message, detail ?? ''), { level: 'debug' })
  }
  debug(message: string, detail?: LoggerDetail): void {
    logForDebugging(format(message, detail ?? ''), { level: 'debug' })
  }
  info(message: string, detail?: LoggerDetail): void {
    logForDebugging(format(message, detail ?? ''), { level: 'info' })
  }
  warn(message: string, detail?: LoggerDetail): void {
    logForDebugging(format(message, detail ?? ''), { level: 'warn' })
  }
  error(message: string, detail?: LoggerDetail): void {
    logForDebugging(format(message, detail ?? ''), { level: 'error' })
  }
}
