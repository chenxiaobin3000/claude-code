import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { once } from 'events'
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'fs/promises'
import { basename, isAbsolute, join, relative } from 'path'
import { registerCleanup } from '../cleanupRegistry.js'
import { getClaudeTempDir } from '../permissions/filesystem.js'
import {
  buildWindowsSandboxConfiguration,
  type WindowsSandboxRequest,
  type WindowsSandboxResult,
  WINDOWS_SANDBOX_GUEST_RUNNER,
} from './windowsSandboxProtocol.js'

const POLL_INTERVAL_MS = 100
const READY_TIMEOUT_MS = 60_000

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readWindowsText(path: string): Promise<string> {
  const bytes = await readFile(path)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le')
  }
  return bytes.toString('utf8').replace(/^\uFEFF/, '')
}

async function waitFor(path: string, deadline: number, aborted?: AbortSignal): Promise<void> {
  while (!(await exists(path))) {
    if (aborted?.aborted) throw new Error('Windows Sandbox command was cancelled')
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for Windows Sandbox: ${path}`)
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

/**
 * One visible Windows Sandbox is shared by a CLI session. It has exactly two
 * host mappings: the startup workspace (read/write) and this private control
 * directory. The latter is outside the workspace and holds only protocol files.
 */
export class WindowsSandboxSession {
  #controlRoot: string
  #workspace: string
  #process: ChildProcess
  #closed = false

  private constructor(controlRoot: string, workspace: string, process: ChildProcess) {
    this.#controlRoot = controlRoot
    this.#workspace = workspace
    this.#process = process
  }

  static async start(workspace: string, runtimeRoots: string[] = []): Promise<WindowsSandboxSession> {
    if (process.platform !== 'win32') throw new Error('Windows Sandbox is only available on Windows')
    if (!isAbsolute(workspace)) throw new Error('Windows Sandbox workspace must be absolute')
    const workspaceStat = await lstat(workspace)
    if (workspaceStat.isSymbolicLink()) {
      throw new Error('Windows Sandbox workspace cannot be a symbolic link or junction')
    }
    const resolvedWorkspace = await realpath(workspace)
    const resolvedRuntimeRoots = await Promise.all(
      runtimeRoots.map(async runtimeRoot => {
        const stat = await lstat(runtimeRoot)
        if (stat.isSymbolicLink()) {
          throw new Error(`Windows Sandbox runtime cannot be a symbolic link or junction: ${runtimeRoot}`)
        }
        return realpath(runtimeRoot)
      }),
    )
    const controlRoot = join(getClaudeTempDir(), 'windows-sandbox', randomUUID())
    await mkdir(controlRoot, { recursive: true })
    await writeFile(join(controlRoot, 'alive'), '')
    await writeFile(join(controlRoot, 'runner.ps1'), WINDOWS_SANDBOX_GUEST_RUNNER, 'utf8')
    const configuration = buildWindowsSandboxConfiguration(
      [
        { hostFolder: resolvedWorkspace, sandboxFolder: 'C:\\claude\\workspace', readOnly: false },
        { hostFolder: controlRoot, sandboxFolder: 'C:\\claude\\control', readOnly: false },
        ...resolvedRuntimeRoots.map((runtimeRoot, index) => ({
          hostFolder: runtimeRoot,
          sandboxFolder: `C:\\claude\\runtime\\${index}`,
          readOnly: true,
        })),
      ],
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\claude\\control\\runner.ps1',
    )
    const configurationPath = join(controlRoot, 'session.wsb')
    await writeFile(configurationPath, configuration, 'utf8')
    const executable = join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsSandbox.exe')
    const sandboxProcess = spawn(executable, [configurationPath], { windowsHide: false })
    const session = new WindowsSandboxSession(controlRoot, resolvedWorkspace, sandboxProcess)
    try {
      await waitFor(join(controlRoot, 'ready'), Date.now() + READY_TIMEOUT_MS)
      return session
    } catch (error) {
      await session.close()
      throw error
    }
  }

  async execute(
    request: Omit<WindowsSandboxRequest, 'id'>,
    options: { timeout: number; abortSignal?: AbortSignal },
  ): Promise<WindowsSandboxResult> {
    if (this.#closed) throw new Error('Windows Sandbox session is closed')
    if (!isWithin(this.#workspace, request.cwd)) throw new Error(`Sandbox cwd escapes workspace: ${request.cwd}`)
    const id = randomUUID()
    // The guest must never receive a host path. Preserve the relative location
    // inside the mapped startup workspace instead.
    const relativeCwd = relative(this.#workspace, request.cwd)
    const guestCwd = relativeCwd
      ? join('C:\\claude\\workspace', relativeCwd)
      : 'C:\\claude\\workspace'
    const payload: WindowsSandboxRequest = { ...request, cwd: guestCwd, id }
    const pending = join(this.#controlRoot, `request-${id}.json.pending`)
    const requestPath = join(this.#controlRoot, `request-${id}.json`)
    await writeFile(pending, JSON.stringify(payload), 'utf8')
    await rename(pending, requestPath)
    const resultPath = join(this.#controlRoot, `result-${id}.json`)
    await waitFor(resultPath, Date.now() + options.timeout, options.abortSignal)
    const resultText = await readWindowsText(resultPath)
    const result = JSON.parse(resultText) as Omit<WindowsSandboxResult, 'stdout' | 'stderr'>
    const [stdout, stderr] = await Promise.all([
      readWindowsText(join(this.#controlRoot, `stdout-${id}.txt`)).catch(() => ''),
      readWindowsText(join(this.#controlRoot, `stderr-${id}.txt`)).catch(() => ''),
    ])
    return { ...result, id, stdout, stderr }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await unlink(join(this.#controlRoot, 'alive')).catch(() => {})
    // The guest runner observes `alive` removal and shuts down Windows
    // Sandbox. Wait briefly before removing mapped control files; deleting
    // them while the VM still has them open leaves a stale session directory.
    await Promise.race([
      once(this.#process, 'exit'),
      new Promise(resolve => setTimeout(resolve, 30_000)),
    ])
    this.#process.unref()
    await rm(this.#controlRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 }).catch(() => {})
  }
}

let activeSession: Promise<WindowsSandboxSession> | undefined
let activeKey: string | undefined

export function getWindowsSandboxSession(
  workspace: string,
  runtimeRoots: string[] = [],
): Promise<WindowsSandboxSession> {
  const key = JSON.stringify([workspace, ...runtimeRoots])
  if (activeSession && activeKey === key) return activeSession
  if (activeSession) {
    throw new Error('Windows Sandbox session is already bound to another workspace')
  }
  activeKey = key
  activeSession = WindowsSandboxSession.start(workspace, runtimeRoots).catch(error => {
    activeSession = undefined
    activeKey = undefined
    throw error
  })
  return activeSession
}

export async function closeWindowsSandboxSession(): Promise<void> {
  const session = activeSession ? await activeSession.catch(() => undefined) : undefined
  activeSession = undefined
  activeKey = undefined
  await session?.close()
}

// Graceful CLI shutdown must always remove the `alive` marker. The shutdown
// registry has a short global budget, but close() signals the guest before its
// bounded wait, so the VM still receives the shutdown request if cleanup later
// times out.
registerCleanup(closeWindowsSandboxSession)
