import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

const embeddedRipgrepSymbol = Symbol.for(
  'claude-code.extracted-ripgrep-path',
)
const expectedEmbeddedHash = process.env.CCB_EMBEDDED_RIPGREP_SHA256

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertRegularFile(path: string, description: string): void {
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${description} must be a regular file: ${path}`)
  }
}

function assertRealDirectory(path: string, description: string): void {
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${description} must be a real directory: ${path}`)
  }
}

function verifyExtractedFile(path: string, expectedHash: string): void {
  assertRegularFile(path, 'Extracted ripgrep')
  const actualHash = sha256(readFileSync(path))
  if (actualHash !== expectedHash) {
    throw new Error(
      `Extracted ripgrep failed SHA-256 verification: ${path}`,
    )
  }
}

function getCacheTarget(
  expectedHash: string,
  cacheRoot = join(getClaudeConfigHomeDir(), 'cache', 'ripgrep'),
): string {
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 })
  assertRealDirectory(cacheRoot, 'Ripgrep cache root')

  const versionDir = join(cacheRoot, expectedHash)
  mkdirSync(versionDir, { recursive: true, mode: 0o700 })
  assertRealDirectory(versionDir, 'Ripgrep version cache')

  const executableName = process.platform === 'win32' ? 'rg.exe' : 'rg'
  return join(versionDir, executableName)
}

function useVerifiedCache(
  targetPath: string,
  expectedHash: string,
): string | null {
  try {
    verifyExtractedFile(targetPath, expectedHash)
    return targetPath
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
    return null
  }
}

export async function extractEmbeddedRipgrep(
  sourcePath: string,
  expectedHash: string,
  cacheRoot = join(getClaudeConfigHomeDir(), 'cache', 'ripgrep'),
): Promise<string> {
  const targetPath = getCacheTarget(expectedHash, cacheRoot)
  const cachedPath = useVerifiedCache(targetPath, expectedHash)
  if (cachedPath) return cachedPath

  if (typeof Bun === 'undefined') {
    throw new Error('Embedded ripgrep extraction requires the Bun runtime')
  }
  const bytes = Buffer.from(await Bun.file(sourcePath).arrayBuffer())
  const sourceHash = sha256(bytes)
  if (sourceHash !== expectedHash) {
    throw new Error('Embedded ripgrep resource failed SHA-256 verification')
  }

  const versionDir = join(cacheRoot, expectedHash)
  const executableName = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const temporaryPath = join(
    versionDir,
    `.${executableName}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o700 })
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o700)
    verifyExtractedFile(temporaryPath, sourceHash)
    try {
      renameSync(temporaryPath, targetPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      verifyExtractedFile(targetPath, sourceHash)
    }
  } finally {
    rmSync(temporaryPath, { force: true })
  }

  verifyExtractedFile(targetPath, sourceHash)
  return targetPath
}

export async function prepareEmbeddedRipgrep(
  sourcePath: string,
): Promise<string> {
  if (!expectedEmbeddedHash) {
    throw new Error(
      'Standalone ripgrep is missing its build-time SHA-256 digest',
    )
  }
  const extractedPath = await extractEmbeddedRipgrep(
    sourcePath,
    expectedEmbeddedHash,
  )
  Object.defineProperty(globalThis, embeddedRipgrepSymbol, {
    value: extractedPath,
    configurable: false,
    enumerable: false,
    writable: false,
  })
  return extractedPath
}

export function getExtractedEmbeddedRipgrepPath(): string | null {
  const extractedPath = (
    globalThis as typeof globalThis & Record<symbol, unknown>
  )[embeddedRipgrepSymbol]
  return typeof extractedPath === 'string' && extractedPath.length > 0
    ? extractedPath
    : null
}
