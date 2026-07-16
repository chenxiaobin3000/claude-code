import { feature } from 'bun:bundle'
import { Option } from '@commander-js/extra-typings'
import { getBaseRenderOptions } from '../../utils/renderOptions.js'

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () =>
  require('../../utils/teammate.js') as typeof import('../../utils/teammate.js')
const getTeammatePromptAddendum = () =>
  require('../../utils/swarm/teammatePromptAddendum.js') as typeof import('../../utils/swarm/teammatePromptAddendum.js')
const getTeammateModeSnapshot = () =>
  require('../../utils/swarm/backends/teammateModeSnapshot.js') as typeof import('../../utils/swarm/backends/teammateModeSnapshot.js')
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for COORDINATOR_MODE
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../../coordinator/coordinatorMode.js') as typeof import('../../coordinator/coordinatorMode.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for KAIROS (assistant mode)
/* eslint-disable @typescript-eslint/no-require-imports */
const assistantModule = feature('KAIROS')
  ? (require('../../assistant/index.js') as typeof import('../../assistant/index.js'))
  : null
const kairosGate = feature('KAIROS')
  ? (require('../../assistant/gate.js') as typeof import('../../assistant/gate.js'))
  : null

import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  VALID_INSTALLABLE_SCOPES,
  VALID_UPDATE_SCOPES,
} from '../../services/plugins/pluginCliCommands.js'
import { getAutoModeEnabledStateIfCached } from '../../utils/permissions/permissionSetup.js'
import { TASK_STATUSES } from '../../utils/tasks.js'
import { validateUuid } from '../../utils/uuid.js'
// Plugin startup checks are now handled non-blockingly in REPL.tsx

import { registerMcpAddCommand } from 'src/commands/mcp/addCommand.js'
import { registerMcpXaaIdpCommand } from 'src/commands/mcp/xaaIdpCommand.js'
import { isXaaEnabled } from 'src/services/mcp/xaaIdpLogin.js'
import {
  setCwdState,
  setDirectConnectServerUrl,
  setOriginalCwd,
} from '../../bootstrap/state.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

import { createSortedHelpConfig } from '../../cli/arguments/createProgram.js'
/* eslint-enable @typescript-eslint/no-require-imports */
// teleportWithProgress dynamically imported at call site
import {
  createDirectConnectSession,
  DirectConnectError,
} from '../../server/createDirectConnectSession.js'

export interface SubcommandRegistrationDependencies {
  isSshRemoteEnabled: () => boolean
  pendingConnect?: { dangerouslySkipPermissions: boolean }
}

