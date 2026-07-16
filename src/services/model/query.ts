import type {
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import { queryModelOpenAI } from '../api/openai/index.js'
import type { PreparedModelRequest } from './types.js'

/** Single provider dispatch point for the OpenAI-only runtime. */
export async function* queryPreparedModel(
  request: PreparedModelRequest,
  signal: AbortSignal,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  boolean,
  void
> {
  yield* queryModelOpenAI(request, signal)
  return true
}
