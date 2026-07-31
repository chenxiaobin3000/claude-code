#!/usr/bin/env bun

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { FileWriteTool } from '../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.js'
import { processModelStream } from '../../src/services/model/streamProcessor.js'
import {
  createTruncatedToolInput,
  extractPartialJsonStringField,
  isTruncatedToolInput,
} from '../../src/services/tools/truncatedToolInput.js'
import {
  appendWriteRecoveryChunk,
  calculateWriteRecoveryChunkChars,
  completeWriteRecovery,
  createWriteRecoveryInstruction,
  createWriteRecoveryToolSchema,
  createWriteRecovery,
  getWriteRecoveryStatus,
  MAX_WRITE_RECOVERY_TRUNCATIONS,
  noteWriteRecoveryTruncation,
  stageTruncatedWriteInput,
} from '../../src/services/tools/writeRecovery.js'
import { prepareTools } from '../../src/services/model/prepareRequest.js'
import { writeTextContent } from '../../src/utils/file.js'
import { FileStateCache } from '../../src/utils/fileStateCache.js'
import {
  NodeFsOperations,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../src/utils/fsOperations.js'
import { assert, assertEqual, collectAsync } from './assertions.js'

;(globalThis as typeof globalThis & { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'write-truncation-recovery-validation',
}

async function* truncatedWriteEvents(): AsyncGenerator<BetaRawMessageStreamEvent> {
  yield {
    type: 'message_start',
    message: {
      id: 'msg_truncated_write',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'local-qwen',
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as BetaRawMessageStreamEvent
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: 'toolu_truncated_write',
      name: 'Write',
      input: {},
    },
  } as BetaRawMessageStreamEvent
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json:
        '{"file_path":"C:\\\\tmp\\\\large.txt","content":"unfinished',
    },
  } as BetaRawMessageStreamEvent
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'max_tokens', stop_sequence: null },
    usage: { output_tokens: 4096 },
  } as BetaRawMessageStreamEvent
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent
}

const streamed = await collectAsync(
  processModelStream({
    events: truncatedWriteEvents(),
    tools: [FileWriteTool],
    maxOutputTokens: 4096,
    startedAt: Date.now(),
  }),
)
const truncatedAssistant = streamed.find(
  message =>
    message.type === 'assistant' &&
    !message.apiError &&
    Array.isArray(message.message.content),
)
assert(truncatedAssistant, 'truncated Write assistant message was not produced')
const truncatedBlock = truncatedAssistant.message.content.find(
  block => typeof block !== 'string' && block.type === 'tool_use',
)
assert(
  truncatedBlock &&
    truncatedBlock.type === 'tool_use' &&
    isTruncatedToolInput(truncatedBlock.input),
  'max_tokens Write input was normalized to an executable value',
)
assert(
  !FileWriteTool.inputSchema.safeParse(truncatedBlock.input).success,
  'truncated marker passed the Write input schema',
)
assert(
  streamed.some(
    message =>
      message.type === 'assistant' && message.apiError === 'max_output_tokens',
  ),
  'max_tokens stream did not retain the truncation reason',
)
assertEqual(
  extractPartialJsonStringField('{"content":"line 1\\nline 2\\u0021', 'content')
    ?.value,
  'line 1\nline 2!',
  'partial JSON string extraction lost complete escapes',
)

const salvagedRecovery = createWriteRecovery('unregistered-local-qwen')
const salvagedOriginal = stageTruncatedWriteInput({
  recoveryId: salvagedRecovery.id,
  input: truncatedBlock.input,
  originalWrite: true,
})
assertEqual(
  salvagedOriginal.appendedChars,
  'unfinished'.length,
  'original truncated Write content was not staged',
)
const salvagedContinuation = stageTruncatedWriteInput({
  recoveryId: salvagedRecovery.id,
  input: createTruncatedToolInput(28, '{"chunk":"unfinished-more'),
  originalWrite: false,
})
assertEqual(
  salvagedContinuation.appendedChars,
  '-more'.length,
  'restarted recovery content was not deterministically de-duplicated',
)
const salvagedStatus = getWriteRecoveryStatus(salvagedRecovery.id)!
const salvagedFinal = appendWriteRecoveryChunk({
  recoveryId: salvagedRecovery.id,
  filePath: 'C:\\tmp\\large.txt',
  sequence: salvagedStatus.nextSequence,
  chunk: '!',
  final: true,
})
assert(
  salvagedFinal.complete && salvagedFinal.content === 'unfinished-more!',
  'salvaged recovery did not preserve byte-exact content',
)
completeWriteRecovery(salvagedRecovery.id)