export function registerSubcommands(
  program: any,
  dependencies: SubcommandRegistrationDependencies,
): void {
  const { isSshRemoteEnabled, pendingConnect: _pendingConnect } = dependencies
  // claude mcp

  const mcp = program
    .command('mcp')
    .description('Configure and manage MCP servers')
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions()

  mcp
    .command('serve')
    .description(`Start the Claude Code MCP server`)
    .option('-d, --debug', 'Enable debug mode', () => true)
    .option(
      '--verbose',
      'Override verbose mode setting from config',
      () => true,
    )
    .action(
      async ({ debug, verbose }: { debug?: boolean; verbose?: boolean }) => {
        const { mcpServeHandler } = await import('../../cli/handlers/mcp.js')
        await mcpServeHandler({ debug, verbose })
      },
    )

  // Register the mcp add subcommand (extracted for testability)
  registerMcpAddCommand(mcp)

  if (isXaaEnabled()) {
    registerMcpXaaIdpCommand(mcp)
  }

  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project) - if not specified, removes from whichever scope it exists in',
    )
    .action(async (name: string, options: { scope?: string }) => {
      const { mcpRemoveHandler } = await import('../../cli/handlers/mcp.js')
      await mcpRemoveHandler(name, options)
    })

  mcp
    .command('list')
    .description(
      'List configured MCP servers. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async () => {
      const { mcpListHandler } = await import('../../cli/handlers/mcp.js')
      await mcpListHandler()
    })

  mcp
    .command('get <name>')
    .description(
      'Get details about an MCP server. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async (name: string) => {
      const { mcpGetHandler } = await import('../../cli/handlers/mcp.js')
      await mcpGetHandler(name)
    })

  mcp
    .command('add-json <name> <json>')
    .description('Add an MCP server (stdio or SSE) with a JSON string')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
    )
    .action(
      async (
        name: string,
        json: string,
        options: { scope?: string; clientSecret?: true },
      ) => {
        const { mcpAddJsonHandler } = await import('../../cli/handlers/mcp.js')
        await mcpAddJsonHandler(name, json, options)
      },
    )

  mcp
    .command('add-from-claude-desktop')
    .description('Import MCP servers from Claude Desktop (Mac and WSL only)')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .action(async (options: { scope?: string }) => {
      const { mcpAddFromDesktopHandler } = await import(
        '../../cli/handlers/mcp.js'
      )
      await mcpAddFromDesktopHandler(options)
    })

  mcp
    .command('reset-project-choices')
    .description(
      'Reset all approved and rejected project-scoped (.mcp.json) servers within this project',
    )
    .action(async () => {
      const { mcpResetChoicesHandler } = await import(
        '../../cli/handlers/mcp.js'
      )
      await mcpResetChoicesHandler()
    })

  // claude server
  if (feature('DIRECT_CONNECT')) {
    program
      .command('server')
      .description('Start a Claude Code session server')
      .option('--port <number>', 'HTTP port', '0')
      .option('--host <string>', 'Bind address', '0.0.0.0')
      .option('--auth-token <token>', 'Bearer token for auth')
      .option('--unix <path>', 'Listen on a unix domain socket')
      .option(
        '--workspace <dir>',
        'Default working directory for sessions that do not specify cwd',
      )
      .option(
        '--idle-timeout <ms>',
        'Idle timeout for detached sessions in ms (0 = never expire)',
        '600000',
      )
      .option(
        '--max-sessions <n>',
        'Maximum concurrent sessions (0 = unlimited)',
        '32',
      )
      .action(
        async (opts: {
          port: string
          host: string
          authToken?: string
          unix?: string
          workspace?: string
          idleTimeout: string
          maxSessions: string
        }) => {
          const { randomBytes } = await import('crypto')
          const { startServer } = await import('../../server/server.js')
          const { SessionManager } = await import(
            '../../server/sessionManager.js'
          )
          const { DangerousBackend } = await import(
            '../../server/backends/dangerousBackend.js'
          )
          const { printBanner } = await import('../../server/serverBanner.js')
          const { createServerLogger } = await import(
            '../../server/serverLog.js'
          )
          const { writeServerLock, removeServerLock, probeRunningServer } =
            await import('../../server/lockfile.js')

          const existing = await probeRunningServer()
          if (existing) {
            process.stderr.write(
              `A claude server is already running (pid ${existing.pid}) at ${existing.httpUrl}\n`,
            )
            process.exit(1)
          }

          const authToken =
            opts.authToken ??
            `sk-ant-cc-${randomBytes(16).toString('base64url')}`

          const config = {
            port: parseInt(opts.port, 10),
            host: opts.host,
            authToken,
            unix: opts.unix,
            workspace: opts.workspace,
            idleTimeoutMs: parseInt(opts.idleTimeout, 10),
            maxSessions: parseInt(opts.maxSessions, 10),
          }

          const backend = new DangerousBackend()
          const sessionManager = new SessionManager(backend, {
            idleTimeoutMs: config.idleTimeoutMs,
            maxSessions: config.maxSessions,
          })
          const logger = createServerLogger()

          const server = startServer(config, sessionManager, logger)
          const actualPort = server.port ?? config.port
          printBanner(config, authToken, actualPort)

          await writeServerLock({
            pid: process.pid,
            port: actualPort,
            host: config.host,
            httpUrl: config.unix
              ? `unix:${config.unix}`
              : `http://${config.host}:${actualPort}`,
            startedAt: Date.now(),
          })

          let shuttingDown = false
          const shutdown = async () => {
            if (shuttingDown) return
            shuttingDown = true
            // Stop accepting new connections before tearing down sessions.
            server.stop(true)
            await sessionManager.destroyAll()
            await removeServerLock()
            process.exit(0)
          }
          process.once('SIGINT', () => void shutdown())
          process.once('SIGTERM', () => void shutdown())
        },
      )
  }

  // `claude ssh <host> [dir]` — registered here only so --help shows it.
  // The actual interactive flow is handled by early argv rewriting in main()
  // (parallels the DIRECT_CONNECT/cc:// pattern above). If commander reaches
  // this action it means the argv rewrite didn't fire (e.g. user ran
  // `claude ssh` with no host) — just print usage.
  if (isSshRemoteEnabled()) {
    program
      .command('ssh <host> [dir]')
      .description(
        'Run Claude Code on a remote host over SSH. Deploys the binary and ' +
          'tunnels API auth back through your local machine — no remote setup needed.',
      )
      .option(
        '--permission-mode <mode>',
        'Permission mode for the remote session',
      )
      .option(
        '--dangerously-skip-permissions',
        'Skip all permission prompts on the remote (dangerous)',
      )
      .option(
        '--remote-bin <command>',
        'Custom remote binary command (skips probe/deploy). ' +
          "Example: --remote-bin 'bun /path/to/project/dist/cli.js'",
      )
      .option(
        '--local',
        'e2e test mode — spawn the child CLI locally (skip ssh/deploy). ' +
          'Exercises the auth proxy and unix-socket plumbing without a remote host.',
      )
      .action(async () => {
        // Argv rewriting in main() should have consumed `ssh <host>` before
        // commander runs. Reaching here means host was missing or the
        // rewrite predicate didn't match.
        process.stderr.write(
          'Usage: claude ssh <user@host | ssh-config-alias> [dir]\n\n' +
            "Runs Claude Code on a remote Linux host. You don't need to install\n" +
            'anything on the remote or run `claude auth login` there — the binary is\n' +
            'deployed over SSH and API auth tunnels back through your local machine.\n',
        )
        process.exit(1)
      })
  }

  // claude connect — subcommand only handles -p (headless) mode.
  // Interactive mode (without -p) is handled by early argv rewriting in main()
  // which redirects to the main command with full TUI support.
  if (feature('DIRECT_CONNECT')) {
    program
      .command('open <cc-url>')
      .description(
        'Connect to a Claude Code server (internal — use cc:// URLs)',
      )
      .option('-p, --print [prompt]', 'Print mode (headless)')
      .option(
        '--output-format <format>',
        'Output format: text, json, stream-json',
        'text',
      )
      .action(
        async (
          ccUrl: string,
          opts: {
            print?: string | true
            outputFormat?: string
          },
        ) => {
          const { parseConnectUrl } = await import(
            '../../server/parseConnectUrl.js'
          )
          const { serverUrl, authToken } = parseConnectUrl(ccUrl)

          let connectConfig
          try {
            const session = await createDirectConnectSession({
              serverUrl,
              authToken,
              cwd: getOriginalCwd(),
              dangerouslySkipPermissions:
                _pendingConnect?.dangerouslySkipPermissions,
            })
            if (session.workDir) {
              setOriginalCwd(session.workDir)
              setCwdState(session.workDir)
            }
            setDirectConnectServerUrl(serverUrl)
            connectConfig = session.config
          } catch (err) {
            console.error(
              err instanceof DirectConnectError ? err.message : String(err),
            )
            process.exit(1)
          }

          const { runConnectHeadless } = await import(
            '../../server/connectHeadless.js'
          )

          const prompt = typeof opts.print === 'string' ? opts.print : ''
          const interactive = opts.print === true
          await runConnectHeadless(
            connectConfig,
            prompt,
            opts.outputFormat,
            interactive,
          )
        },
      )
  }

  /**
   * Helper function to handle marketplace command errors consistently.
   * Logs the error and exits the process with status 1.
   * @param error The error that occurred
   * @param action Description of the action that failed
   */
  // Hidden flag on all plugin/marketplace subcommands to target cowork_plugins.
  const coworkOption = () =>
    new Option('--cowork', 'Use cowork_plugins directory').hideHelp()

  // Plugin validate command
  const pluginCmd = program
    .command('plugin')
    .alias('plugins')
    .description('Manage Claude Code plugins')
    .configureHelp(createSortedHelpConfig())

  pluginCmd
    .command('validate <path>')
    .description('Validate a plugin or marketplace manifest')
    .addOption(coworkOption())
    .action(async (manifestPath: string, options: { cowork?: boolean }) => {
      const { pluginValidateHandler } = await import(
        '../../cli/handlers/plugins.js'
      )
      await pluginValidateHandler(manifestPath, options)
    })

  // Plugin list command
  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('--json', 'Output as JSON')
    .option(
      '--available',
      'Include available plugins from marketplaces (requires --json)',
    )
    .addOption(coworkOption())
    .action(
      async (options: {
        json?: boolean
        available?: boolean
        cowork?: boolean
      }) => {
        const { pluginListHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await pluginListHandler(options)
      },
    )

  // Marketplace subcommands
  const marketplaceCmd = pluginCmd
    .command('marketplace')
    .description('Manage Claude Code marketplaces')
    .configureHelp(createSortedHelpConfig())

  marketplaceCmd
    .command('add <source>')
    .description('Add a marketplace from a URL, path, or GitHub repo')
    .addOption(coworkOption())
    .option(
      '--sparse <paths...>',
      'Limit checkout to specific directories via git sparse-checkout (for monorepos). Example: --sparse .claude-plugin plugins',
    )
    .option(
      '--scope <scope>',
      'Where to declare the marketplace: user (default), project, or local',
    )
    .action(
      async (
        source: string,
        options: {
          cowork?: boolean
          sparse?: string[]
          scope?: string
        },
      ) => {
        const { marketplaceAddHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await marketplaceAddHandler(source, options)
      },
    )

  marketplaceCmd
    .command('list')
    .description('List all configured marketplaces')
    .option('--json', 'Output as JSON')
    .addOption(coworkOption())
    .action(async (options: { json?: boolean; cowork?: boolean }) => {
      const { marketplaceListHandler } = await import(
        '../../cli/handlers/plugins.js'
      )
      await marketplaceListHandler(options)
    })

  marketplaceCmd
    .command('remove <name>')
    .alias('rm')
    .description('Remove a configured marketplace')
    .addOption(coworkOption())
    .action(async (name: string, options: { cowork?: boolean }) => {
      const { marketplaceRemoveHandler } = await import(
        '../../cli/handlers/plugins.js'
      )
      await marketplaceRemoveHandler(name, options)
    })

  marketplaceCmd
    .command('update [name]')
    .description(
      'Update marketplace(s) from their source - updates all if no name specified',
    )
    .addOption(coworkOption())
    .action(async (name: string | undefined, options: { cowork?: boolean }) => {
      const { marketplaceUpdateHandler } = await import(
        '../../cli/handlers/plugins.js'
      )
      await marketplaceUpdateHandler(name, options)
    })

  // Plugin install command
  pluginCmd
    .command('install <plugin>')
    .alias('i')
    .description(
      'Install a plugin from available marketplaces (use plugin@marketplace for specific marketplace)',
    )
    .option(
      '-s, --scope <scope>',
      'Installation scope: user, project, or local',
      'user',
    )
    .addOption(coworkOption())
    .action(
      async (plugin: string, options: { scope?: string; cowork?: boolean }) => {
        const { pluginInstallHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await pluginInstallHandler(plugin, options)
      },
    )

  // Plugin uninstall command
  pluginCmd
    .command('uninstall <plugin>')
    .alias('remove')
    .alias('rm')
    .description('Uninstall an installed plugin')
    .option(
      '-s, --scope <scope>',
      'Uninstall from scope: user, project, or local',
      'user',
    )
    .option(
      '--keep-data',
      "Preserve the plugin's persistent data directory (~/.claude/plugins/data/{id}/)",
    )
    .addOption(coworkOption())
    .action(
      async (
        plugin: string,
        options: {
          scope?: string
          cowork?: boolean
          keepData?: boolean
        },
      ) => {
        const { pluginUninstallHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await pluginUninstallHandler(plugin, options)
      },
    )

  // Plugin enable command
  pluginCmd
    .command('enable <plugin>')
    .description('Enable a disabled plugin')
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${VALID_INSTALLABLE_SCOPES.join(', ')} (default: auto-detect)`,
    )
    .addOption(coworkOption())
    .action(
      async (plugin: string, options: { scope?: string; cowork?: boolean }) => {
        const { pluginEnableHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await pluginEnableHandler(plugin, options)
      },
    )

  // Plugin disable command
  pluginCmd
    .command('disable [plugin]')
    .description('Disable an enabled plugin')
    .option('-a, --all', 'Disable all enabled plugins')
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${VALID_INSTALLABLE_SCOPES.join(', ')} (default: auto-detect)`,
    )
    .addOption(coworkOption())
    .action(
      async (
        plugin: string | undefined,
        options: { scope?: string; cowork?: boolean; all?: boolean },
      ) => {
        const { pluginDisableHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await pluginDisableHandler(plugin, options)
      },
    )

  // Plugin update command
  pluginCmd
    .command('update <plugin>')
    .description(
      'Update a plugin to the latest version (restart required to apply)',
    )
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${VALID_UPDATE_SCOPES.join(', ')} (default: user)`,
    )
    .addOption(coworkOption())
    .action(
      async (plugin: string, options: { scope?: string; cowork?: boolean }) => {
        const { pluginUpdateHandler } = await import(
          '../../cli/handlers/plugins.js'
        )
        await pluginUpdateHandler(plugin, options)
      },
    )
  // END ANT-ONLY

  // Agents command - list configured agents
  program
    .command('agents')
    .description('List configured agents')
    .option(
      '--setting-sources <sources>',
      'Comma-separated list of setting sources to load (user, project, local).',
    )
    .action(async () => {
      const { agentsHandler } = await import('../../cli/handlers/agents.js')
      await agentsHandler()
      process.exit(0)
    })

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    // Skip when tengu_auto_mode_config.enabled === 'disabled' (circuit breaker).
    // Reads from disk cache — GrowthBook isn't initialized at registration time.
    if (getAutoModeEnabledStateIfCached() !== 'disabled') {
      const autoModeCmd = program
        .command('auto-mode')
        .description('Inspect auto mode classifier configuration')

      autoModeCmd
        .command('defaults')
        .description(
          'Print the default auto mode environment, allow, and deny rules as JSON',
        )
        .action(async () => {
          const { autoModeDefaultsHandler } = await import(
            '../../cli/handlers/autoMode.js'
          )
          autoModeDefaultsHandler()
          process.exit(0)
        })

      autoModeCmd
        .command('config')
        .description(
          'Print the effective auto mode config as JSON: your settings where set, defaults otherwise',
        )
        .action(async () => {
          const { autoModeConfigHandler } = await import(
            '../../cli/handlers/autoMode.js'
          )
          autoModeConfigHandler()
          process.exit(0)
        })

      autoModeCmd
        .command('critique')
        .description('Get AI feedback on your custom auto mode rules')
        .option('--model <model>', 'Override which model is used')
        .action(async (options: { model?: string }) => {
          const { autoModeCritiqueHandler } = await import(
            '../../cli/handlers/autoMode.js'
          )
          await autoModeCritiqueHandler(options)
          process.exit()
        })
    }
  }

  // claude autonomy — CLI subcommands mirroring /autonomy slash command
  {
    const autonomyCmd = program
      .command('autonomy')
      .description('Inspect and manage automatic autonomy runs and flows')

    autonomyCmd
      .command('status')
      .description(
        'Print autonomy run, flow, team, pipe, and remote-control status',
      )
      .option(
        '--deep',
        'Include teams, pipes, daemon, and remote-control sections',
      )
      .action(async (options: { deep?: boolean }) => {
        const { autonomyStatusHandler } = await import(
          '../../cli/handlers/autonomy.js'
        )
        await autonomyStatusHandler(options)
        process.exit(0)
      })

    autonomyCmd
      .command('runs [limit]')
      .description('List recent autonomy runs')
      .action(async (limit?: string) => {
        const { autonomyRunsHandler } = await import(
          '../../cli/handlers/autonomy.js'
        )
        await autonomyRunsHandler(limit)
        process.exit(0)
      })

    autonomyCmd
      .command('flows [limit]')
      .description('List recent autonomy flows')
      .action(async (limit?: string) => {
        const { autonomyFlowsHandler } = await import(
          '../../cli/handlers/autonomy.js'
        )
        await autonomyFlowsHandler(limit)
        process.exit(0)
      })

    const flowCmd = autonomyCmd
      .command('flow <flowId>')
      .description('Inspect a single autonomy flow')
      .action(async (flowId: string) => {
        const { autonomyFlowHandler } = await import(
          '../../cli/handlers/autonomy.js'
        )
        await autonomyFlowHandler(flowId)
        process.exit(0)
      })

    flowCmd
      .command('cancel <flowId>')
      .description('Cancel a queued, waiting, or running autonomy flow')
      .action(async (flowId: string) => {
        const { autonomyFlowCancelHandler } = await import(
          '../../cli/handlers/autonomy.js'
        )
        await autonomyFlowCancelHandler(flowId)
        process.exit(0)
      })

    flowCmd
      .command('resume <flowId>')
      .description('Resume a waiting autonomy flow')
      .action(async (flowId: string) => {
        const { autonomyFlowResumeHandler } = await import(
          '../../cli/handlers/autonomy.js'
        )
        await autonomyFlowResumeHandler(flowId)
        process.exit(0)
      })
  }

  // Remote Control command — connect local environment to claude.ai/code.
  // The actual command is intercepted by the fast-path in cli.tsx before
  // Commander.js runs, so this registration exists only for help output.
  // Always hidden: isBridgeEnabled() at this point (before enableConfigs)
  // would throw inside isClaudeAISubscriber → getGlobalConfig and return
  // false via the try/catch — but not before paying ~65ms of side effects
  // (25ms settings Zod parse + 40ms sync `security` keychain subprocess).
  // The dynamic visibility never worked; the command was always hidden.
  if (feature('BRIDGE_MODE')) {
    program
      .command('remote-control', { hidden: true })
      .alias('rc')
      .description(
        'Connect your local environment for remote-control sessions via claude.ai/code',
      )
      .action(async () => {
        // Unreachable — cli.tsx fast-path handles this command before main.tsx loads.
        // If somehow reached, delegate to bridgeMain.
        const { bridgeMain } = await import('../../bridge/bridgeMain.js')
        await bridgeMain(process.argv.slice(3))
      })
  }

  if (feature('KAIROS')) {
    program
      .command('assistant [sessionId]')
      .description(
        'Attach the REPL as a client to a running bridge session. Discovers sessions via API if no sessionId given.',
      )
      .action(() => {
        // Argv rewriting above should have consumed `assistant [id]`
        // before commander runs. Reaching here means a root flag came first
        // (e.g. `--debug assistant`) and the position-0 predicate
        // didn't match. Print usage like the ssh stub does.
        process.stderr.write(
          'Usage: claude assistant [sessionId]\n\n' +
            'Attach the REPL as a viewer client to a running bridge session.\n' +
            'Omit sessionId to discover and pick from available sessions.\n',
        )
        process.exit(1)
      })
  }

  // Doctor command - check installation health
  program
    .command('doctor')
    .description(
      'Check Claude Code runtime health. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async () => {
      const [{ doctorHandler }, { createRoot }] = await Promise.all([
        import('../../cli/handlers/util.js'),
        import('@anthropic/ink'),
      ])
      const root = await createRoot(getBaseRenderOptions(false))
      await doctorHandler(root)
    })

  // claude up — run the project's CLAUDE.md "# claude up" setup instructions.
  if (process.env.USER_TYPE === 'ant') {
    program
      .command('up')
      .description(
        '[ANT-ONLY] Initialize or upgrade the local dev environment using the "# claude up" section of the nearest CLAUDE.md',
      )
      .action(async () => {
        const { up } = await import('src/cli/up.js')
        await up()
      })
  }

  // ant-only commands
  if (process.env.USER_TYPE === 'ant') {
    const validateLogId = (value: string) => {
      const maybeSessionId = validateUuid(value)
      if (maybeSessionId) return maybeSessionId
      return Number(value)
    }
    // claude log
    program
      .command('log')
      .description('[ANT-ONLY] Manage conversation logs.')
      .argument(
        '[number|sessionId]',
        'A number (0, 1, 2, etc.) to display a specific log, or the sesssion ID (uuid) of a log',
        validateLogId,
      )
      .action(async (logId: string | number | undefined) => {
        const { logHandler } = await import('../../cli/handlers/ant.js')
        await logHandler(logId)
      })

    // claude error
    program
      .command('error')
      .description(
        '[ANT-ONLY] View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.',
      )
      .argument(
        '[number]',
        'A number (0, 1, 2, etc.) to display a specific log',
        parseInt,
      )
      .action(async (number: number | undefined) => {
        const { errorHandler } = await import('../../cli/handlers/ant.js')
        await errorHandler(number)
      })

    // claude export
    program
      .command('export')
      .description('[ANT-ONLY] Export a conversation to a text file.')
      .usage('<source> <outputFile>')
      .argument(
        '<source>',
        'Session ID, log index (0, 1, 2...), or path to a .json/.jsonl log file',
      )
      .argument('<outputFile>', 'Output file path for the exported text')
      .addHelpText(
        'after',
        `
Examples:
  $ claude export 0 conversation.txt                Export conversation at log index 0
  $ claude export <uuid> conversation.txt           Export conversation by session ID
  $ claude export input.json output.txt             Render JSON log file to text
  $ claude export <uuid>.jsonl output.txt           Render JSONL session file to text`,
      )
      .action(async (source: string, outputFile: string) => {
        const { exportHandler } = await import('../../cli/handlers/ant.js')
        await exportHandler(source, outputFile)
      })

    if (process.env.USER_TYPE === 'ant') {
      const taskCmd = program
        .command('task')
        .description('[ANT-ONLY] Manage task list tasks')

      taskCmd
        .command('create <subject>')
        .description('Create a new task')
        .option('-d, --description <text>', 'Task description')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(
          async (
            subject: string,
            opts: { description?: string; list?: string },
          ) => {
            const { taskCreateHandler } = await import(
              '../../cli/handlers/ant.js'
            )
            await taskCreateHandler(subject, opts)
          },
        )

      taskCmd
        .command('list')
        .description('List all tasks')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .option('--pending', 'Show only pending tasks')
        .option('--json', 'Output as JSON')
        .action(
          async (opts: {
            list?: string
            pending?: boolean
            json?: boolean
          }) => {
            const { taskListHandler } = await import(
              '../../cli/handlers/ant.js'
            )
            await taskListHandler(opts)
          },
        )

      taskCmd
        .command('get <id>')
        .description('Get details of a task')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (id: string, opts: { list?: string }) => {
          const { taskGetHandler } = await import('../../cli/handlers/ant.js')
          await taskGetHandler(id, opts)
        })

      taskCmd
        .command('update <id>')
        .description('Update a task')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .option(
          '-s, --status <status>',
          `Set status (${TASK_STATUSES.join(', ')})`,
        )
        .option('--subject <text>', 'Update subject')
        .option('-d, --description <text>', 'Update description')
        .option('--owner <agentId>', 'Set owner')
        .option('--clear-owner', 'Clear owner')
        .action(
          async (
            id: string,
            opts: {
              list?: string
              status?: string
              subject?: string
              description?: string
              owner?: string
              clearOwner?: boolean
            },
          ) => {
            const { taskUpdateHandler } = await import(
              '../../cli/handlers/ant.js'
            )
            await taskUpdateHandler(id, opts)
          },
        )

      taskCmd
        .command('dir')
        .description('Show the tasks directory path')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (opts: { list?: string }) => {
          const { taskDirHandler } = await import('../../cli/handlers/ant.js')
          await taskDirHandler(opts)
        })
    }

    // claude completion <shell>
    program
      .command('completion <shell>', { hidden: true })
      .description('Generate shell completion script (bash, zsh, or fish)')
      .option(
        '--output <file>',
        'Write completion script directly to a file instead of stdout',
      )
      .action(async (shell: string, opts: { output?: string }) => {
        const { completionHandler } = await import('../../cli/handlers/ant.js')
        await completionHandler(shell, opts, program)
      })
  }
}
