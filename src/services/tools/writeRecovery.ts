import { createHash, randomUUID } from 'node:crypto'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { getModelProfile } from '../../utils/model/modelProfiles.js'
import { isENOENT } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  extractPartialJsonStringField,
  type TruncatedToolInput,
} from './truncatedToolInput.js'

const MAX_RECOVERY_BYTES = 8 * 1024 * 1024
const MAX_RECOVERY_CHUNKS = 32
const MAX_RECOVERY_AGE_MS = 30 * 60 * 1000
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
const MIN_RECOVERY_CHUNK_CHARS = 256
export const MAX_WRITE_RECOVERY_TRUNCATIONS = 3

type WriteRecoveryState = {
  id: string
  model: string
  maxOutputTokens: number
  suggestedChunkChars: number
  targetPath?: string
  chunks: string[]
  chars: number
  bytes: number
  createdAt: number
  updatedAt: number
  pendingFinal?: {
    sequence: number
    chunk: string
    content: string
  }
  truncationAttempts: number
  targetSnapshot?: { exists: boolean; digest?: string }
}

export type WriteRecoveryInfo = Pick<
  WriteRecoveryState,
  'id' | 'model' | 'maxOutputTokens' | 'suggestedChunkChars'
> & {
  nextSequence: number
  targetPath?: string
  stagedChars: number
  stagedBytes: number
  stagedTail: string
  truncationAttempts: number
}

export type WriteRecoveryAppendResult =
  | {
      complete: false
      chunkCount: number
      bytes: number
    }
  | {
      complete: true
      chunkCount: number
      bytes: number
      content: string
    }

export type TruncatedWriteStageResult = {
  appendedChars: number
  stagedChars: number
  targetPath?: string
}

const recoveries = new Map<string, WriteRecoveryState>()

function captureTargetSnapshot(filePath: string): {
  exists: boolean
  digest?: string
} {
  const fs = getFsImplementation()
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      throw new Error(
        `Write recovery cannot snapshot an existing file larger than ${MAX_SNAPSHOT_BYTES} bytes.`,
      )
    }
    const digest = createHash('sha256')
      .update(fs.readFileBytesSync(filePath))
      .digest('hex')
    return { exists: true, digest }
  } catch (error) {
    if (isENOENT(error)) return { exists: false }
    throw error
  }
}

function pruneExpiredRecoveries(now = Date.now()): void {
  for (const [id, state] of recoveries) {
    if (now - state.updatedAt > MAX_RECOVERY_AGE_MS) {
      recoveries.delete(id)
    }
  }
}

export function calculateWriteRecoveryChunkChars(
  maxOutputTokens: number,
): number {
  const reserve = Math.max(1024, Math.floor(maxOutputTokens * 0.25))
  const usable = Math.max(512, maxOutputTokens - reserve)
  return Math.max(512, Math.min(16_384, Math.floor(usable * 0.7)))
}

export function createWriteRecovery(model: string): WriteRecoveryInfo {
  pruneExpiredRecoveries()
  const maxOutputTokens = getModelProfile(model).maxOutputTokens
  const initialChunkChars = calculateWriteRecoveryChunkChars(maxOutputTokens)
  const state: WriteRecoveryState = {
    id: randomUUID(),
    model,
    maxOutputTokens,
    suggestedChunkChars: initialChunkChars,
    chunks: [],
    chars: 0,
    bytes: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    truncationAttempts: 0,
  }
  recoveries.set(state.id, state)
  return {
    id: state.id,
    model: state.model,
    maxOutputTokens: state.maxOutputTokens,
    suggestedChunkChars: state.suggestedChunkChars,
    nextSequence: 0,
    stagedChars: 0,
    stagedBytes: 0,
    stagedTail: '',
    truncationAttempts: 0,
  }
}

export function noteWriteRecoveryTruncation(
  recoveryId: string,
): WriteRecoveryInfo | undefined {
  const state = recoveries.get(recoveryId)
  if (!state) return undefined
  state.truncationAttempts++
  state.suggestedChunkChars = Math.max(
    MIN_RECOVERY_CHUNK_CHARS,
    Math.floor(state.suggestedChunkChars / 2),
  )
  state.updatedAt = Date.now()
  return getWriteRecoveryStatus(recoveryId)
}

