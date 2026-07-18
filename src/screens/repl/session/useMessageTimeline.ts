import { feature } from 'bun:bundle'
import type { ScrollBoxHandle } from '@anthropic/ink'
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  computeUnseenDivider,
  useUnseenDivider,
} from '../../../components/FullscreenLayout.js'
import type {
  MessageActionsNav,
  MessageActionsState,
} from '../../../components/messageActions.js'
import { useAwaySummary } from '../../../hooks/useAwaySummary.js'
import { useDeferredHookMessages } from '../../../hooks/useDeferredHookMessages.js'
import type { useSetAppState } from '../../../state/AppState.js'
import type {
  HookResultMessage,
  Message as MessageType,
} from '../../../types/message.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isHumanTurn } from '../../../utils/messagePredicates.js'

const DEFERRED_CAP = 500

type RefValue<T> = { current: T }

export interface MessageTimelineOptions {
  initialMessages?: MessageType[]
  pendingHookMessages?: Promise<HookResultMessage[]>
  isLoading: boolean
  scrollRef: RefValue<ScrollBoxHandle | null>
  lastUserScrollTsRef: RefValue<number>
  userInputBaselineRef: RefValue<number>
  userMessagePendingRef: RefValue<boolean>
  setUserInputOnProcessingRaw: (input: string | undefined) => void
  setAppState: ReturnType<typeof useSetAppState>
}

export function useMessageTimeline({
  initialMessages,
  pendingHookMessages,
  isLoading,
  scrollRef,
  lastUserScrollTsRef,
  userInputBaselineRef,
  userMessagePendingRef,
  setUserInputOnProcessingRaw,
  setAppState,
}: MessageTimelineOptions) {
  const [messages, rawSetMessages] = useState<MessageType[]>(
    initialMessages ?? [],
  )
  const messagesRef = useRef(messages)
  const setMessages = useCallback(
    (action: React.SetStateAction<MessageType[]>) => {
      const previous = messagesRef.current
      const next =
        typeof action === 'function' ? action(messagesRef.current) : action
      messagesRef.current = next
      if (next.length < userInputBaselineRef.current) {
        userInputBaselineRef.current = 0
      } else if (
        next.length > previous.length &&
        userMessagePendingRef.current
      ) {
        const delta = next.length - previous.length
        const added =
          previous.length === 0 || next[0] === previous[0]
            ? next.slice(-delta)
            : next.slice(0, delta)
        if (added.some(isHumanTurn)) userMessagePendingRef.current = false
        else userInputBaselineRef.current = next.length
      }
      rawSetMessages(next)
    },
    [],
  )

  const setUserInputOnProcessing = useCallback((input: string | undefined) => {
    if (input !== undefined) {
      userInputBaselineRef.current = messagesRef.current.length
      userMessagePendingRef.current = true
    } else {
      userMessagePendingRef.current = false
    }
    setUserInputOnProcessingRaw(input)
  }, [])

  const {
    dividerIndex,
    dividerYRef,
    onScrollAway,
    onRepin,
    jumpToNew,
    shiftDivider,
  } = useUnseenDivider(messages.length)
  if (feature('AWAY_SUMMARY')) useAwaySummary(messages, setMessages, isLoading)

  const [cursor, setCursor] = useState<MessageActionsState | null>(null)
  const cursorNavRef = useRef<MessageActionsNav | null>(null)
  const unseenDivider = useMemo(
    () => computeUnseenDivider(messages, dividerIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- append count and divider state define the projection
    [dividerIndex, messages.length],
  )
  const repinScroll = useCallback(() => {
    scrollRef.current?.scrollToBottom()
    onRepin()
    setCursor(null)
  }, [onRepin, scrollRef])

  const lastMessage = messages.at(-1)
  const lastMessageIsHuman = lastMessage != null && isHumanTurn(lastMessage)
  useEffect(() => {
    if (lastMessageIsHuman) repinScroll()
  }, [lastMessageIsHuman, lastMessage, repinScroll])

  const composedOnScroll = useCallback(
    (sticky: boolean, handle: ScrollBoxHandle) => {
      lastUserScrollTsRef.current = Date.now()
      if (sticky) {
        onRepin()
        return
      }
      onScrollAway(handle)
      if (feature('BUDDY')) {
        setAppState(previous =>
          previous.companionReaction === undefined
            ? previous
            : { ...previous, companionReaction: undefined },
        )
      }
    },
    [lastUserScrollTsRef, onRepin, onScrollAway, setAppState],
  )

  const awaitPendingHooks = useDeferredHookMessages(
    pendingHookMessages,
    setMessages,
  )
  const cappedMessages = useMemo(
    () =>
      messages.length > DEFERRED_CAP ? messages.slice(-DEFERRED_CAP) : messages,
    [messages],
  )
  const deferredMessages = useDeferredValue(cappedMessages)
  const deferredBehind = messages.length - deferredMessages.length
  if (deferredBehind > 0) {
    logForDebugging(
      `[useDeferredValue] Messages deferred by ${deferredBehind} (${deferredMessages.length}→${messages.length})`,
    )
  }

  return {
    messages,
    messagesRef,
    setMessages,
    setUserInputOnProcessing,
    cursor,
    setCursor,
    cursorNavRef,
    unseenDivider,
    dividerYRef,
    jumpToNew,
    repinScroll,
    composedOnScroll,
    awaitPendingHooks,
    deferredMessages,
  }
}
