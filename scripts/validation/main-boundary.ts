import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(join(root, path), 'utf8')

function requirePattern(path: string, text: string, pattern: RegExp): void {
  if (!pattern.test(text))
    throw new Error(`[main-boundary] ${path} is missing ${pattern}`)
}

function rejectPattern(path: string, text: string, pattern: RegExp): void {
  if (pattern.test(text))
    throw new Error(`[main-boundary] ${path} contains forbidden ${pattern}`)
}

const mainPath = 'src/main.tsx'
const main = await source(mainPath)
if (main.split(/\r?\n/).length > 200) {
  throw new Error(
    '[main-boundary] main.tsx must remain a thin startup orchestrator (max 200 lines)',
  )
}

for (const required of [
  /cli\/startup\/prepareStartup\.js/,
  /cli\/arguments\/registerRootCommand\.js/,
  /cli\/modes\/defaultMode\.js/,
  /cli\/initialization\/commandServices\.js/,
  /await import\(['"]\.\/cli\/arguments\/registerSubcommands\.js['"]\)/,
]) {
  requirePattern(mainPath, main, required)
}

for (const forbidden of [
  /\.option\s*\(/,
  /\.command\s*\(/,
  /launchRepl\s*\(/,
  /startDeferredPrefetches/,
]) {
  rejectPattern(mainPath, main, forbidden)
}

const preparationPath = 'src/cli/startup/prepareStartup.ts'
const preparation = await source(preparationPath)
requirePattern(
  preparationPath,
  preparation,
  /export async function executeStartup/,
)
requirePattern(
  preparationPath,
  preparation,
  /NoDefaultCurrentDirectoryInExePath/,
)

const rootArgumentsPath = 'src/cli/arguments/registerRootCommand.ts'
const rootArguments = await source(rootArgumentsPath)
requirePattern(
  rootArgumentsPath,
  rootArguments,
  /export function registerRootCommand/,
)
requirePattern(rootArgumentsPath, rootArguments, /--permission-mode/)

const modePath = 'src/cli/modes/defaultMode.tsx'
const mode = await source(modePath)
requirePattern(modePath, mode, /export async function runDefaultMode/)
requirePattern(modePath, mode, /launchRepl\s*\(/)

const initializationPath = 'src/cli/initialization/commandServices.ts'
const initialization = await source(initializationPath)
requirePattern(
  initializationPath,
  initialization,
  /registerCommandServiceInitialization/,
)
requirePattern(initializationPath, initialization, /ensureMdmSettingsLoaded/)

console.log('[main-boundary] PASS')
