import { readFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getPlatform } from './platform.js'

export type PackageManager =
  | 'homebrew'
  | 'winget'
  | 'pacman'
  | 'deb'
  | 'rpm'
  | 'apk'
  | 'mise'
  | 'asdf'
  | 'unknown'

function pathManagedBy(manager: 'mise' | 'asdf'): boolean {
  const executable = process.execPath || process.argv[0] || ''
  return manager === 'mise'
    ? /[/\\]mise[/\\]installs[/\\]/i.test(executable)
    : /[/\\]\.?(?:asdf)[/\\]installs[/\\]/i.test(executable)
}

async function linuxPackageManager(): Promise<PackageManager> {
  if (getPlatform() !== 'linux') return 'unknown'

  let family = ''
  try {
    const release = await readFile('/etc/os-release', 'utf8')
    family = `${release.match(/^ID=["']?(.+?)["']?$/m)?.[1] ?? ''} ${
      release.match(/^ID_LIKE=["']?(.+?)["']?$/m)?.[1] ?? ''
    }`.toLowerCase()
  } catch {
    // Unknown distribution: avoid probing unrelated executables by name.
    return 'unknown'
  }

  const executable = process.execPath || process.argv[0] || ''
  const probes: Array<{
    family: RegExp
    manager: PackageManager
    command: string
    args: string[]
  }> = [
    { family: /arch/, manager: 'pacman', command: 'pacman', args: ['-Qo', executable] },
    { family: /alpine/, manager: 'apk', command: 'apk', args: ['info', '--who-owns', executable] },
    { family: /debian|ubuntu/, manager: 'deb', command: 'dpkg', args: ['-S', executable] },
    { family: /fedora|rhel|suse/, manager: 'rpm', command: 'rpm', args: ['-qf', executable] },
  ]
  const probe = probes.find(candidate => candidate.family.test(family))
  if (!probe) return 'unknown'
  const result = await execFileNoThrow(probe.command, probe.args, {
    timeout: 5000,
    useCwd: false,
  })
  return result.code === 0 && result.stdout ? probe.manager : 'unknown'
}

export const getPackageManager = memoize(async (): Promise<PackageManager> => {
  const platform = getPlatform()
  const executable = process.execPath || process.argv[0] || ''
  if (
    (platform === 'macos' || platform === 'linux' || platform === 'wsl') &&
    executable.includes('/Caskroom/')
  ) {
    return 'homebrew'
  }
  if (
    platform === 'windows' &&
    /Microsoft[/\\]WinGet[/\\](?:Packages|Links)/i.test(executable)
  ) {
    return 'winget'
  }
  if (pathManagedBy('mise')) return 'mise'
  if (pathManagedBy('asdf')) return 'asdf'
  return linuxPackageManager()
})
