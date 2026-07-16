import { useCallback, useRef, useState } from 'react'

export type ApiMetric = {
  ttftMs: number
  firstTokenTime: number
  lastTokenTime: number
  responseLengthBaseline: number
  endResponseLength: number
}

export function useQueryMetrics(showStreamingText: boolean) {
  const responseLengthRef = useRef(0)
  const apiMetricsRef = useRef<ApiMetric[]>([])
  const setResponseLength = useCallback(
    (update: (previous: number) => number) => {
      const previous = responseLengthRef.current
      responseLengthRef.current = update(previous)
      if (responseLengthRef.current > previous) {
        const latest = apiMetricsRef.current.at(-1)
        if (latest) {
          latest.lastTokenTime = Date.now()
          latest.endResponseLength = responseLengthRef.current
        }
      }
    },
    [],
  )

  const [streamingText, setStreamingText] = useState<string | null>(null)
  const onStreamingText = useCallback(
    (update: (current: string | null) => string | null) => {
      if (showStreamingText) setStreamingText(update)
    },
    [showStreamingText],
  )
  const visibleStreamingText =
    streamingText && showStreamingText
      ? streamingText.substring(0, streamingText.lastIndexOf('\n') + 1) || null
      : null

  return {
    responseLengthRef,
    apiMetricsRef,
    setResponseLength,
    streamingText,
    setStreamingText,
    onStreamingText,
    visibleStreamingText,
  }
}