assert(
  FileWriteTool.inputSchema.safeParse({
    file_path: 'C:\\tmp\\small.txt',
    content: 'small',
  }).success,
  'normal Write input was rejected',
)
assert(
  FileWriteTool.inputSchema.safeParse({
    file_path: 'C:\\tmp\\large.txt',
    recovery_id: '00000000-0000-4000-8000-000000000000',
    chunk: 'part',
    sequence: 0,
    final: false,
  }).success,
  'complete recovery Write input was rejected',
)

assertEqual(
  calculateWriteRecoveryChunkChars(4096),
  2150,
  '4096-token recovery chunk budget',
)

const oversizedChunkRecovery = createWriteRecovery('unregistered-local-qwen')
const oversizedChunk = `${'a'.repeat(2149)}😀${'b'.repeat(300)}`
const oversizedResult = appendWriteRecoveryChunk({
  recoveryId: oversizedChunkRecovery.id,
  filePath: 'C:\\tmp\\oversized.txt',
  sequence: 0,
  chunk: oversizedChunk,
  final: false,
})
assert(!oversizedResult.complete, 'oversized recovery chunk committed early')
assertEqual(
  oversizedResult.chunkCount,
  2,
  'oversized recovery chunk was not deterministically split',
)
const oversizedStatus = getWriteRecoveryStatus(oversizedChunkRecovery.id)!
assertEqual(
  oversizedStatus.stagedChars,
  oversizedChunk.length,
  'oversized recovery chunk lost characters while splitting',
)
const oversizedFinal = appendWriteRecoveryChunk({
  recoveryId: oversizedChunkRecovery.id,
  filePath: 'C:\\tmp\\oversized.txt',
  sequence: oversizedStatus.nextSequence,
  chunk: '!',
  final: true,
})
assert(
  oversizedFinal.complete && oversizedFinal.content === `${oversizedChunk}!`,
  'oversized recovery chunk did not preserve byte-exact content',
)
completeWriteRecovery(oversizedChunkRecovery.id)

const recovery = createWriteRecovery('unregistered-local-qwen')
assertEqual(
  recovery.truncationAttempts,
  0,
  'new recovery counted the original truncation as a recovery attempt',
)
const recoverySchema = createWriteRecoveryToolSchema(recovery) as unknown as {
  name: string
  input_schema: {
    required: string[]
    properties: Record<string, Record<string, unknown>>
  }
}
assertEqual(recoverySchema.name, 'Write', 'recovery schema tool name')
assert(
  !('content' in recoverySchema.input_schema.properties),
  'recovery schema still permits normal content',
)
assertEqual(
  recoverySchema.input_schema.properties.recovery_id?.const,
  recovery.id,
  'recovery schema did not lock the recovery ID',
)
assertEqual(
  recoverySchema.input_schema.properties.sequence?.const,
  0,
  'recovery schema did not lock the next sequence',
)
assertEqual(
  recoverySchema.input_schema.properties.chunk?.maxLength,
  2150,
  'recovery schema did not enforce the chunk limit',
)
assert(
  createWriteRecoveryInstruction(recovery).includes(
    'Do not use the normal content field',
  ),
  'recovery instruction permits a normal Write call',
)
const preparedRecoveryTools = await prepareTools([FileWriteTool], {
  model: 'unregistered-local-qwen',
  toolSchemasOverride: [recoverySchema as never],
} as never)
assertEqual(
  preparedRecoveryTools.toolSchemas.length,
  1,
  'recovery request did not replace the normal tool schemas',
)
assert(
  !(
    'content' in
    (
      preparedRecoveryTools.toolSchemas[0] as unknown as {
        input_schema: { properties: Record<string, unknown> }
      }
    ).input_schema.properties
  ),
  'prepared recovery request restored the normal Write schema',
)
const first = appendWriteRecoveryChunk({
  recoveryId: recovery.id,
  filePath: 'C:\\tmp\\large.txt',
  sequence: 0,
  chunk: 'alpha',
  final: false,
})
assert(!first.complete, 'non-final recovery chunk committed early')
const final = appendWriteRecoveryChunk({
  recoveryId: recovery.id,
  filePath: 'C:\\tmp\\large.txt',
  sequence: 1,
  chunk: 'βeta'.repeat(1000),
  final: true,
})
assert(final.complete, 'final recovery chunk did not complete')
assertEqual(
  final.content,
  `alpha${'βeta'.repeat(1000)}`,
  'recovery content was not byte-exact',
)
completeWriteRecovery(recovery.id)

