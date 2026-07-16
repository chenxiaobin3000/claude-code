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
if (controller.split(/\r?\n/).length > 1_800) {
  throw new Error(
    '[repl-boundary] ReplController.tsx exceeded the controller ceiling',
  )
}
requirePattern(
  controllerPath,
  controller,
  /from ['"]\.\/ReplRuntimeController\.js['"]/,
)
for (const forbidden of [
  /useState\s*\(/,
  /useEffect\s*\(/,
  /query\s*\(/,
  /<ReplView\b/,
]) {
  rejectPattern(controllerPath, controller, forbidden)
}

const runtimeControllerPath = 'src/screens/repl/ReplRuntimeController.tsx'
const runtimeController = await source(runtimeControllerPath)
if (runtimeController.split(/\r?\n/).length > 3_500) {
  throw new Error(
    '[repl-boundary] ReplRuntimeController.tsx exceeded the runtime orchestration ceiling',
  )
}
for (const required of [
  /useMessageTimeline\s*\(/,
  /useReplInputState\s*\(/,
  /useTranscriptControls\s*\(/,
  /useReplAgentState\s*\(/,
  /usePipeRouting\s*\(/,
  /usePipeLifecycle\s*\(/,
  /useRemoteRuntime\s*\(/,
  /useQueryEvents\s*\(/,
  /useQueryExecution\s*\(/,
  /useQueryRunner\s*\(/,
  /usePromptSubmission\s*\(/,
  /useConversationResume\s*\(/,
  /useConversationActions\s*\(/,
  /useAgentActions\s*\(/,
  /<ReplView\b/,
]) {
  requirePattern(runtimeControllerPath, runtimeController, required)
}
for (const forbidden of [
  /function TranscriptModeFooter\s*\(/,
  /function TranscriptSearchBar\s*\(/,
  /function AnimatedTerminalTitle\s*\(/,
  /const \[messages, rawSetMessages\]/,
  /consumeEarlyInput\s*\(/,
  /getAgentTranscript\s*\(/,
  /const onQueryEvent = useCallback\s*\(/,
  /const onQueryImpl = useCallback\s*\(/,
  /const onQuery = useCallback\s*\(/,
  /const onSubmit = useCallback\s*\(/,
  /const resume = useCallback\s*\(/,
  /handleMessageFromStream\s*\(/,
  /useRemoteSession\s*\(/,
  /useDirectConnect\s*\(/,
  /useSSHSession\s*\(/,
  /usePipeIpc\s*\(/,
  /<TranscriptModeFooter\b/,
]) {
  rejectPattern(runtimeControllerPath, runtimeController, forbidden)
}

const mainViewPath = 'src/screens/repl/view/ReplView.tsx'
const mainView = await source(mainViewPath)
for (const required of [
  /buildDisplayedAgentMessages\s*\(/,
  /<TranscriptScreen\b/,
  /<ReplDialogLayer\b/,
  /<ReplMessageSelector\b/,
]) {
  requirePattern(mainViewPath, mainView, required)
}
for (const forbidden of [
  /queryGuard\./,
  /launchUltraplan\s*\(/,
  /partialCompactConversation\s*\(/,
  /clearConversation\s*\(/,
  /setConversationId\s*\(/,
  /useRemoteRuntime\s*\(/,
  /switchSession\s*\(/,
]) {
  rejectPattern(mainViewPath, mainView, forbidden)
}

const layers = [
  'src/screens/repl/session/useMessageTimeline.ts',
  'src/screens/repl/session/useConversationResume.ts',
  'src/screens/repl/session/useConversationActions.ts',
  'src/screens/repl/input/useReplInputState.ts',
  'src/screens/repl/input/useTranscriptControls.ts',
  'src/screens/repl/input/usePromptSubmission.ts',
  'src/screens/repl/agents/useReplAgentState.ts',
  'src/screens/repl/agents/agentMessages.ts',
  'src/screens/repl/agents/useAgentActions.tsx',
  'src/screens/repl/query/useQueryMetrics.ts',
  'src/screens/repl/query/useQueryEvents.ts',
  'src/screens/repl/query/useQueryExecution.ts',
  'src/screens/repl/query/useQueryRunner.ts',
  'src/screens/repl/runtime/usePipeRuntime.ts',
  'src/screens/repl/runtime/useRemoteRuntime.ts',
  'src/screens/repl/interaction/useCancelInteraction.ts',
  'src/screens/repl/interaction/useExitInteraction.tsx',
  'src/screens/repl/interaction/ReplDialogLayer.tsx',
  'src/screens/repl/interaction/ReplMessageSelector.tsx',
  'src/screens/repl/view/ReplView.tsx',
  'src/screens/repl/view/TranscriptChrome.tsx',
  'src/screens/repl/view/TranscriptScreen.tsx',
  'src/screens/repl/view/dialogFocus.ts',
]
for (const path of layers) {
  const text = await source(path)
  if (text.trim().length === 0)
    throw new Error(`[repl-boundary] ${path} must not be empty`)
  if (text.split(/\r?\n/).length > 800)
    throw new Error(
      `[repl-boundary] ${path} exceeded the 800-line layer ceiling`,
    )
}

console.log('[repl-boundary] PASS')
