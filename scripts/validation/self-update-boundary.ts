import { access, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(root, path))
    return true
  } catch {
    return false
  }
}

async function collectFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const relative = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await collectFiles(relative)))
    else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push(relative)
  }
  return result
}

const removedPaths = [
  'src/cli/rollback.ts',
  'src/cli/updateCCB.ts',
  'src/commands/install.tsx',
  'src/components/AutoUpdater.tsx',
  'src/components/AutoUpdaterWrapper.tsx',
  'src/components/NativeAutoUpdater.tsx',
  'src/components/PackageManagerAutoUpdater.tsx',
  'src/hooks/useUpdateNotification.ts',
  'src/utils/autoUpdater.ts',
  'src/utils/localInstaller.ts',
]
for (const path of removedPaths) {
  if (await exists(path)) {
    throw new Error(`[self-update-boundary] forbidden path exists: ${path}`)
  }
}

const subcommandsPath = 'src/cli/arguments/registerSubcommands.ts'
const subcommands = await readFile(join(root, subcommandsPath), 'utf8')
for (const pattern of [
  /\.command\(['"]install \[target\]['"]\)/,
  /\.command\(['"]update['"]\)/,
  /\.command\(['"]rollback(?: \[target\])?['"]\)/,
]) {
  if (pattern.test(subcommands)) {
    throw new Error(
      `[self-update-boundary] ${subcommandsPath} contains forbidden root command ${pattern}`,
    )
  }
}
if (!/\.command\(['"]install <plugin>['"]\)/.test(subcommands)) {
  throw new Error('[self-update-boundary] plugin install command was removed')
}

const forbiddenSourceTokens = [
  /nativeInstaller/,
  /localInstaller/,
  /AutoUpdater/,
  /autoUpdatesChannel/,
  /autoUpdatesProtectedForNative/,
  /installMethod/,
  /DISABLE_AUTOUPDATER/,
  /ENABLE_AUTOUPDATER/,
]
for (const path of await collectFiles('src')) {
  const source = await readFile(join(root, path), 'utf8')
  for (const pattern of forbiddenSourceTokens) {
    if (pattern.test(source)) {
      throw new Error(
        `[self-update-boundary] ${path} contains forbidden CLI update token ${pattern}`,
      )
    }
  }
}

if (!(await exists('src/utils/plugins/pluginAutoupdate.ts'))) {
  throw new Error('[self-update-boundary] plugin autoupdate must remain available')
}
if (!(await exists('scripts/build-exe.ts'))) {
  throw new Error('[self-update-boundary] standalone EXE build must remain available')
}

console.log('[self-update-boundary] PASS')