const anchoredRecovery = createWriteRecovery('unregistered-local-qwen')
appendWriteRecoveryChunk({
  recoveryId: anchoredRecovery.id,
  filePath: 'C:\\tmp\\anchored.txt',
  sequence: 0,
  chunk: 'line1',
  final: false,
})
const anchoredFinal = appendWriteRecoveryChunk({
  recoveryId: anchoredRecovery.id,
  filePath: 'C:\\tmp\\anchored.txt',
  sequence: 1,
  chunk: 'line1\nline2',
  final: true,
})
assert(
  anchoredFinal.complete && anchoredFinal.content === 'line1\nline2',
  'recovery tail anchor did not preserve the boundary newline',
)
completeWriteRecovery(anchoredRecovery.id)

const stagedWriteDir = mkdtempSync(join(tmpdir(), 'write-recovery-commit-'))
const stagedWriteTarget = join(stagedWriteDir, 'complete.txt')
const stagedWrite = createWriteRecovery('unregistered-local-qwen')
const callContext = {
  readFileState: new FileStateCache(100, 25 * 1024 * 1024),
  updateFileHistoryState() {},
  dynamicSkillDirTriggers: new Set<string>(),
}
await FileWriteTool.call(
  {
    file_path: stagedWriteTarget,
    recovery_id: stagedWrite.id,
    chunk: 'first-',
    sequence: 0,
    final: false,
  },
  callContext as never,
  () => {},
  { uuid: 'write-recovery-parent' } as never,
  'write-recovery-tool-0',
)
assert(
  !existsSync(stagedWriteTarget),
  'intermediate recovery chunk modified the target file',
)
await FileWriteTool.call(
  {
    file_path: stagedWriteTarget,
    recovery_id: stagedWrite.id,
    chunk: '最后',
    sequence: 1,
    final: true,
  },
  callContext as never,
  () => {},
  { uuid: 'write-recovery-parent' } as never,
  'write-recovery-tool-1',
)
assertEqual(
  readFileSync(stagedWriteTarget, 'utf8'),
  'first-最后',
  'final recovery commit was not byte-exact',
)
rmSync(stagedWriteDir, { recursive: true, force: true })

const pathLocked = createWriteRecovery('unregistered-local-qwen')
appendWriteRecoveryChunk({
  recoveryId: pathLocked.id,
  filePath: 'C:\\tmp\\one.txt',
  sequence: 0,
  chunk: 'one',
  final: false,
})
let pathChangeRejected = false
try {
  appendWriteRecoveryChunk({
    recoveryId: pathLocked.id,
    filePath: 'C:\\tmp\\two.txt',
    sequence: 1,
    chunk: 'two',
    final: true,
  })
} catch {
  pathChangeRejected = true
}
assert(pathChangeRejected, 'recovery accepted a changed target path')

const noProgress = createWriteRecovery('unregistered-local-qwen')
let emptyChunkRejected = false
try {
  appendWriteRecoveryChunk({
    recoveryId: noProgress.id,
    filePath: 'C:\\tmp\\empty.txt',
    sequence: 0,
    chunk: '',
    final: false,
  })
} catch {
  emptyChunkRejected = true
}
assert(emptyChunkRejected, 'empty non-final recovery chunk made progress')