export function createWriteRecoveryToolSchema(
  recovery: WriteRecoveryInfo,
): BetaToolUnion {
  const filePathSchema: Record<string, unknown> = {
    type: 'string',
    description:
      recovery.targetPath === undefined
        ? 'The exact absolute target path from the original Write request'
        : 'The locked absolute target path for this recovery',
    ...(recovery.targetPath !== undefined && {
      const: recovery.targetPath,
    }),
  }

  return {
    name: FILE_WRITE_TOOL_NAME,
    description:
      `Continue the active file recovery with exactly one bounded chunk. ` +
      `When staged content exists, begin chunk with the exact staged-tail anchor ` +
      `from the recovery instruction, then continue with the next character. ` +
      `Never restart or send the complete file. The chunk must contain ` +
      `at most ${recovery.suggestedChunkChars} characters.`,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file_path: filePathSchema,
        recovery_id: {
          type: 'string',
          const: recovery.id,
          description: 'The locked recovery identifier',
        },
        chunk: {
          type: 'string',
          maxLength: recovery.suggestedChunkChars,
          description:
            `Only the next consecutive content segment, with at most ` +
            `${recovery.suggestedChunkChars} characters`,
        },
        sequence: {
          type: 'integer',
          const: recovery.nextSequence,
          description: 'The exact next recovery sequence number',
        },
        final: {
          type: 'boolean',
          description:
            'True only when this chunk contains the final remaining content',
        },
      },
      required: ['file_path', 'recovery_id', 'chunk', 'sequence', 'final'],
    },
  } as BetaToolUnion
}

export function createWriteRecoveryInstruction(
  recovery: WriteRecoveryInfo,
): string {
  const position =
    recovery.nextSequence === 0
      ? 'Begin with the first character of the requested file.'
      : `There are ${recovery.stagedChars} characters already staged. ` +
        `Begin chunk by repeating this exact anchor: ${JSON.stringify(recovery.stagedTail)}. ` +
        `Immediately after the anchor, emit the first remaining character, including a newline or whitespace when that is the next character. ` +
        `Do not restart the file or omit the boundary character.`
  return (
    `An active Write recovery is waiting for sequence ${recovery.nextSequence}. ` +
    `${position} Call Write exactly once using only file_path, recovery_id, ` +
    `chunk, sequence, and final. recovery_id=${JSON.stringify(recovery.id)}. ` +
    `The chunk must be no longer than ${recovery.suggestedChunkChars} characters. ` +
    `Set final=true only when no requested content remains. Do not use the normal content field and do not answer with text.`
  )
}

function removeRepeatedPrefix(state: WriteRecoveryState, fragment: string) {
  if (state.chars === 0 || fragment.length === 0) return fragment
  const staged = state.chunks.join('')
  if (staged.startsWith(fragment)) return ''
  if (fragment.startsWith(staged)) return fragment.slice(staged.length)

  const maxOverlap = Math.min(staged.length, fragment.length)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (staged.endsWith(fragment.slice(0, overlap))) {
      return fragment.slice(overlap)
    }
  }
  return fragment
}

/** Split a parsed string without leaving a UTF-16 surrogate pair half intact. */
function splitRecoveryChunk(value: string, maxChars: number): string[] {
  const chunks: string[] = []
  for (let start = 0; start < value.length; ) {
    let end = Math.min(start + maxChars, value.length)
    if (
      end < value.length &&
      end > start &&
      /[\uD800-\uDBFF]/.test(value.charAt(end - 1)) &&
      /[\uDC00-\uDFFF]/.test(value.charAt(end))
    ) {
      end--
    }
    chunks.push(value.slice(start, end))
    start = end
  }
  return chunks
}

/**
 * Deterministically stages complete characters from a max-token-truncated
 * Write JSON payload. Recovery control fields are never trusted here.
 */
export function stageTruncatedWriteInput(params: {
  recoveryId: string
  input: TruncatedToolInput
  originalWrite: boolean
}): TruncatedWriteStageResult {
  const state = recoveries.get(params.recoveryId)
  if (!state || !params.input.rawInput) {
    return {
      appendedChars: 0,
      stagedChars: state?.chars ?? 0,
      targetPath: state?.targetPath,
    }
  }

  const field = params.originalWrite ? 'content' : 'chunk'
  const extracted = extractPartialJsonStringField(params.input.rawInput, field)
  const filePath = params.originalWrite
    ? extractPartialJsonStringField(params.input.rawInput, 'file_path')?.value
    : state.targetPath
  if (!extracted || !filePath) {
    return {
      appendedChars: 0,
      stagedChars: state.chars,
      targetPath: state.targetPath,
    }
  }

  const fragment = removeRepeatedPrefix(state, extracted.value)
  let appendedChars = 0
  for (
    let offset = 0;
    offset < fragment.length;
    offset += state.suggestedChunkChars
  ) {
    const chunk = fragment.slice(offset, offset + state.suggestedChunkChars)
    appendWriteRecoveryChunk({
      recoveryId: state.id,
      filePath,
      sequence: state.chunks.length,
      chunk,
      final: false,
    })
    appendedChars += chunk.length
  }
  const status = getWriteRecoveryStatus(state.id)
  return {
    appendedChars,
    stagedChars: status?.stagedChars ?? state.chars,
    targetPath: status?.targetPath,
  }
}

