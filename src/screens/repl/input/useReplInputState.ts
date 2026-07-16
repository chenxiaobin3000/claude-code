import { useCallback, useEffect, useRef, useState } from 'react'
import type { PastedContent } from '../../../utils/config.js'
import { consumeEarlyInput } from '../../../utils/earlyInput.js'
import type { PromptInputMode } from '../../../types/textInputTypes.js'

const PROMPT_SUPPRESSION_MS = 500
const RECENT_SCROLL_REPIN_WINDOW_MS = 3000

type RefValue<T> = { current: T }

export interface ReplInputStateOptions {
  repinScroll: () => void
  lastUserScrollTsRef: RefValue<number>
  setIsPromptInputActive: (active: boolean) => void
  trySuggestBgPRIntercept: (currentValue: string, nextValue: string) => boolean
}

export function useReplInputState({
  repinScroll,
  lastUserScrollTsRef,
  setIsPromptInputActive,
  trySuggestBgPRIntercept,
}: ReplInputStateOptions) {
  const [inputValue, setInputValueRaw] = useState(() => consumeEarlyInput())
  const inputValueRef = useRef(inputValue)
  inputValueRef.current = inputValue

  const setInputValue = useCallback(
    (value: string) => {
      if (trySuggestBgPRIntercept(inputValueRef.current, value)) return
      if (
        inputValueRef.current === '' &&
        value !== '' &&
        Date.now() - lastUserScrollTsRef.current >=
          RECENT_SCROLL_REPIN_WINDOW_MS
      ) {
        repinScroll()
      }
      inputValueRef.current = value
      setInputValueRaw(value)
      setIsPromptInputActive(value.trim().length > 0)
    },
    [
      lastUserScrollTsRef,
      repinScroll,
      setIsPromptInputActive,
      trySuggestBgPRIntercept,
    ],
  )

  useEffect(() => {
    if (inputValue.trim().length === 0) return
    const timer = setTimeout(
      setIsPromptInputActive,
      PROMPT_SUPPRESSION_MS,
      false,
    )
    return () => clearTimeout(timer)
  }, [inputValue, setIsPromptInputActive])

  const [inputMode, setInputMode] = useState<PromptInputMode>('prompt')
  const [stashedPrompt, setStashedPrompt] = useState<
    | {
        text: string
        cursorOffset: number
        pastedContents: Record<number, PastedContent>
      }
    | undefined
  >()

  return {
    inputValue,
    inputValueRef,
    setInputValue,
    inputMode,
    setInputMode,
    stashedPrompt,
    setStashedPrompt,
  }
}
