import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { OpenAIAccountClaims } from './jwt.js'

export const OPENAI_PROXY_AUTH_FILENAME = 'auth.json' as const

export interface OpenAIProxySession {
  version: 1
  authMode: 'chatgpt'
  tokens: {
    idToken: string
    accessToken: string
    refreshToken: string
    accessTokenExpiresAt?: number
  }
  account: OpenAIAccountClaims
  updatedAt: string
}

export type SecurePath = (
  path: string,
  kind: 'directory' | 'file',
) => Promise<void>

function windowsIdentity(): string {
  const whoami = Bun.spawnSync(['whoami.exe'], {
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  })
  const resolved = whoami.stdout.toString().trim()
  if (whoami.exitCode === 0 && resolved) return resolved
  const username = process.env.USERNAME
  const domain = process.env.USERDOMAIN
  if (!username) throw new Error('Unable to determine the Windows user for ACLs.')
  return domain ? `${domain}\\${username}` : username
}

export const secureSessionPath: SecurePath = async (path, kind) => {
  if (process.platform !== 'win32') {
    await chmod(path, kind === 'directory' ? 0o700 : 0o600)
    return
  }
  const identity = windowsIdentity()
  const grant =
    kind === 'directory' ? `${identity}:(OI)(CI)F` : `${identity}:F`
  const result = Bun.spawnSync(
    ['icacls.exe', path, '/inheritance:r', '/grant:r', grant],
    { stdout: 'pipe', stderr: 'pipe', windowsHide: true },
  )
  if (result.exitCode !== 0) {
    throw new Error(`Failed to restrict ${kind} ACL for openai-proxy auth.`)
  }
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`Refusing symbolic link in openai-proxy auth path: ${path}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export class OpenAIProxySessionStore {
  readonly directory: string
  readonly path: string
  readonly lockPath: string
  private readonly securePath: SecurePath

  constructor(options: { directory?: string; securePath?: SecurePath } = {}) {
    this.directory =
      options.directory ?? join(homedir(), '.claude', 'openai-proxy')
    this.path = join(this.directory, OPENAI_PROXY_AUTH_FILENAME)
    this.lockPath = join(this.directory, 'auth.lock')
    this.securePath = options.securePath ?? secureSessionPath
  }

  private async prepareDirectory(): Promise<void> {
    await rejectSymlink(dirname(this.directory))
    await rejectSymlink(this.directory)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.securePath(this.directory, 'directory')
  }

  async load(): Promise<OpenAIProxySession | undefined> {
    await rejectSymlink(this.path)
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
      throw new Error('openai-proxy auth file exceeded 1 MiB.')
    }
    const session = JSON.parse(text) as Partial<OpenAIProxySession>
    if (
      session.version !== 1 ||
      session.authMode !== 'chatgpt' ||
      !session.tokens?.idToken ||
      !session.tokens.accessToken ||
      !session.tokens.refreshToken ||
      !session.account ||
      typeof session.updatedAt !== 'string'
    ) {
      throw new Error('Invalid openai-proxy auth file.')
    }
    return session as OpenAIProxySession
  }

  async save(session: OpenAIProxySession): Promise<void> {
    await this.prepareDirectory()
    await rejectSymlink(this.path)
    const temporary = join(
      this.directory,
      `.auth-${process.pid}-${crypto.randomUUID()}.tmp`,
    )
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(session, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await this.securePath(temporary, 'file')
      await rename(temporary, this.path)
      await this.securePath(this.path, 'file')
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async delete(): Promise<boolean> {
    try {
      await unlink(this.path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepareDirectory()
    const deadline = Date.now() + 10_000
    let handle: Awaited<ReturnType<typeof open>> | undefined
    while (!handle) {
      try {
        handle = await open(this.lockPath, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const lock = await lstat(this.lockPath).catch(() => undefined)
        if (lock && Date.now() - lock.mtimeMs > 30_000) {
          await rm(this.lockPath, { force: true })
          continue
        }
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for the openai-proxy auth lock.')
        }
        await Bun.sleep(50)
      }
    }
    try {
      await this.securePath(this.lockPath, 'file')
      return await operation()
    } finally {
      await handle.close()
      await rm(this.lockPath, { force: true })
    }
  }
}
