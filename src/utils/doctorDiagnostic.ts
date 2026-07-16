import { execa } from 'execa'
import { realpath } from 'fs/promises'
import { posix, win32 } from 'path'
import { isInBundledMode } from './bundledMode.js'
import { getCwd } from './cwd.js'
import { getPlatform } from './platform.js'
import { getPackageManager } from './packageManagerDetection.js'
import { getRipgrepStatus } from './ripgrep.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'

export type InstallationType =
  | 'npm-global'
  | 'standalone'
  | 'package-manager'
  | 'development'
  | 'unknown'

export type DiagnosticInfo = {
  installationType: InstallationType
  version: string
  installationPath: string
  invokedBinary: string
  packageManager?: string
  warnings: Array<{ issue: string; fix: string }>
  ripgrepStatus: {
    working: boolean
    mode: 'system' | 'builtin' | 'embedded'
    systemPath: string | null
    note: string | null
  }
}

function normalizePath(value: string): string {
  return getPlatform() === 'windows'
    ? value.split(win32.sep).join(posix.sep)
    : value
}

export async function getCurrentInstallationType(): Promise<InstallationType> {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.CLAUDE_CODE_DEVELOPMENT === '1'
  ) {
    return 'development'
  }

  if (isInBundledMode()) {
    return (await getPackageManager()) === 'unknown'
      ? 'standalone'
      : 'package-manager'
  }

  const invokedPath = normalizePath(process.argv[1] || '')
  const npmGlobalPaths = [
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    '/.nvm/versions/node/',
  ]
  if (
    npmGlobalPaths.some(path => invokedPath.includes(path)) ||
    invokedPath.includes('/npm/') ||
    invokedPath.includes('/nvm/')
  ) {
    return 'npm-global'
  }

  const npmConfigResult = await execa('npm config get prefix', {
    shell: true,
    reject: false,
  })
  const globalPrefix =
    npmConfigResult.exitCode === 0
      ? normalizePath(npmConfigResult.stdout.trim())
      : null
  return globalPrefix && invokedPath.startsWith(globalPrefix)
    ? 'npm-global'
    : 'unknown'
}

async function getInstallationPath(): Promise<string> {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.CLAUDE_CODE_DEVELOPMENT === '1'
  ) {
    return getCwd()
  }
  if (isInBundledMode()) {
    try {
      return await realpath(process.execPath)
    } catch {
      return process.execPath || 'unknown'
    }
  }
  return process.argv[1] || process.argv[0] || 'unknown'
}

export function getInvokedBinary(): string {
  return isInBundledMode()
    ? process.execPath || 'unknown'
    : process.argv[1] || 'unknown'
}

export function detectLinuxGlobPatternWarnings(): Array<{
  issue: string
  fix: string
}> {
  if (getPlatform() !== 'linux') return []

  const globPatterns = SandboxManager.getLinuxGlobPatternWarnings()
  if (globPatterns.length === 0) return []

  const displayPatterns = globPatterns.slice(0, 3).join(', ')
  const remaining = globPatterns.length - 3
  const patternList =
    remaining > 0 ? `${displayPatterns} (${remaining} more)` : displayPatterns
  return [
    {
      issue:
        'Glob patterns in sandbox permission rules are not fully supported on Linux',
      fix: `Found ${globPatterns.length} pattern(s): ${patternList}. On Linux, glob patterns in Edit/Read rules will be ignored.`,
    },
  ]
}

export async function getDoctorDiagnostic(): Promise<DiagnosticInfo> {
  const ripgrep = getRipgrepStatus()
  const installationType = await getCurrentInstallationType()
  return {
    installationType,
    version:
      typeof MACRO !== 'undefined' && MACRO.VERSION
        ? MACRO.VERSION
        : 'unknown',
    installationPath: await getInstallationPath(),
    invokedBinary: getInvokedBinary(),
    packageManager:
      installationType === 'package-manager'
        ? await getPackageManager()
        : undefined,
    warnings: detectLinuxGlobPatternWarnings(),
    ripgrepStatus: {
      working: ripgrep.working ?? true,
      mode: ripgrep.mode,
      systemPath: ripgrep.mode === 'system' ? ripgrep.path : null,
      note: ripgrep.note ?? null,
    },
  }
}
