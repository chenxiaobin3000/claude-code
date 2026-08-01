import embeddedRipgrepPath from '../utils/vendor/ripgrep/x64-win32/rg.exe' with {
  type: 'file',
}
import { prepareEmbeddedRipgrep } from '../utils/embeddedRipgrep.js'

await prepareEmbeddedRipgrep(embeddedRipgrepPath)

// Internal distribution-test hook: exercise the same ripgrep adapter used by
// Glob, Grep, shell snapshots, file suggestions, and sandbox integration.
if (process.env.CCB_VALIDATE_EMBEDDED_RIPGREP === '1') {
  const { ripGrep } = await import('../utils/ripgrep.js')
  await ripGrep(
    ['--files'],
    process.cwd(),
    AbortSignal.timeout(10_000),
  )
}

await import('./cli.js')
