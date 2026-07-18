import type { Subprocess } from 'bun'
import { SSHSessionManagerImpl } from './SSHSessionManager.js'
import type {
  SSHSessionManager,
  SSHSessionManagerOptions,
} from './SSHSessionManager.js'
import { probeRemote } from './SSHProbe.js'
import { deployBinary } from './SSHDeploy.js'
import { buildCliLaunch } from '../utils/cliLaunch.js'
import { logForDebugging } from '../utils/debug.js'
import { jsonParse } from '../utils/slowOperations.js'

export interface SSHAuthProxy {
  stop(): void
}

const NOOP_AUTH_PROXY: SSHAuthProxy = { stop() {} }

const INIT_TIMEOUT_MS = 30_000
const STDERR_TAIL_LINES = 20

export interface SSHSession {
  remoteCwd: string
  proc: Subprocess
  proxy: SSHAuthProxy
  createManager(options: SSHSessionManagerOptions): SSHSessionManager
  getStderrTail(): string
}

export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

export async function createSSHSession(
  config: {
    host: string
    cwd?: string
    localVersion: string
    permissionMode?: string
    dangerouslySkipPermissions?: boolean
    extraCliArgs: string[]
    remoteBin?: string
  },
  callbacks?: {
    onProgress?: (msg: string) => void
  },
): Promise<SSHSession> {
  const { host, localVersion, extraCliArgs, remoteBin } = config
  const onProgress = callbacks?.onProgress

  let remoteBinaryPath: string
  let defaultCwd = '/'

  if (remoteBin) {
    onProgress?.('Using custom remote binary, skipping probe/deploy…')
    remoteBinaryPath = remoteBin
    logForDebugging(`[SSH] custom remoteBin: ${remoteBin}`)
    // Quick SSH to get remote home directory for default CWD
    try {
      const pwdProc = Bun.spawn(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, 'pwd'],
        {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'ignore',
        },
      )
      await pwdProc.exited
      const pwd = (await new Response(pwdProc.stdout).text()).trim()
      if (pwd.startsWith('/')) defaultCwd = pwd
    } catch {
      /* use fallback */
    }
  } else {
    // 1. Probe remote host
    const probe = await probeRemote(host, onProgress)
    logForDebugging(`[SSH] probe result: ${JSON.stringify(probe)}`)
    defaultCwd = probe.defaultCwd

    // 2. Deploy if binary missing or version mismatch
    remoteBinaryPath = probe.binaryPath ?? '~/.local/bin/claude'
    if (!probe.hasBinary || probe.remoteVersion !== localVersion) {
      onProgress?.(
        probe.hasBinary
          ? `Updating remote binary (${probe.remoteVersion} → ${localVersion})…`
          : 'Deploying binary to remote…',
      )
      remoteBinaryPath = await deployBinary({
        host,
        remotePlatform: probe.remotePlatform,
        remoteArch: probe.remoteArch,
        localVersion,
        onProgress,
      })
    }
  }

  // The remote process must use its own explicit OpenAI-compatible provider
  // configuration. Local account credentials are never forwarded over SSH.
  const proxy = NOOP_AUTH_PROXY

  const remoteCli: string[] = []
  remoteCli.push(
    remoteBinaryPath,
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '-p',
  )
  if (config.cwd) remoteCli.push('--cwd', config.cwd)
  if (config.permissionMode)
    remoteCli.push('--permission-mode', config.permissionMode)
  if (config.dangerouslySkipPermissions)
    remoteCli.push('--dangerously-skip-permissions')
  remoteCli.push(...extraCliArgs)

  const sshArgs = ['ssh']

  sshArgs.push(host, remoteCli.join(' '))

  onProgress?.('Starting remote session…')
  logForDebugging(`[SSH] spawning: ${sshArgs.join(' ')}`)

  let proc: Subprocess
  try {
    proc = Bun.spawn(sshArgs, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (err) {
    proxy.stop()
    throw new SSHSessionError(
      `Failed to spawn SSH process: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const stderrChunks: string[] = []
  collectStderr(proc, stderrChunks)

  let remoteCwd: string
  if (remoteBin) {
    // Custom binary mode: the remote CLI in print+stream-json mode emits
    // init only after receiving the first user message (QueryEngine yield).
    // Waiting for init here would deadlock. Instead, verify the process
    // is alive and use the configured or probed CWD.
    const earlyExit = await Promise.race([
      proc.exited.then(code => code),
      new Promise<null>(r => setTimeout(() => r(null), 3_000)),
    ])
    if (earlyExit !== null) {
      proxy.stop()
      const tail = stderrChunks.join('').trim()
      throw new SSHSessionError(
        `Remote process exited immediately (code ${earlyExit})${tail ? `: ${tail}` : ''}`,
      )
    }
    remoteCwd = config.cwd || defaultCwd || '/'
  } else {
    try {
      remoteCwd = await waitForInit(proc, config.cwd || defaultCwd)
    } catch (err) {
      proxy.stop()
      proc.kill()
      throw err
    }
  }

  logForDebugging(`[SSH] remote session initialized, remoteCwd=${remoteCwd}`)

  let currentProc = proc

  const reconnect = async (): Promise<Subprocess> => {
    logForDebugging('[SSH] reconnect: re-spawning SSH process with --continue')
    const reconnectArgs = [...sshArgs]
    const cmdIdx = reconnectArgs.length - 1
    const existingCmd = reconnectArgs[cmdIdx]!
    if (!existingCmd.includes('--continue')) {
      reconnectArgs[cmdIdx] = existingCmd.replace(
        / -p(?:\s|$)/,
        ' -p --continue ',
      )
    }

    const newProc = Bun.spawn(reconnectArgs, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const newStderrChunks: string[] = []
    collectStderr(newProc, newStderrChunks)

    await waitForInit(newProc, remoteCwd)
    currentProc = newProc
    stderrChunks.length = 0
    stderrChunks.push(...newStderrChunks)

    return newProc
  }

  return {
    remoteCwd,
    get proc() {
      return currentProc
    },
    proxy,
    createManager(options: SSHSessionManagerOptions): SSHSessionManager {
      return new SSHSessionManagerImpl(currentProc, {
        ...options,
        reconnect,
      })
    },
    getStderrTail(): string {
      return stderrChunks.slice(-STDERR_TAIL_LINES).join('')
    },
  }
}

export async function createLocalSSHSession(config: {
  cwd?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
}): Promise<SSHSession> {
  const proxy = NOOP_AUTH_PROXY

  const cliArgs: string[] = [
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '-p',
  ]
  if (config.cwd) {
    cliArgs.push('--cwd', config.cwd)
  }
  if (config.permissionMode) {
    cliArgs.push('--permission-mode', config.permissionMode)
  }
  if (config.dangerouslySkipPermissions) {
    cliArgs.push('--dangerously-skip-permissions')
  }

  const spec = buildCliLaunch(cliArgs)

  let proc: Subprocess
  try {
    proc = Bun.spawn([spec.execPath, ...spec.args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: spec.env,
    })
  } catch (err) {
    proxy.stop()
    throw new SSHSessionError(
      `Failed to spawn local CLI process: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  logForDebugging('[SSH] local session spawned, waiting for init message...')

  const stderrChunks: string[] = []
  collectStderr(proc, stderrChunks)

  let remoteCwd: string
  try {
    remoteCwd = await waitForInit(proc, config.cwd)
  } catch (err) {
    proxy.stop()
    proc.kill()
    throw err
  }

  logForDebugging(`[SSH] local session initialized, remoteCwd=${remoteCwd}`)

  let currentProc = proc

  const reconnect = async (): Promise<Subprocess> => {
    logForDebugging('[SSH] local reconnect: re-spawning CLI with --continue')
    const reconnectCliArgs = [...cliArgs]
    if (!reconnectCliArgs.includes('--continue')) {
      reconnectCliArgs.push('--continue')
    }

    const reconnectSpec = buildCliLaunch(reconnectCliArgs)
    const newProc = Bun.spawn([reconnectSpec.execPath, ...reconnectSpec.args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: reconnectSpec.env,
    })

    const newStderrChunks: string[] = []
    collectStderr(newProc, newStderrChunks)

    await waitForInit(newProc, remoteCwd)
    currentProc = newProc
    stderrChunks.length = 0
    stderrChunks.push(...newStderrChunks)

    return newProc
  }

  return {
    remoteCwd,
    get proc() {
      return currentProc
    },
    proxy,
    createManager(options: SSHSessionManagerOptions): SSHSessionManager {
      return new SSHSessionManagerImpl(currentProc, {
        ...options,
        reconnect,
      })
    },
    getStderrTail(): string {
      return stderrChunks.slice(-STDERR_TAIL_LINES).join('')
    },
  }
}

async function waitForInit(
  proc: Subprocess,
  fallbackCwd?: string,
): Promise<string> {
  const stdout = proc.stdout
  if (!stdout) {
    throw new SSHSessionError('Child process stdout is not readable')
  }

  const reader = (stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + INIT_TIMEOUT_MS

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new SSHSessionError(
                  'Remote CLI did not initialize within 30 seconds. Check SSH connectivity and remote binary.',
                ),
              ),
            remaining,
          ),
        ),
      ])

      if (result.done) {
        throw new SSHSessionError(
          'Child process exited before sending init message',
        )
      }

      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = jsonParse(trimmed) as Record<string, unknown>
          if (msg.type === 'system' && msg.subtype === 'init') {
            reader.releaseLock()
            return (msg.cwd as string) || fallbackCwd || process.cwd()
          }
        } catch {
          // not valid JSON — skip
        }
      }
    }
  } catch (err) {
    reader.releaseLock()
    throw err instanceof SSHSessionError
      ? err
      : new SSHSessionError(
          `Error reading init message: ${err instanceof Error ? err.message : String(err)}`,
        )
  }

  reader.releaseLock()
  throw new SSHSessionError(
    'Remote CLI did not initialize within 30 seconds. Check SSH connectivity and remote binary.',
  )
}

function collectStderr(proc: Subprocess, chunks: string[]): void {
  const stderr = proc.stderr
  if (!stderr) return

  const reader = (stderr as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(decoder.decode(value, { stream: true }))
        if (chunks.length > STDERR_TAIL_LINES * 2) {
          chunks.splice(0, chunks.length - STDERR_TAIL_LINES)
        }
      }
    } catch {
      // stderr closed — expected on process exit
    }
  })()
}