export function appendWriteRecoveryChunk(input: {
  recoveryId: string
  filePath: string
  sequence: number
  chunk: string
  final: boolean
}): WriteRecoveryAppendResult {
  pruneExpiredRecoveries()
  const state = recoveries.get(input.recoveryId)
  if (!state) {
    throw new Error(
      'Write recovery expired or is unknown. Start a new complete Write call.',
    )
  }

  if (state.targetPath === undefined) {
    state.targetPath = input.filePath
    state.targetSnapshot = captureTargetSnapshot(input.filePath)
  } else if (state.targetPath !== input.filePath) {
    throw new Error('Write recovery target path changed; recovery aborted.')
  }

  const stagedTail = state.chunks.join('').slice(-512)
  const chunk =
    stagedTail.length > 0 && input.chunk.startsWith(stagedTail)
      ? input.chunk.slice(stagedTail.length)
      : input.chunk

  if (
    state.pendingFinal &&
    state.pendingFinal.sequence === input.sequence &&
    state.pendingFinal.chunk === chunk &&
    input.final
  ) {
    return {
      complete: true,
      chunkCount: state.chunks.length + 1,
      bytes: Buffer.byteLength(state.pendingFinal.content, 'utf8'),
      content: state.pendingFinal.content,
    }
  }

  if (state.pendingFinal) {
    throw new Error('Write recovery is already waiting for its final commit.')
  }
  if (input.sequence !== state.chunks.length) {
    throw new Error(
      `Write recovery expected chunk ${state.chunks.length}, received ${input.sequence}.`,
    )
  }
  if (input.sequence >= MAX_RECOVERY_CHUNKS) {
    throw new Error(
      `Write recovery exceeded the ${MAX_RECOVERY_CHUNKS}-chunk limit.`,
    )
  }
  const chunks = input.final
    ? [chunk]
    : splitRecoveryChunk(chunk, state.suggestedChunkChars)
  if (state.chunks.length + chunks.length > MAX_RECOVERY_CHUNKS) {
    throw new Error(
      `Write recovery exceeded the ${MAX_RECOVERY_CHUNKS}-chunk limit.`,
    )
  }
  const nextBytes =
    state.bytes +
    chunks.reduce((total, part) => total + Buffer.byteLength(part, 'utf8'), 0)
  if (nextBytes > MAX_RECOVERY_BYTES) {
    throw new Error(
      `Write recovery exceeded the ${MAX_RECOVERY_BYTES}-byte staging limit.`,
    )
  }
  if (!input.final && chunk.length === 0) {
    throw new Error('Write recovery made no progress with an empty chunk.')
  }

  state.updatedAt = Date.now()
  state.truncationAttempts = 0
  if (input.final) {
    const currentSnapshot = captureTargetSnapshot(input.filePath)
    if (
      currentSnapshot.exists !== state.targetSnapshot?.exists ||
      currentSnapshot.digest !== state.targetSnapshot?.digest
    ) {
      recoveries.delete(input.recoveryId)
      throw new Error(
        'Target file changed while Write recovery was in progress; recovery aborted.',
      )
    }
    const content = state.chunks.join('') + chunk
    state.pendingFinal = {
      sequence: input.sequence,
      chunk,
      content,
    }
    return {
      complete: true,
      chunkCount: state.chunks.length + 1,
      bytes: nextBytes,
      content,
    }
  }

  state.chunks.push(...chunks)
  state.chars += chunk.length
  state.bytes = nextBytes
  return {
    complete: false,
    chunkCount: state.chunks.length,
    bytes: state.bytes,
  }
}

export function completeWriteRecovery(recoveryId: string): void {
  recoveries.delete(recoveryId)
}

export function abortWriteRecovery(recoveryId: string): void {
  recoveries.delete(recoveryId)
}

export function getWriteRecoveryStatus(
  recoveryId: string,
): WriteRecoveryInfo | undefined {
  const state = recoveries.get(recoveryId)
  if (!state) return undefined
  return {
    id: state.id,
    model: state.model,
    maxOutputTokens: state.maxOutputTokens,
    suggestedChunkChars: state.suggestedChunkChars,
    nextSequence: state.chunks.length,
    targetPath: state.targetPath,
    stagedChars: state.chars,
    stagedBytes: state.bytes,
    stagedTail: state.chunks.join('').slice(-512),
    truncationAttempts: state.truncationAttempts,
  }
}