const retryBound = createWriteRecovery('unregistered-local-qwen')
let retryStatus = retryBound
while (retryStatus.truncationAttempts < MAX_WRITE_RECOVERY_TRUNCATIONS) {
  retryStatus = noteWriteRecoveryTruncation(retryBound.id)!
}
assertEqual(
  retryStatus.truncationAttempts,
  3,
  'recovery truncation budget was not tracked across chunks',
)
assertEqual(
  retryStatus.suggestedChunkChars,
  268,
  'recovery chunk limit did not shrink after repeated truncation',
)

const conflictDir = mkdtempSync(join(tmpdir(), 'write-recovery-conflict-'))
const conflictTarget = join(conflictDir, 'existing.txt')
writeFileSync(conflictTarget, 'before', 'utf8')
const conflictRecovery = createWriteRecovery('unregistered-local-qwen')
appendWriteRecoveryChunk({
  recoveryId: conflictRecovery.id,
  filePath: conflictTarget,
  sequence: 0,
  chunk: 'replacement-',
  final: false,
})
const lockedStatus = getWriteRecoveryStatus(pathLocked.id)!
const lockedSchema = createWriteRecoveryToolSchema(lockedStatus) as unknown as {
  input_schema: {
    properties: Record<string, Record<string, unknown>>
  }
}
assertEqual(
  lockedSchema.input_schema.properties.file_path?.const,
  'C:\\tmp\\one.txt',
  'recovery schema did not lock the established target path',
)
assertEqual(
  lockedStatus.truncationAttempts,
  0,
  'successful recovery chunk did not reset the sequence retry count',
)
writeFileSync(conflictTarget, 'external', 'utf8')
let conflictRejected = false
try {
  appendWriteRecoveryChunk({
    recoveryId: conflictRecovery.id,
    filePath: conflictTarget,
    sequence: 1,
    chunk: 'final',
    final: true,
  })
} catch {
  conflictRejected = true
}
assert(conflictRejected, 'external target modification was not detected')
assertEqual(
  readFileSync(conflictTarget, 'utf8'),
  'external',
  'conflict handling overwrote the external modification',
)
rmSync(conflictDir, { recursive: true, force: true })

const rollbackDir = mkdtempSync(join(tmpdir(), 'write-recovery-'))
const rollbackTarget = join(rollbackDir, 'existing.txt')
writeFileSync(rollbackTarget, 'original', 'utf8')
setFsImplementation({
  ...NodeFsOperations,
  renameSync() {
    throw new Error('forced atomic rename failure')
  },
})
let atomicFailureSurfaced = false
try {
  writeTextContent(rollbackTarget, 'replacement', 'utf8', 'LF', true)
} catch {
  atomicFailureSurfaced = true
} finally {
  setOriginalFsImplementation()
}
assert(atomicFailureSurfaced, 'strict atomic write silently fell back')
assertEqual(
  readFileSync(rollbackTarget, 'utf8'),
  'original',
  'atomic failure modified the original file',
)
assertEqual(
  readdirSync(rollbackDir).filter(name => name.includes('.tmp.')).length,
  0,
  'atomic failure left a temporary file',
)
rmSync(rollbackDir, { recursive: true, force: true })

const querySource = await Bun.file('src/query.ts').text()
assert(
  querySource.includes('findTruncatedWriteToolUse') &&
    querySource.includes('createWriteRecovery') &&
    querySource.includes(
      'if (!truncatedWrite && msgToolUseBlocks.length > 0)',
    ) &&
    querySource.includes('createWriteRecoveryToolSchema') &&
    querySource.includes("type: 'tool', name: FILE_WRITE_TOOL_NAME") &&
    querySource.includes('toolSchemasOverride'),
  'query no longer blocks or recovers truncated Write calls',
)
const messageSource = await Bun.file('src/utils/messagesRuntime.ts').text()
assert(
  messageSource.includes("stopReason === 'max_tokens'") &&
    messageSource.includes('truncatedToolInput.createFromRaw') &&
    messageSource.includes(
      '!truncatedToolInput.isTruncatedToolInput(normalizedInput)',
    ),
  'message normalization no longer preserves truncated tool input state',
)
const fileWriteSource = await Bun.file(
  'packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts',
).text()
assert(
  fileWriteSource.includes('await writeTextContentWithRetry(') &&
    fileWriteSource.includes('oldContent,'),
  'Write no longer requires version-checked atomic replacement recovery',
)

console.log('[write-truncation-recovery] PASS')
