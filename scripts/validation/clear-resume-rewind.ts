import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { filterResumableSessions } from '../../src/commands/resume/resume.js'
import type { LogOption } from '../../src/types/logs.js'
import { assert, assertDeepEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')
const oldSessionId = '00000000-0000-4000-8000-000000000001'
const currentSessionId = '00000000-0000-4000-8000-000000000002'
const makeLog = (sessionId: string, isSidechain = false) =>
  ({ sessionId, isSidechain, messages: [] }) as unknown as LogOption

assertDeepEqual(
  filterResumableSessions(
    [makeLog(oldSessionId), makeLog(currentSessionId), makeLog('00000000-0000-4000-8000-000000000003', true)],
    currentSessionId,
  ).map(log => log.sessionId),
  [oldSessionId],
  '/resume must retain a pre-/clear session while excluding the current and sidechain sessions',
)

const [clearConversation, resume, rewind] = await Promise.all([
  readFile(resolve(root, 'src/commands/clear/conversation.ts'), 'utf8'),
  readFile(resolve(root, 'src/screens/repl/session/useConversationResume.ts'), 'utf8'),
  readFile(resolve(root, 'src/commands/rewind/rewind.ts'), 'utf8'),
])

assert(
  clearConversation.includes('regenerateSessionId({ setCurrentAsParent: true })') &&
    clearConversation.includes('resetSessionFilePointer()'),
  '/clear must create a new session file while preserving the old session as lineage',
)
assert(
  resume.includes('deserializeMessages(log.messages)') &&
    resume.includes('copyFileHistoryForResume(log)') &&
    resume.includes('switchSession(') &&
    resume.includes('adoptResumedSessionFile()'),
  '/resume must restore the selected transcript, file checkpoints, and active session pointer',
)
assert(
  rewind.includes('context.openMessageSelector()') &&
    !rewind.includes('loadFullLog('),
  '/rewind must operate on the current session selector rather than load another session',
)

console.log('[clear-resume-rewind] PASS')
