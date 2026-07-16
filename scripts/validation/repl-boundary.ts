import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const source = (path: string) => readFile(join(root, path), 'utf8')

function requirePattern(path: string, text: string, pattern: RegExp): void {
  if (!pattern.test(text))
    throw new Error(`[repl-boundary] ${path} is missing ${pattern}`)
}

function rejectPattern(path: string, text: string, pattern: RegExp): void {
  if (pattern.test(text))
    throw new Error(`[repl-boundary] ${path} contains forbidden ${pattern}`)
}

const facadePath = 'src/screens/REPL.tsx'
const facade = await source(facadePath)
if (facade.split(/\r?\n/).length > 20) {
  throw new Error('[repl-boundary] screens/REPL.tsx must remain a thin facade')
}
requirePattern(facadePath, facade, /from ['"]\.\/repl\/ReplController\.js['"]/)
for (const forbidden of [
  /useState\s*\(/,
  /useEffect\s*\(/,
  /useInput\s*\(/,
  /<Box\b/,
  /query\s*\(/,
]) {
  rejectPattern(facadePath, facade, forbidden)
}

const controllerPath = 'src/screens/repl/ReplController.tsx'
const controller = await source(controllerPath)
if (controller.split(/\r?\n/).length > 6_000) {
  throw new Error(
    '[repl-boundary] ReplController.tsx exceeded the post-split orchestration ceiling',
  )
}
for (const required of [
  /useMessageTimeline\s*\(/,
  /useReplInputState\s*\(/,
  /useTranscriptControls\s*\(/,
  /useReplAgentState\s*\(/,
  /buildDisplayedAgentMessages\s*\(/,
  /<TranscriptModeFooter\b/,
]) {
  requirePattern(controllerPath, controller, required)
}
for (const forbidden of [
  /function TranscriptModeFooter\s*\(/,
  /function TranscriptSearchBar\s*\(/,
  /function AnimatedTerminalTitle\s*\(/,
  /const \[messages, rawSetMessages\]/,
  /consumeEarlyInput\s*\(/,
  /getAgentTranscript\s*\(/,
]) {
  rejectPattern(controllerPath, controller, forbidden)
}

const layers = [
  'src/screens/repl/session/useMessageTimeline.ts',
  'src/screens/repl/input/useReplInputState.ts',
  'src/screens/repl/input/useTranscriptControls.ts',
  'src/screens/repl/agents/useReplAgentState.ts',
  'src/screens/repl/agents/agentMessages.ts',
  'src/screens/repl/view/TranscriptChrome.tsx',
]
for (const path of layers) {
  const text = await source(path)
  if (text.trim().length === 0)
    throw new Error(`[repl-boundary] ${path} must not be empty`)
}

console.log('[repl-boundary] PASS')
