import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  StreamEvent,
  SystemAPIErrorMessage,
  AssistantMessage,
} from '../../../types/message.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  createSafeError,
  sanitizeErrorDetails,
  summarizeModelPayload,
} from '../../../utils/logRedaction.js'
import { addToTotalSessionCost } from '../../../cost-tracker.js'
import { calculateUSDCost } from '../../../utils/modelCost.js'
import {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
} from './requestBody.js'
import { recordLLMObservation } from '../../../services/langfuse/tracing.js'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
  convertToolsToLangfuse,
} from '../../../services/langfuse/convert.js'
export {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
}
import { randomUUID } from 'crypto'
import { createAssistantAPIErrorMessage } from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import {
  logModelRequestError,
  logModelRequestFirstToken,
  logModelRequestStart,
  logModelRequestSuccess,
} from '../modelDiagnostics.js'
import type { PreparedModelRequest } from '../../model/types.js'
import { openAIProvider } from '../../model/providers/openaiProvider.js'
import { processModelStream } from '../../model/streamProcessor.js'

/**
 * OpenAI-compatible query path. Converts Anthropic-format messages/tools to
 * OpenAI format, calls the OpenAI-compatible endpoint, and converts the
 * SSE stream back to Anthropic BetaRawMessageStreamEvent for consumption
 * by the existing query pipeline.
 */
export async function* queryModelOpenAI(
  prepared: PreparedModelRequest,
  signal: AbortSignal,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  const {
    allTools: tools,
    filteredTools,
    toolSchemas,
    deferredToolNames,
    useSearchExtraTools,
    options,
  } = prepared
  const requestId = randomUUID()
  const requestStartedAt = Date.now()
  let diagnosticModel = options.model
  let sensitiveRequestValues: string[] = []

  try {
    const providerStream = await openAIProvider.createStream(prepared, signal, {
      requestId,
    })
    const openaiModel = providerStream.model
    const adaptedStream = providerStream.events
    const {
      endpoint,
      requestMessages: openaiMessages,
      requestTools: openaiTools,
      maxOutputTokens: maxTokens,
      thinking: enableThinking,
    } = providerStream.metadata
    diagnosticModel = openaiModel
    sensitiveRequestValues = providerStream.metadata.sensitiveValues

    if (useSearchExtraTools) {
      const includedDeferredTools = filteredTools.filter(t =>
        deferredToolNames.has(t.name),
      ).length
      logForDebugging(
        `[OpenAI] Tool search enabled: ${includedDeferredTools}/${deferredToolNames.size} deferred tools included, total tools=${openaiTools.length}`,
      )
    } else {
      logForDebugging(
        `[OpenAI] Tool search disabled, total tools=${openaiTools.length}`,
      )
    }

    const inputSummary = summarizeModelPayload(openaiMessages)
    logModelRequestStart({
      requestId,
      provider: 'openai',
      model: openaiModel,
      endpoint,
      messageCount: openaiMessages.length,
      inputChars: inputSummary.serializedChars,
      toolCount: openaiTools.length,
      maxOutputTokens: maxTokens,
      thinking: enableThinking,
      source: options.querySource,
    })

    logForDebugging(
      `[OpenAI] Calling model=${openaiModel}, messages=${openaiMessages.length}, tools=${openaiTools.length}, thinking=${enableThinking}`,
    )

    const summary = yield* processModelStream({
      events: adaptedStream,
      tools,
      agentId: options.agentId,
      maxOutputTokens: maxTokens,
      startedAt: requestStartedAt,
      onFirstToken: ttftMs =>
        logModelRequestFirstToken({
          requestId,
          provider: 'openai',
          model: openaiModel,
          ttftMs,
        }),
    })
    const {
      messages: collectedMessages,
      usage,
      stopReason,
      ttftMs,
      firstTokenReceived,
    } = summary

    if (usage.input_tokens + usage.output_tokens > 0) {
      const costUSD = calculateUSDCost(
        openaiModel,
        usage as unknown as BetaUsage,
      )
      addToTotalSessionCost(
        costUSD,
        usage as unknown as BetaUsage,
        options.model,
      )
    }

    const toolCallCount = collectedMessages.reduce((count, message) => {
      if (!Array.isArray(message.message.content)) return count
      return (
        count +
        message.message.content.filter(
          block => typeof block !== 'string' && block.type === 'tool_use',
        ).length
      )
    }, 0)
    logModelRequestSuccess({
      requestId,
      provider: 'openai',
      model: openaiModel,
      durationMs: Date.now() - requestStartedAt,
      ttftMs: firstTokenReceived ? ttftMs : null,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      stopReason,
      toolCallCount,
    })

    // Record LLM observation in Langfuse (no-op if not configured)
    recordLLMObservation(options.langfuseTrace ?? null, {
      model: openaiModel,
      provider: 'openai',
      input: convertMessagesToLangfuse(
        openaiMessages as Parameters<typeof convertMessagesToLangfuse>[0],
      ),
      output: convertOutputToLangfuse(collectedMessages),
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
      },
      startTime: new Date(requestStartedAt),
      endTime: new Date(),
      completionStartTime:
        ttftMs > 0 ? new Date(requestStartedAt + ttftMs) : undefined,
      tools: convertToolsToLangfuse(toolSchemas as unknown[]),
      ...(enableThinking && { thinking: { type: 'enabled' } }),
    })
  } catch (error) {
    const sanitizedError = sanitizeErrorDetails(error, {
      secrets: sensitiveRequestValues,
    })
    logModelRequestError({
      requestId,
      provider: 'openai',
      model: diagnosticModel,
      durationMs: Date.now() - requestStartedAt,
      error: sanitizedError,
    })
    const safeError = createSafeError(sanitizedError)
    yield createAssistantAPIErrorMessage({
      content: `API Error: ${sanitizedError.message}`,
      apiError: 'api_error',
      error: safeError as unknown as SDKAssistantMessageError,
    })
  }
}
