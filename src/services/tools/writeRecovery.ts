import { createHash, randomUUID } from 'node:crypto'
import { getModelProfile } from '../../utils/model/modelProfiles.js'
import { isENOENT } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'

const MAX_RECOVERY_BYTES = 8 * 1024 * 1024
const MAX_RECOVERY_CHUNKS = 32
const MAX_RECOVERY_AGE_MS = 30 * 60 * 1000
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
export const MAX_WRITE_RECOVERY_TRUNCATIONS = 3

type WriteRecoveryState = {
  id: string
  model: string
  maxOutputTokens: number
  suggestedChunkChars: number
  targetPath?: string
  chunks: string[]
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
> & { nextSequence: number; targetPath?: string }
  & { truncationAttempts: number }

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
  const state: WriteRecoveryState = {
    id: randomUUID(),
    model,
    maxOutputTokens,
    suggestedChunkChars:
      calculateWriteRecoveryChunkChars(maxOutputTokens),
    chunks: [],
    bytes: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    truncationAttempts: 1,
  }
  recoveries.set(state.id, state)
  return {
    id: state.id,
    model: state.model,
    maxOutputTokens: state.maxOutputTokens,
    suggestedChunkChars: state.suggestedChunkChars,
    nextSequence: 0,
    truncationAttempts: 1,
  }
}

export function noteWriteRecoveryTruncation(
  recoveryId: string,
): WriteRecoveryInfo | undefined {
  const state = recoveries.get(recoveryId)
  if (!state) return undefined
  state.truncationAttempts++
  state.updatedAt = Date.now()
  return getWriteRecoveryStatus(recoveryId)
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

  if (
    state.pendingFinal &&
    state.pendingFinal.sequence === input.sequence &&
    state.pendingFinal.chunk === input.chunk &&
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
  if (input.chunk.length > state.suggestedChunkChars) {
    throw new Error(
      `Write recovery chunk is too large (${input.chunk.length} characters); use at most ${state.suggestedChunkChars}.`,
    )
  }

  const nextBytes = state.bytes + Buffer.byteLength(input.chunk, 'utf8')
  if (nextBytes > MAX_RECOVERY_BYTES) {
    throw new Error(
      `Write recovery exceeded the ${MAX_RECOVERY_BYTES}-byte staging limit.`,
    )
  }
  if (!input.final && input.chunk.length === 0) {
    throw new Error('Write recovery made no progress with an empty chunk.')
  }

  state.updatedAt = Date.now()
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
    const content = state.chunks.join('') + input.chunk
    state.pendingFinal = {
      sequence: input.sequence,
      chunk: input.chunk,
      content,
    }
    return {
      complete: true,
      chunkCount: state.chunks.length + 1,
      bytes: nextBytes,
      content,
    }
  }

  state.chunks.push(input.chunk)
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
    truncationAttempts: state.truncationAttempts,
  }
}
