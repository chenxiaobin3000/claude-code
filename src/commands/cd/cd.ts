import type { LocalCommandResult } from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { expandPath } from '../../utils/path.js'
import { setCwd } from '../../utils/Shell.js'

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value.at(-1)
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value
}

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const requestedPath = stripMatchingQuotes(args.trim())
  if (!requestedPath) {
    return {
      type: 'text',
      value: `Current working directory: ${getCwd()}`,
    }
  }

  const resolvedPath = expandPath(requestedPath, getCwd())
  const fs = getFsImplementation()
  const physicalPath = fs.realpathSync(resolvedPath)
  if (!fs.statSync(physicalPath).isDirectory()) {
    throw new Error(`Path "${resolvedPath}" is not a directory`)
  }

  setCwd(physicalPath)
  return {
    type: 'text',
    value: `Working directory changed to ${getCwd()}`,
  }
}
